const MAX_LINES = 500;

const lines = [];
const clients = new Set();

function push(level, args) {
  const text = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const entry = { ts: Date.now(), level, text };
  lines.push(entry);
  if (lines.length > MAX_LINES) lines.shift();
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) res.write(data);
}

const _log = console.log.bind(console);
const _error = console.error.bind(console);
const _warn = console.warn.bind(console);

console.log = (...args) => { _log(...args); push('log', args); };
console.error = (...args) => { _error(...args); push('error', args); };
console.warn = (...args) => { _warn(...args); push('warn', args); };

function getLines() { return lines; }

function addClient(res) { clients.add(res); }
function removeClient(res) { clients.delete(res); }

module.exports = { getLines, addClient, removeClient };
