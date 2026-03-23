const db = require('./db');
const { transcribeAudio } = require('./transcribe');

function list() {
  return db.prepare('SELECT * FROM webhooks').all().map((w) => ({
    ...w,
    events: w.events.split(','),
    transcribe: !!w.transcribe,
  }));
}

function register({ url, groupId, events, transcribe, secret }) {
  const eventsStr = (events || ['text', 'audio']).join(',');
  const result = db.prepare(
    'INSERT INTO webhooks (url, group_id, events, transcribe, secret) VALUES (?, ?, ?, ?, ?)'
  ).run(url, groupId || null, eventsStr, transcribe ? 1 : 0, secret || null);
  return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(result.lastInsertRowid);
}

function remove(id) {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

async function dispatch(event) {
  const { type, groupId } = event;

  const hooks = list().filter((w) => {
    if (!w.events.includes(type)) return false;
    if (w.group_id && w.group_id !== groupId) return false;
    return true;
  });

  if (hooks.length === 0) return;

  // Transcreve uma vez se algum webhook solicitar
  let transcription = null;
  if (type === 'audio' && event.buffer && hooks.some((w) => w.transcribe)) {
    try {
      transcription = await transcribeAudio(event.buffer, event.mimetype);
      console.log(`[webhooks] áudio transcrito: "${transcription}"`);
    } catch (err) {
      console.error('[webhooks] erro ao transcrever:', err.message);
    }
  }

  const payload = {
    type: event.type,
    groupId: event.groupId,
    sender: event.sender,
    senderJid: event.senderJid || null,
    isMySender: event.isMySender || false,
    isSelfChat: event.isSelfChat || false,
    forwarded: event.forwarded || false,
    originalSender: event.originalSender || null,
    text: event.text || null,
    transcription,
    audioBase64: event.buffer ? event.buffer.toString('base64') : null,
    mimetype: event.mimetype || null,
    timestamp: Date.now(),
  };

  await Promise.allSettled(
    hooks.map(async (hook) => {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (hook.secret) headers['X-Webhook-Secret'] = hook.secret;
        const res = await fetch(hook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) console.error(`[webhooks] ${hook.url} → ${res.status}`);
      } catch (err) {
        console.error(`[webhooks] ${hook.url} erro:`, err.message);
      }
    })
  );
}

module.exports = { list, register, remove, dispatch };
