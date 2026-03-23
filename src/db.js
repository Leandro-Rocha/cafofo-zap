const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/cafofo-zap.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    group_id TEXT,
    events TEXT NOT NULL DEFAULT 'text,audio',
    transcribe INTEGER NOT NULL DEFAULT 0,
    secret TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try { db.exec('ALTER TABLE webhooks ADD COLUMN transcribe INTEGER NOT NULL DEFAULT 0'); } catch {}

module.exports = db;
