async function transcribe(buffer, mimetype) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

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
    console.error('[transcribe] Groq error:', res.status, await res.text());
    return null;
  }
  return (await res.text()).trim();
}

module.exports = { transcribe };
