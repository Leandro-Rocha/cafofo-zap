const db = require('./db');

function getGroqApiKey() {
  return process.env.GROQ_API_KEY || db.prepare('SELECT value FROM config WHERE key = ?').get('groq_api_key')?.value || null;
}

async function transcribeAudio(buffer, mimetype) {
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

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  return (await res.text()).trim();
}

module.exports = { transcribeAudio, getGroqApiKey };
