import { db } from './db.js';

export const STAGES = [
  { key: 'evaluated', label: 'Nuevo' },
  { key: 'demo_ready', label: 'Calificado' },
  { key: 'msg1_sent', label: 'Contactado' },
  { key: 'replied', label: 'Respondió' },
  { key: 'demo_shown', label: 'Propuesta enviada' },
  { key: 'negotiating', label: 'Negociando' },
  { key: 'won', label: 'Ganado' },
  { key: 'delivered', label: 'Entregado' },
  { key: 'maintenance', label: 'Recurrente' },
  { key: 'lost', label: 'Perdido' },
  { key: 'discarded', label: 'Descartado' },
];
export const CLIENT_STAGES = new Set(['won', 'delivered', 'maintenance']);
const ENGAGED = new Set(['replied', 'demo_shown', 'negotiating']);

export const DOC_PREFIX = { quote: 'QUO', invoice: 'INV', receipt: 'REC' };

export function today() {
  // Guyana is UTC-4 all year.
  return new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
}

function daysSince(ts) {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts.replace(' ', 'T') + (ts.length <= 10 ? 'T00:00:00Z' : 'Z')).getTime()) / 86400e3;
}

// Open leads with a conversation get the temperature read from its content (server/leadscore.js, lead_scores);
// the recency rules below are only the fallback until it's scored.
export function autoTemperature(c) {
  if (CLIENT_STAGES.has(c.stage)) return 'client';
  if (c.stage === 'lost' || c.stage === 'discarded') return 'cold';
  if (c.lead_temp) return c.lead_temp;
  const inbound = daysSince(c.last_in_at);
  if (inbound <= 3) return 'hot';
  if (ENGAGED.has(c.stage)) return daysSince(c.last_contact_at) <= 7 ? 'hot' : 'warm';
  if (inbound <= 14) return 'warm';
  if ((c.stage === 'msg1_sent' || c.stage === 'demo_ready') && c.verdict === 'GO') return 'warm';
  return 'cold';
}

const CLIENT_SELECT = `
  SELECT c.*, ls.temperature AS lead_temp, ls.score AS lead_score, ls.reason AS lead_reason, ls.tip AS lead_tip,
    ls.scored_at AS lead_scored_at, ls.error AS lead_error,
    nullif(max(coalesce((SELECT max(occurred_at) FROM interactions i WHERE i.client_id = c.id), ''),
               coalesce((SELECT max(sent_at) FROM messages m WHERE m.client_id = c.id), '')), '') AS last_contact_at,
    nullif(max(coalesce((SELECT max(occurred_at) FROM interactions i WHERE i.client_id = c.id AND i.direction = 'in'), ''),
               coalesce((SELECT max(sent_at) FROM messages m WHERE m.client_id = c.id AND m.direction = 'in'), '')), '') AS last_in_at,
    (SELECT count(*) FROM messages m WHERE m.client_id = c.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread,
    (SELECT count(*) FROM action_items a WHERE a.client_id = c.id AND a.status = 'open') AS open_actions,
    (SELECT min(due_date) FROM action_items a WHERE a.client_id = c.id AND a.status = 'open') AS next_due,
    (SELECT coalesce(sum(total - paid), 0) FROM documents d WHERE d.client_id = c.id AND d.type = 'invoice' AND d.status NOT IN ('void','draft')) AS balance
  FROM clients c LEFT JOIN lead_scores ls ON ls.client_id = c.id`;

export function decorate(c) {
  if (!c) return c;
  const auto = autoTemperature(c);
  return { ...c, pain_points: JSON.parse(c.pain_points || '[]'), temperature_auto: auto, temp: c.temperature || auto };
}

export function listClients({ q, stage } = {}) {
  const where = [];
  const params = {};
  if (q) {
    where.push('(c.company LIKE @q OR c.contact_name LIKE @q OR c.email LIKE @q OR c.phone LIKE @q OR c.whatsapp LIKE @q OR c.slug LIKE @q)');
    params.q = `%${q}%`;
  }
  if (stage) { where.push('c.stage = @stage'); params.stage = stage; }
  const sql = `${CLIENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.updated_at DESC`;
  return db.prepare(sql).all(params).map(decorate);
}

export function getClient(id) {
  return decorate(db.prepare(`${CLIENT_SELECT} WHERE c.id = ?`).get(id));
}

export function nextNumber(type) {
  const prefix = DOC_PREFIX[type];
  const last = db.prepare("SELECT max(CAST(substr(number, 5) AS INTEGER)) FROM documents WHERE number LIKE ? || '-%'").pluck().get(prefix) || 0;
  return `${prefix}-${String(last + 1).padStart(6, '0')}`;
}

export function todayBoard() {
  const t = today();
  const in7 = new Date(Date.parse(t) + 7 * 86400e3).toISOString().slice(0, 10);
  const actionSql = `SELECT a.*, c.company FROM action_items a LEFT JOIN clients c ON c.id = a.client_id WHERE a.status = 'open'`;
  const clients = listClients();
  return {
    today: t,
    overdue: db.prepare(`${actionSql} AND a.due_date < ? ORDER BY a.due_date`).all(t),
    due_today: db.prepare(`${actionSql} AND a.due_date = ? ORDER BY a.id`).all(t),
    upcoming: db.prepare(`${actionSql} AND a.due_date > ? AND a.due_date <= ? ORDER BY a.due_date`).all(t, in7),
    undated: db.prepare(`${actionSql} AND a.due_date IS NULL ORDER BY a.id DESC LIMIT 20`).all(),
    // Question sent, no answer after 3 days: nudge (FB DM per the outreach sequence).
    follow_up: clients.filter(c => c.stage === 'msg1_sent' && !c.last_in_at && daysSince(c.last_contact_at ?? c.updated_at) >= 3),
    // Engaged leads that went quiet.
    quiet_hot: clients.filter(c => ENGAGED.has(c.stage) && daysSince(c.last_contact_at ?? c.updated_at) >= 3),
    unpaid: db.prepare(`SELECT d.*, c.company FROM documents d JOIN clients c ON c.id = d.client_id
      WHERE d.type = 'invoice' AND d.status NOT IN ('void','draft','paid') AND d.total > d.paid ORDER BY d.issue_date`).all(),
    hot: clients.filter(c => c.temp === 'hot'),
  };
}
