const db = require('./db');

function getGroqApiKey() {
  return process.env.GROQ_API_KEY || db.prepare('SELECT value FROM config WHERE key = ?').get('groq_api_key')?.value || null;
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

const COMPARE_VARIANTS = [
  { label: 'turbo — sem prompt',           model: 'whisper-large-v3-turbo', prompt: null },
  { label: 'turbo — prompt contexto',      model: 'whisper-large-v3-turbo', prompt: 'lista de compras supermercado' },
  { label: 'turbo — prompt com exemplos',  model: 'whisper-large-v3-turbo', prompt: 'Adiciona na lista: leite, pão, ovos, frango, arroz, feijão, rúcula, alface, tomate, cebola, laranja, pêra, manga, banana, maçã, detergente, sabonete, shampoo' },
  { label: 'v3 — sem prompt',              model: 'whisper-large-v3',       prompt: null },
  { label: 'v3 — prompt contexto',         model: 'whisper-large-v3',       prompt: 'lista de compras supermercado' },
];

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

async function compareTranscriptions(buffer, mimetype) {
  const results = await Promise.allSettled(
    COMPARE_VARIANTS.map((v) => transcribeAudioOnce(buffer, mimetype, v))
  );
  return COMPARE_VARIANTS.map((v, i) => ({
    label: v.label,
    model: v.model,
    prompt: v.prompt,
    transcription: results[i].status === 'fulfilled' ? results[i].value : null,
    error: results[i].status === 'rejected' ? results[i].reason?.message : null,
  }));
}

module.exports = { transcribeAudio, getGroqApiKey, compareTranscriptions };
