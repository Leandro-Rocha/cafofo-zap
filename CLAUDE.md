# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**cafofo-zap** — WhatsApp gateway service. Manages a single Baileys session and distributes messages (text + audio) to other services via webhooks. Other projects integrate via REST API instead of managing their own WhatsApp connection.

## Commands

```bash
npm run dev              # nodemon on port 3010
docker compose up -d     # run via Docker
```

## Architecture

- **`whatsapp.js`** — Baileys connection. Emits messages to `onMessage` and contacts to `onContacts`. Tracks `myJid` and `myLid` (Baileys multi-device uses `@lid` JIDs — own messages arrive as `senderJid@lid`, not `@s.whatsapp.net`).
- **`index.js`** — Express server. Wires message handler (auto-transcription → inbox, webhook dispatch) and all routes.
- **`webhooks.js`** — SQLite registry. `dispatch(event)` fans out to matching webhooks in parallel.
- **`transcribe.js`** — Groq Whisper transcription. Uses `getGroqApiKey()` from `config.js`.
- **`autotranscribe.js`** — CRUD for groups where own/forwarded audio is transcribed to inbox.
- **`senders.js`** — Monitored senders (transcribe their audio → inbox). Also tracks all known senders from `contacts.update` events.
- **`config.js`** — Key-value store in SQLite. `getGroqApiKey()` checks env var first, then DB. `transcribe_inbox_jid` stores the destination group for transcriptions.
- **`logger.js`** — Intercepts `console.log/error/warn` and streams to SSE clients at `/logs`.
- **`db.js`** — SQLite (better-sqlite3). Tables: `webhooks`, `autotranscribe`, `config`, `transcribe_senders`, `known_senders`.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Connection status + QR (base64) |
| GET | `/groups` | List participating groups |
| POST | `/send` | Send text to a group (`groupId`, `text`) |
| GET | `/webhooks` | List registered webhooks |
| POST | `/webhooks` | Register webhook (`url`, `groupId?`, `events?`, `secret?`) |
| DELETE | `/webhooks/:id` | Remove webhook |
| POST | `/notify/deploy` | Send deploy notification (`groupId`, `service`, `status`, `actor`, `branch`, `commit`) |
| GET | `/autotranscribe` | List groups with auto-transcription enabled |
| POST | `/autotranscribe/:groupId` | Enable auto-transcription for group |
| DELETE | `/autotranscribe/:groupId` | Disable auto-transcription for group |
| GET | `/senders` | List known senders with `monitored` flag |
| POST | `/senders` | Add monitored sender (`jid`, `name`) |
| DELETE | `/senders/:jid` | Remove monitored sender |
| GET | `/config/groq-key` | Check if Groq API key is set |
| POST | `/config/groq-key` | Set Groq API key (`key`) |
| GET | `/config/inbox` | Get transcription inbox group (`jid`) |
| POST | `/config/inbox` | Set transcription inbox group (`jid`) |
| POST | `/disconnect` | Logout and clear session |
| GET | `/health` | Health check |
| GET | `/logs` | Real-time log viewer (HTML) |
| GET | `/logs/stream` | SSE stream of log lines |
| GET | `/logs/history` | Last 500 log lines (JSON) |
| GET | `/` | Admin UI |

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

## Transcription inbox

Own audio and forwarded audio in `autotranscribe`-enabled groups are transcribed and sent to a configured destination group (not back to the source group). Monitored senders' audio from any group is also routed to the inbox.

## Gotchas

- **Baileys `@lid` JIDs**: In multi-device mode, own messages arrive with `senderJid` ending in `@lid` (e.g. `88313285369856@lid`), not `@s.whatsapp.net`. Both `myJid` and `myLid` are stored on connect; `isMySender` checks both.
- **`contacts.update`** fires incrementally (1 contact at a time), not as a full list. `contacts.set` may never fire in newer Baileys versions.
- **Groq API key** is stored in the SQLite `config` table (persists across container restarts). Env var `GROQ_API_KEY` takes priority if set.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3010 | API port |
| `DB_PATH` | `/data/cafofo-zap.db` | SQLite path |
| `WA_DATA_DIR` | `/data` | Baileys auth storage |
| `GROQ_API_KEY` | — | Optional; prefer setting via admin UI (persisted in DB) |
