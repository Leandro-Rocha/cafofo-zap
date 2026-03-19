# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**cafofo-zap** — WhatsApp gateway service. Manages a single Baileys session and distributes messages (text + audio) to other services via webhooks. Other projects integrate via REST API instead of managing their own WhatsApp connection.

## Commands

```bash
npm run dev              # nodemon on port 3010
docker compose up -d     # run via Docker
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Connection status + QR (base64) |
| GET | `/groups` | List participating groups |
| POST | `/send` | Send text to a group (`groupId`, `text`) |
| GET | `/webhooks` | List registered webhooks |
| POST | `/webhooks` | Register webhook (`url`, `groupId?`, `events?`, `secret?`) |
| DELETE | `/webhooks/:id` | Remove webhook |
| POST | `/disconnect` | Logout and clear session |
| GET | `/health` | Health check |

## Webhook payload

```json
{
  "type": "text" | "audio",
  "groupId": "1234@g.us",
  "sender": "Nome",
  "text": "mensagem de texto ou null",
  "audioBase64": "base64 do áudio ou null",
  "mimetype": "audio/ogg; codecs=opus",
  "transcription": "transcrição via Groq Whisper ou null",
  "timestamp": 1234567890
}
```

Webhooks are filtered by `group_id` (null = all groups) and `events` (comma-separated: `text,audio`).
If `secret` is set, it's sent in the `X-Webhook-Secret` header.

## Architecture

- **`whatsapp.js`** — Baileys connection. Emits all messages to a single `onMessage` handler.
- **`webhooks.js`** — SQLite registry. `dispatch(event)` fans out to matching webhooks in parallel.
- **`transcribe.js`** — Groq Whisper transcription. Called before dispatch if `GROQ_API_KEY` is set.
- **`index.js`** — Express server, wires everything together.
- **`db.js`** — SQLite (better-sqlite3), single `webhooks` table.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3010 | API port |
| `DB_PATH` | `/data/cafofo-zap.db` | SQLite path |
| `WA_DATA_DIR` | `/data` | Baileys auth storage |
| `GROQ_API_KEY` | — | If set, audio messages are transcribed before webhook dispatch |
