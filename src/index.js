require('./logger'); // intercepts console.log/error/warn
const express = require('express');
const path = require('path');
const wa = require('./whatsapp');
const webhooks = require('./webhooks');
const { transcribe } = require('./transcribe');
const autotranscribe = require('./autotranscribe');
const logger = require('./logger');
const { getGroqApiKey, setConfig } = require('./config');

const app = express();
app.use(express.json());

// --- WhatsApp message handler ---

wa.setMessageHandler(async (event) => {
  const isMe = event.isMySender;

  if (event.type === 'audio' && isMe && autotranscribe.isEnabled(event.groupId)) {
    const text = await transcribe(event.buffer, event.mimetype).catch((err) => { console.error('[transcribe] erro:', err.message); return null; });
    if (text) {
      await wa.sendMessage(event.groupId, `*${event.sender}:*\n${text}`);
    }
    return;
  }

  if (isMe) return; // ignora demais mensagens próprias

  if (event.type === 'audio' && process.env.GROQ_API_KEY) {
    event.transcription = await transcribe(event.buffer, event.mimetype);
  }
  await webhooks.dispatch(event);
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
