const db = require('./db');

function list() {
  return db.prepare('SELECT jid, name FROM transcribe_senders ORDER BY name').all();
}

function isMonitored(jid) {
  if (!jid) return false;
  return !!db.prepare('SELECT 1 FROM transcribe_senders WHERE jid = ?').get(jid);
}

function add(jid, name) {
  db.prepare('INSERT OR REPLACE INTO transcribe_senders (jid, name) VALUES (?, ?)').run(jid, name || jid);
}

function remove(jid) {
  db.prepare('DELETE FROM transcribe_senders WHERE jid = ?').run(jid);
}

module.exports = { list, isMonitored, add, remove };
