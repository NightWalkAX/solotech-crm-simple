// Presupuesto (Finanzas): monthly plan per line vs. what really happened, plus the owner's salary and the tax
// reserve deposits (owner_moves). Actuals are derived, never typed: see budget_lines in 0030_taxes_budget.sql.
import { db, getRow, insertRow, updateRow, deleteRow } from './db.js';
import { today } from './domain.js';
import { rateOn } from './finance.js';
import { taxConfig } from './taxes.js';
import { planTotals } from './plans.js';

const KINDS = ['salary', 'reserve', 'fixed', 'variable', 'tagged'];
const MOVES = ['salary', 'reserve_in', 'reserve_out'];
const LINE_FIELDS = ['name', 'kind', 'amount_gyd', 'active', 'position', 'notes'];
const only = (body, keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));

const range = m => {
  const [y, mo] = m.split('-').map(Number);
  return [`${m}-01`, new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10)];
};

function monthIncome(from, to) {
  const receipts = db.prepare(`SELECT coalesce(paid_on, issue_date) day, currency, total FROM documents
    WHERE type = 'receipt' AND status != 'void' AND coalesce(paid_on, issue_date) >= ? AND coalesce(paid_on, issue_date) < ?`).all(from, to)
    .reduce((s, r) => s + (r.currency === 'GYD' ? r.total : Math.round(r.total * (rateOn(r.day) ?? 0))), 0);
  return receipts + db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM income WHERE received_on >= ? AND received_on < ?').pluck().get(from, to);
}

export function budgetMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = today().slice(0, 7);
  const [from, to] = range(month);
  const lines = db.prepare('SELECT * FROM budget_lines ORDER BY active DESC, position, id').all();
  const moves = kind => db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM owner_moves WHERE kind = ? AND moved_on >= ? AND moved_on < ?').pluck().get(kind, from, to);
  // Untagged expenses (or tagged to a paused/deleted line) fall to the first active line of their kind.
  const tagged = new Set(lines.filter(l => l.active && l.kind === 'tagged').map(l => l.id));
  const exp = db.prepare('SELECT kind, budget_line_id, amount_gyd FROM expenses WHERE spent_on >= ? AND spent_on < ?').all(from, to);
  const firstOf = kind => lines.find(l => l.active && l.kind === kind)?.id;
  const actual = new Map();
  const add = (lineId, n) => lineId != null && actual.set(lineId, (actual.get(lineId) ?? 0) + n);
  let unbudgeted = 0;
  for (const e of exp) {
    const line = tagged.has(e.budget_line_id) ? e.budget_line_id : firstOf(e.kind);
    if (line == null) unbudgeted += e.amount_gyd; else add(line, e.amount_gyd);
  }
  add(firstOf('salary'), moves('salary'));
  add(firstOf('reserve'), moves('reserve_in'));
  const rows = lines.map(l => ({ ...l, actual: l.active ? actual.get(l.id) ?? 0 : 0 }));
  const active = rows.filter(l => l.active);
  const planned = active.reduce((n, l) => n + l.amount_gyd, 0);
  const spent = active.reduce((n, l) => n + l.actual, 0) + unbudgeted;
  const income = monthIncome(from, to);
  return {
    month, lines: rows, unbudgeted,
    totals: { planned, actual: spent, income, left: income - spent, expected_income: planTotals().mrr_gyd ?? 0 },
    salary: db.prepare("SELECT * FROM owner_moves WHERE kind = 'salary' AND moved_on >= ? AND moved_on < ? ORDER BY moved_on DESC, id DESC").all(from, to),
    reserve_pct: taxConfig().reserve_pct,
  };
}

export function saveBudgetLine(id, body, actor) {
  const data = only(body, LINE_FIELDS);
  if (data.kind != null && !KINDS.includes(data.kind)) throw new Error(`kind: ${KINDS.join(' | ')}`);
  if (data.amount_gyd != null) {
    data.amount_gyd = Math.round(Number(data.amount_gyd));
    if (!(data.amount_gyd >= 0)) throw new Error('amount_gyd debe ser ≥ 0');
  }
  if (data.active != null) data.active = data.active ? 1 : 0;
  if (id) {
    if (!getRow('budget_lines', id)) throw new Error('línea no encontrada');
    return updateRow('budget_lines', id, data, actor);
  }
  if (!data.name) throw new Error('name es obligatorio');
  if (!data.kind) throw new Error('kind es obligatorio');
  data.position ??= db.prepare('SELECT coalesce(max(position), 0) + 1 FROM budget_lines').pluck().get();
  return insertRow('budget_lines', data, actor);
}

/** Expenses tagged to the line go back to their fixed/variable line (FK ON DELETE SET NULL is not audited, so do it here). */
export function deleteBudgetLine(id, actor) {
  for (const e of db.prepare('SELECT id FROM expenses WHERE budget_line_id = ?').all(id)) updateRow('expenses', e.id, { budget_line_id: null }, actor);
  return deleteRow('budget_lines', id, actor);
}

export function addOwnerMove(body, actor) {
  if (!MOVES.includes(body.kind)) throw new Error(`kind: ${MOVES.join(' | ')}`);
  const amount_gyd = Math.round(Number(body.amount_gyd));
  if (!(amount_gyd > 0)) throw new Error('amount_gyd debe ser mayor que 0');
  return insertRow('owner_moves', { kind: body.kind, amount_gyd, moved_on: body.moved_on || today(), notes: body.notes || null }, actor);
}

export const deleteOwnerMove = (id, actor) => deleteRow('owner_moves', id, actor);
