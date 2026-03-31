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
  form.append('model', 'whisper-large-v3');
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

module.exports = { transcribeAudio, getGroqApiKey };
