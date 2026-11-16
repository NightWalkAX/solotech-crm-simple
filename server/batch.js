// Bulk writes for Claude: many inserts/updates/upserts/deletes in one transaction with a compact result.
// Every row still goes through insertRow/updateRow/deleteRow, so it is audited and undoable per chat turn.
import { db, insertRow, updateRow, deleteRow, getRow } from './db.js';
import { STAGES } from './domain.js';

// Documents are left out on purpose: issued numbers are final and go through documents.js.
const TABLES = { clients: 'clients', interactions: 'interactions', actions: 'action_items', action_items: 'action_items' };

function normalize(tbl, data) {
  const d = { ...data };
  if (tbl === 'clients' && Array.isArray(d.pain_points)) d.pain_points = JSON.stringify(d.pain_points);
  if (tbl === 'action_items' && (d.status === 'done' || d.status === 'dropped') && !d.done_at) d.done_at = new Date().toISOString();
  if (tbl === 'action_items' && d.status === 'open') d.done_at = null;
  return d;
}

// "$2" (or "$2.id") anywhere in data/match = id produced by op #2 of this batch.
function resolveRefs(value, ids) {
  if (typeof value === 'string' && /^\$\d+(\.id)?$/.test(value)) {
    const i = Number(value.slice(1).replace('.id', ''));
    if (ids[i] == null) throw new Error(`reference ${value} has no id (op ${i} missing or later)`);
    return ids[i];
  }
  if (Array.isArray(value)) return value.map(v => resolveRefs(v, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, ids)]));
  return value;
}

function findByMatch(tbl, match) {
  const keys = Object.keys(match || {});
  if (!keys.length) throw new Error('match needs at least one field');
  const cols = new Set(db.prepare(`PRAGMA table_info(${tbl})`).all().map(c => c.name));
  for (const k of keys) if (!cols.has(k)) throw new Error(`unknown column ${tbl}.${k}`);
  // Text matches are case-insensitive so "acme ltd" finds "Acme Ltd".
  const where = keys.map(k => (typeof match[k] === 'string' ? `${k} = @${k} COLLATE NOCASE` : `${k} IS @${k}`)).join(' AND ');
  const rows = db.prepare(`SELECT id FROM ${tbl} WHERE ${where} LIMIT 2`).all(match);
  if (rows.length > 1) throw new Error(`match ${JSON.stringify(match)} is ambiguous in ${tbl}`);
  return rows[0]?.id ?? null;
}

function logStageChange(clientId, before, after, actor) {
  if (!after?.stage || after.stage === before?.stage) return;
  const label = k => STAGES.find(s => s.key === k)?.label ?? k;
  insertRow('interactions', { client_id: clientId, channel: 'system', summary: `Etapa: ${label(before.stage)} → ${label(after.stage)}` }, actor);
}

function update(tbl, id, data, actor) {
  const before = getRow(tbl, id);
  if (!before) throw new Error(`${tbl} #${id} not found`);
  const after = updateRow(tbl, id, data, actor);
  if (tbl === 'clients') logStageChange(id, before, data, actor);
  return after;
}

function runOp(op, ids, actor) {
  const tbl = TABLES[op.table];
  if (!tbl) throw new Error(`table must be one of ${Object.keys(TABLES).join(', ')}`);
  const data = normalize(tbl, resolveRefs(op.data || {}, ids));
  const match = resolveRefs(op.match, ids);
  let id = resolveRefs(op.id, ids);

  switch (op.op) {
    case 'insert':
      return { id: insertRow(tbl, data, actor).id, did: 'insert' };
    case 'update':
      id ??= findByMatch(tbl, match);
      if (id == null) throw new Error(`no ${tbl} row matches ${JSON.stringify(match)}`);
      update(tbl, id, data, actor);
      return { id, did: 'update' };
    case 'upsert':
      id ??= findByMatch(tbl, match);
      if (id != null) { update(tbl, id, data, actor); return { id, did: 'update' }; }
      return { id: insertRow(tbl, normalize(tbl, { ...match, ...data }), actor).id, did: 'insert' };
    case 'delete':
      id ??= findByMatch(tbl, match);
      if (id == null || !deleteRow(tbl, id, actor)) throw new Error(`${tbl} row not found for delete`);
      return { id, did: 'delete' };
    default:
      throw new Error('op must be insert, update, upsert or delete');
  }
}

/** All-or-nothing: if any op fails nothing is written and the error names the op index. */
export function runBatch(ops, actor = 'ui') {
  if (!Array.isArray(ops) || !ops.length) throw new Error('ops must be a non-empty array');
  return db.transaction(() => {
    const ids = [];
    return ops.map((op, i) => {
      try {
        const r = runOp(op, ids, actor);
        ids[i] = r.id;
        return { i, t: op.table, ...r };
      } catch (e) {
        throw new Error(`op ${i} (${op.op} ${op.table}): ${e.message}`);
      }
    });
  })();
}
