const db = require('./db');

const DEFAULT_WHISPER_PROMPT =
  'Adiciona na lista uva itália, uva passa, tomate cereja, rúcula, pêra, meia dúzia de ovos, ' +
  'torrada integral leve Magic Tost Marilã 110 gramas, pasta de amendoim integral, ' +
  'filé de peixe sem espinho congelado, frango, arroz, feijão, leite, pão, manteiga, ' +
  'iogurte natural, queijo mussarela, detergente, sabonete, shampoo, amaciante.';

function getGroqApiKey() {
  return process.env.GROQ_API_KEY || db.prepare('SELECT value FROM config WHERE key = ?').get('groq_api_key')?.value || null;
}

function getWhisperPrompt() {
  return db.prepare('SELECT value FROM config WHERE key = ?').get('whisper_prompt')?.value || DEFAULT_WHISPER_PROMPT;
}

function setWhisperPrompt(prompt) {
  if (prompt) {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('whisper_prompt', prompt);
  } else {
    db.prepare('DELETE FROM config WHERE key = ?').run('whisper_prompt');
  }
}

async function transcribeAudio(buffer, mimetype, { attempt = 1, maxAttempts = 4 } = {}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) throw new Error('Groq API key não configurada');

  const ext = (mimetype || '').includes('ogg') ? 'ogg' : 'mp4';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `audio.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('response_format', 'text');
  form.append('prompt', getWhisperPrompt());

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '0', 10);
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 16000);
      console.warn(`[transcribe] ⏳ Rate limit (tentativa ${attempt}/${maxAttempts}), aguardando ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      return transcribeAudio(buffer, mimetype, { attempt: attempt + 1, maxAttempts });
    }
    throw new Error(`Groq ${res.status}: ${errBody}`);
  }

  return (await res.text()).trim();
}

async function transcribeAudioOnce(buffer, mimetype, { model, prompt } = {}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) throw new Error('Groq API key não configurada');

  const ext = (mimetype || '').includes('ogg') ? 'ogg' : 'mp4';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `audio.${ext}`);
  form.append('model', model || 'whisper-large-v3-turbo');
  form.append('language', 'pt');
  form.append('response_format', 'text');
  if (prompt) form.append('prompt', prompt);

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.text()).trim();
}

function getCompareVariants() {
  const saved = getWhisperPrompt();
  return [
    { label: 'turbo — sem prompt',          model: 'whisper-large-v3-turbo', prompt: null },
    { label: 'turbo — prompt configurado',  model: 'whisper-large-v3-turbo', prompt: saved },
    { label: 'turbo — só contexto',         model: 'whisper-large-v3-turbo', prompt: 'lista de compras supermercado' },
    { label: 'v3 — sem prompt',             model: 'whisper-large-v3',       prompt: null },
    { label: 'v3 — prompt configurado',     model: 'whisper-large-v3',       prompt: saved },
  ];
}

async function compareTranscriptions(buffer, mimetype) {
  const variants = getCompareVariants();
  const results = await Promise.allSettled(
    variants.map((v) => transcribeAudioOnce(buffer, mimetype, v))
  );
  return variants.map((v, i) => ({
    label: v.label,
    model: v.model,
    prompt: v.prompt,
    transcription: results[i].status === 'fulfilled' ? results[i].value : null,
    error: results[i].status === 'rejected' ? results[i].reason?.message : null,
  }));
}

module.exports = { transcribeAudio, getGroqApiKey, getWhisperPrompt, setWhisperPrompt, compareTranscriptions };
