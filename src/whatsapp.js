const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.WA_DATA_DIR || path.join(__dirname, '../data');
const AUTH_DIR = path.join(DATA_DIR, 'baileys-auth');

let sock = null;
let currentQR = null;
let status = 'disconnected';
let onMessage = null;
let myJid = null;

function setMessageHandler(fn) {
  onMessage = fn;
}

function getStatus() {
  return { status, qr: currentQR };
}

async function getGroups() {
  if (!sock || status !== 'connected') return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups)
      .map((g) => ({ id: g.id, name: g.subject }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function sendMessage(groupId, text) {
  if (!sock || status !== 'connected') throw new Error('WhatsApp não conectado');
  await sock.sendMessage(groupId, { text });
}

async function connect() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[zap] WA v${version.join('.')} isLatest=${isLatest}`);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[zap] messages.upsert type=${type} count=${messages.length}`, messages.map(m => ({ fromMe: m.key.fromMe, jid: m.key.remoteJid, hasAudio: !!m.message?.audioMessage })));
    if (!onMessage) return;
    // 'notify': mensagens novas (de outros e próprias via multi-device)
    // 'append': mensagens próprias sincronizadas de volta pelo WhatsApp
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      const fromMe = !!msg.key.fromMe;
      const groupId = msg.key.remoteJid;

      // só processa grupos
      if (!groupId || !groupId.endsWith('@g.us')) continue;

      // 'append' só interessa para áudio próprio (auto-transcrição)
      if (type === 'append' && !fromMe) continue;

      const sender = msg.pushName || msg.key.participant || groupId;

      const textContent =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        null;

      const audioMsg = msg.message?.audioMessage ||
        (msg.message?.documentMessage?.mimetype?.startsWith('audio/') ? msg.message.documentMessage : null);

      if (!fromMe && textContent) {
        await onMessage({ type: 'text', groupId, sender, text: textContent, fromMe, raw: msg });
      } else if (audioMsg) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
            logger: pino({ level: 'silent' }),
            reuploadRequest: sock.updateMediaMessage,
          });
          const senderJid = msg.key.participant ? jidNormalizedUser(msg.key.participant) : null;
          await onMessage({ type: 'audio', groupId, sender, senderJid, buffer, mimetype: audioMsg.mimetype, fromMe, raw: msg });
        } catch (err) {
          console.error('[zap] erro ao baixar áudio:', err.message);
        }
      }
    }
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = await QRCode.toDataURL(qr);
      status = 'connecting';
      console.log('[zap] QR gerado');
    }
    if (connection === 'open') {
      currentQR = null;
      status = 'connected';
      myJid = sock.user?.id ? jidNormalizedUser(sock.user.id) : null;
      console.log('[zap] conectado, myJid:', myJid);
    }
    if (connection === 'close') {
      status = 'disconnected';
      currentQR = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('[zap] desconectado, código:', code, 'reconectar:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connect, 5000);
      } else {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    }
  });
}

function disconnect() {
  if (sock) {
    try { sock.logout(); } catch {}
    sock = null;
  }
  status = 'disconnected';
  currentQR = null;
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

function getMyJid() { return myJid; }

module.exports = { connect, getStatus, getGroups, sendMessage, setMessageHandler, disconnect, getMyJid };
