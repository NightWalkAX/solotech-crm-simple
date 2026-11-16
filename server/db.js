import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.CRM_DB || path.join(root, 'data', 'crm.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Every write (ours or from another process, e.g. Claude running sqlite3) ends up on this bus.
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const dir = path.join(root, 'server', 'migrations');
  const isDone = db.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (isDone.get(file)) continue;
    // IMMEDIATE + re-check: the API and the chat worker both migrate on start; only one applies each file.
    const applied = db.transaction(() => {
      if (isDone.get(file)) return false;
      db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      return true;
    }).immediate();
    if (applied) console.log(`[db] migrated ${file}`);
  }
}

export function changed(tbl, id = null) {
  bus.emit('change', { tbl, id });
}

let auditStmt;
const audit = { run: (...a) => (auditStmt ??= db.prepare('INSERT INTO audit_log (tbl, row_id, action, before, after, actor) VALUES (?, ?, ?, ?, ?, ?)')).run(...a) };

const columnsCache = new Map();
function columns(tbl) {
  if (!columnsCache.has(tbl)) {
    columnsCache.set(tbl, new Set(db.prepare(`PRAGMA table_info(${tbl})`).all().map(c => c.name)));
  }
  return columnsCache.get(tbl);
}

function pick(tbl, data) {
  const cols = columns(tbl);
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => cols.has(k) && k !== 'id' && v !== undefined));
}

export function getRow(tbl, id) {
  return db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(id);
}

export function insertRow(tbl, data, actor = 'ui') {
  const row = pick(tbl, data);
  const keys = Object.keys(row);
  const info = db.prepare(
    `INSERT INTO ${tbl} (${keys.join(', ')}) VALUES (${keys.map(k => '@' + k).join(', ')})`
  ).run(row);
  const after = getRow(tbl, info.lastInsertRowid);
  audit.run(tbl, after.id, 'insert', null, JSON.stringify(after), actor);
  changed(tbl, after.id);
  return after;
}

export function updateRow(tbl, id, data, actor = 'ui') {
  const before = getRow(tbl, id);
  if (!before) return null;
  const row = pick(tbl, data);
  if (columns(tbl).has('updated_at')) row.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const keys = Object.keys(row);
  if (!keys.length) return before;
  db.prepare(`UPDATE ${tbl} SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...row, id });
  const after = getRow(tbl, id);
  audit.run(tbl, id, 'update', JSON.stringify(before), JSON.stringify(after), actor);
  changed(tbl, id);
  return after;
}

export function deleteRow(tbl, id, actor = 'ui') {
  const before = getRow(tbl, id);
  if (!before) return false;
  db.prepare(`DELETE FROM ${tbl} WHERE id = ?`).run(id);
  audit.run(tbl, id, 'delete', JSON.stringify(before), null, actor);
  changed(tbl, id);
  return true;
}

export function getSetting(key, fallback = null) {
  const v = db.prepare('SELECT value FROM settings WHERE key = ?').pluck().get(key);
  return v == null ? fallback : JSON.parse(v);
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
  changed('settings');
}

// Detect writes made by other connections (sqlite3 CLI, scripts, Claude) and broadcast a full refresh.
export function watchExternalWrites(intervalMs = 1000) {
  let last = db.pragma('data_version', { simple: true });
  setInterval(() => {
    const v = db.pragma('data_version', { simple: true });
    if (v !== last) {
      last = v;
      changed('*');
    }
  }, intervalMs).unref();
}

// Migrate on load: modules prepare statements at import time (e.g. leadscore.js), before index.js/chat-worker.js run.
migrate();
