const db = require('./db');

function list() {
  return db.prepare('SELECT * FROM webhooks').all().map((w) => ({
    ...w,
    events: w.events.split(','),
  }));
}

function register({ url, groupId, events, secret }) {
  const eventsStr = (events || ['text', 'audio']).join(',');
  const result = db.prepare(
    'INSERT INTO webhooks (url, group_id, events, secret) VALUES (?, ?, ?, ?)'
  ).run(url, groupId || null, eventsStr, secret || null);
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
