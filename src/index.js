require('./logger'); // intercepts console.log/error/warn
const express = require('express');
const path = require('path');
const wa = require('./whatsapp');
const webhooks = require('./webhooks');
const { transcribe } = require('./transcribe');
const autotranscribe = require('./autotranscribe');
const senders = require('./senders');
const logger = require('./logger');
const { getGroqApiKey, setConfig, getConfig } = require('./config');

const app = express();
app.use(express.json());

// --- WhatsApp message handler ---

async function sendToInbox(label, text) {
  const inboxJid = getConfig('transcribe_inbox_jid');
  if (!inboxJid) { console.error('[transcribe] caixa de entrada não configurada'); return; }
  if (label) await wa.sendMessage(inboxJid, `*${label}:*`);
  await wa.sendMessage(inboxJid, text);
}

wa.setMessageHandler(async (event) => {
  const isMe = event.isMySender;

  // Áudio próprio ou encaminhado em grupo habilitado → caixa de entrada
  if (event.type === 'audio' && isMe && autotranscribe.isEnabled(event.groupId)) {
    const label = event.forwarded ? event.originalSender : event.sender;
    const text = await transcribe(event.buffer, event.mimetype).catch((err) => { console.error('[transcribe] erro:', err.message); return null; });
    if (text) await sendToInbox(label, text);
    return;
  }

  if (isMe) return;

  // Rastreia remetentes conhecidos
  if (event.senderJid && event.sender) senders.trackSeen(event.senderJid, event.sender);

  // Áudio de remetente monitorado → caixa de entrada
  if (event.type === 'audio' && senders.isMonitored(event.senderJid)) {
    const text = await transcribe(event.buffer, event.mimetype).catch((err) => { console.error('[transcribe] erro:', err.message); return null; });
    if (text) await sendToInbox(event.sender, text);
    return;
  }

  if (event.type === 'audio' && getGroqApiKey()) {
    event.transcription = await transcribe(event.buffer, event.mimetype);
  }
  await webhooks.dispatch(event);
});

wa.setContactsHandler((contacts) => {
  for (const c of contacts) {
    const name = c.notify || c.verifiedName || c.name;
    if (c.id && name && c.id.endsWith('@s.whatsapp.net')) {
      senders.trackSeen(c.id, name);
    }
  }
});

wa.connect().catch((err) => console.error('[zap] falha ao conectar:', err.message));

// --- Routes ---

// Status & QR
app.get('/status', (req, res) => res.json(wa.getStatus()));

// Groups
app.get('/groups', async (req, res) => {
  res.json(await wa.getGroups());
});

// Send message
app.post('/send', async (req, res) => {
  const { groupId, text } = req.body;
  if (!groupId || !text) return res.status(400).json({ error: 'groupId e text obrigatórios' });
  try {
    await wa.sendMessage(groupId, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Webhooks
app.get('/webhooks', (req, res) => res.json(webhooks.list()));

app.post('/webhooks', (req, res) => {
  const { url, groupId, events, secret } = req.body;
  if (!url) return res.status(400).json({ error: 'url obrigatória' });
  const hook = webhooks.register({ url, groupId, events, secret });
  res.status(201).json(hook);
});

app.delete('/webhooks/:id', (req, res) => {
  webhooks.remove(req.params.id);
  res.status(204).end();
});

// Deploy notification
app.post('/notify/deploy', async (req, res) => {
  const { groupId, commit, branch, actor, status, service } = req.body;
  if (!groupId || !groupId.trim()) return res.status(400).json({ error: 'groupId obrigatório' });

  const lines = [`🚀 *${service || 'deploy'}* — ${status || 'deploy concluído!'}`];
  if (actor) lines.push(`👤 ${actor}`);
  if (branch) lines.push(`🌿 ${branch}`);
  if (commit) lines.push(`📝 ${commit}`);

  try {
    await wa.sendMessage(groupId, lines.join('\n'));
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Auto-transcrição
app.get('/autotranscribe', (req, res) => res.json(autotranscribe.list()));

app.post('/autotranscribe/:groupId', (req, res) => {
  autotranscribe.enable(decodeURIComponent(req.params.groupId));
  res.json({ ok: true });
});

app.delete('/autotranscribe/:groupId', (req, res) => {
  autotranscribe.disable(decodeURIComponent(req.params.groupId));
  res.json({ ok: true });
});

// Config
app.get('/config/groq-key', (_, res) => res.json({ set: !!getGroqApiKey() }));

app.post('/config/groq-key', (req, res) => {
  const { key } = req.body;
  setConfig('groq_api_key', key || null);
  res.json({ ok: true });
});

app.get('/config/inbox', (_, res) => res.json({ jid: getConfig('transcribe_inbox_jid') }));

app.post('/config/inbox', (req, res) => {
  const { jid } = req.body;
  setConfig('transcribe_inbox_jid', jid || null);
  res.json({ ok: true });
});

// Remetentes monitorados
app.get('/senders', (_, res) => res.json(senders.listKnown()));

app.post('/senders', (req, res) => {
  const { jid, name } = req.body;
  if (!jid) return res.status(400).json({ error: 'jid obrigatório' });
  senders.add(jid, name);
  res.status(201).json({ ok: true });
});

app.delete('/senders/:jid', (req, res) => {
  senders.remove(decodeURIComponent(req.params.jid));
  res.status(204).end();
});

// Disconnect
app.post('/disconnect', (req, res) => {
  wa.disconnect();
  res.json({ ok: true });
});

app.get('/health', (_, res) => res.json({ ok: true }));

// Logs
app.get('/logs/history', (_, res) => res.json(logger.getLines()));

app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  logger.addClient(res);
  req.on('close', () => logger.removeClient(res));
});

app.get('/logs', (_, res) => res.sendFile(path.join(__dirname, 'logs.html')));

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'admin.html')));

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log(`[zap] API na porta ${PORT}`));
