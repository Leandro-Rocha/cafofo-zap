require('./logger'); // intercepts console.log/error/warn
const express = require('express');
const path = require('path');
const wa = require('./whatsapp');
const webhooks = require('./webhooks');
const logger = require('./logger');

const app = express();
app.use(express.json());

// ── Dispatch all incoming messages to registered webhooks ──

wa.setMessageHandler(async (event) => {
  await webhooks.dispatch(event);
});

wa.connect().catch((err) => console.error('[zap] falha ao conectar:', err.message));

// ── Routes ──

app.get('/status', (req, res) => res.json(wa.getStatus()));

app.get('/groups', async (req, res) => {
  res.json(await wa.getGroups());
});

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

app.get('/webhooks', (req, res) => res.json(webhooks.list()));

app.post('/webhooks', (req, res) => {
  const { url, groupId, events, transcribe, secret } = req.body;
  if (!url) return res.status(400).json({ error: 'url obrigatória' });
  const hook = webhooks.register({ url, groupId, events, transcribe: !!transcribe, secret });
  res.status(201).json(hook);
});

app.delete('/webhooks/:id', (req, res) => {
  webhooks.remove(req.params.id);
  res.status(204).end();
});

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

app.post('/disconnect', (req, res) => {
  wa.disconnect();
  res.json({ ok: true });
});

app.get('/config/groq-key', (_, res) => {
  const { getGroqApiKey } = require('./transcribe');
  res.json({ set: !!getGroqApiKey() });
});

app.post('/config/groq-key', (req, res) => {
  const key = req.body.key || null;
  const db = require('./db');
  if (key) db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('groq_api_key', key);
  else db.prepare('DELETE FROM config WHERE key = ?').run('groq_api_key');
  res.json({ ok: true });
});

app.get('/health', (_, res) => res.json({ ok: true }));

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
