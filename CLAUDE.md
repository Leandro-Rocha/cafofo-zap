# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**cafofo-zap** — WhatsApp gateway service. Manages a single Baileys session and fans out all incoming messages (text + audio) to registered webhooks. Has no transcription logic — that lives in **cafofo-transcribe**.

## Commands

```bash
npm run dev              # nodemon on port 3010
docker compose up -d     # run via Docker
```

## Architecture

- **`whatsapp.js`** — Baileys connection. Emits messages via `onMessage`. Tracks `myJid` and `myLid` (Baileys multi-device uses `@lid` JIDs — own messages arrive as `senderJid@lid`, not `@s.whatsapp.net`). Dispatches both text and audio events; both include `senderJid`.
- **`index.js`** — Express server. Wires message handler (`webhooks.dispatch`) and all routes. No transcription logic.
- **`webhooks.js`** — SQLite registry. `dispatch(event)` fans out to matching webhooks in parallel.
- **`logger.js`** — Intercepts `console.log/error/warn` and streams to SSE clients at `/logs`.
- **`db.js`** — SQLite (better-sqlite3). Table: `webhooks` only.

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
  "senderJid": "5511999999999@s.whatsapp.net | null",
  "text": "mensagem de texto ou null",
  "audioBase64": "base64 do áudio ou null",
  "mimetype": "audio/ogg; codecs=opus",
  "timestamp": 1234567890
}
```

Webhooks are filtered by `group_id` (null = all groups) and `events` (comma-separated: `text,audio`).
If `secret` is set, it's sent in the `X-Webhook-Secret` header.
Transcription is handled by **cafofo-transcribe**, which registers itself as a webhook.

## Gotchas

- **Baileys `@lid` JIDs**: In multi-device mode, own messages arrive with `senderJid` ending in `@lid` (e.g. `88313285369856@lid`), not `@s.whatsapp.net`. Both `myJid` and `myLid` are stored on connect; `isMySender` checks both.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3010 | API port |
| `DB_PATH` | `/data/cafofo-zap.db` | SQLite path |
| `WA_DATA_DIR` | `/data` | Baileys auth storage |
