// Deudas: what others owe the owner (receivable) and what the owner owes (payable), with partial payments.
// Balances are derived (amount - payments); totals in GYD use the latest Demerara Bank rate.
import { db, getRow, insertRow, updateRow, deleteRow } from './db.js';
import { lastRate } from './fx.js';
import { today } from './domain.js';

const DIRECTIONS = ['receivable', 'payable'];
const DEBT_FIELDS = ['direction', 'client_id', 'counterparty', 'description', 'amount', 'currency', 'started_on', 'due_date', 'notes'];
const only = (body, keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));

const DEBT_SELECT = `
  SELECT d.*, c.company,
    coalesce((SELECT sum(amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS paid,
    d.amount - coalesce((SELECT sum(amount) FROM debt_payments p WHERE p.debt_id = d.id), 0) AS balance
  FROM debts d LEFT JOIN clients c ON c.id = d.client_id`;

function withPayments(rows) {
  const pay = db.prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY paid_on DESC, id DESC');
  return rows.map(d => ({ ...d, settled: d.balance <= 0, payments: pay.all(d.id) }));
}

/** Open debts first (nearest due date first), then settled ones. */
export function listDebts({ direction, client_id } = {}) {
  const where = [];
  const p = {};
  if (direction) { where.push('d.direction = @direction'); p.direction = direction; }
  if (client_id) { where.push('d.client_id = @client_id'); p.client_id = Number(client_id); }
  return withPayments(db.prepare(`${DEBT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY balance <= 0, d.due_date IS NULL, d.due_date, d.id DESC`).all(p));
}

export function getDebt(id) {
  return withPayments([db.prepare(`${DEBT_SELECT} WHERE d.id = ?`).get(id)].filter(Boolean))[0] ?? null;
}

/** Open balances in GYD by direction (USD at the latest stored rate). */
export function debtTotals() {
  const sell = lastRate()?.sell ?? 0;
  const totals = { receivable: 0, payable: 0, open: 0 };
  for (const d of db.prepare(`${DEBT_SELECT}`).all().filter(d => d.balance > 0)) {
    totals[d.direction] += Math.round(d.balance * (d.currency === 'GYD' ? 1 : sell));
    totals.open++;
  }
  return totals;
}

/** Open debts overdue or due within the next 7 days (Today board). */
export function debtsDue() {
  const in7 = new Date(Date.parse(today()) + 7 * 86400e3).toISOString().slice(0, 10);
  return db.prepare(`${DEBT_SELECT} WHERE d.due_date IS NOT NULL AND d.due_date <= ? ORDER BY d.due_date`).all(in7)
    .filter(d => d.balance > 0);
}

export function saveDebt(id, body, actor) {
  const data = only(body, DEBT_FIELDS);
  if (data.direction != null && !DIRECTIONS.includes(data.direction)) throw new Error('direction debe ser receivable o payable');
  if (data.currency != null && !['GYD', 'USD'].includes(data.currency)) throw new Error('currency debe ser GYD o USD');
  if (data.amount != null) {
    data.amount = Number(data.amount);
    if (!(data.amount > 0)) throw new Error('amount debe ser mayor que 0');
  }
  if (data.client_id === '') data.client_id = null;
  if (id) {
    if (!getRow('debts', id)) throw new Error('debt not found');
    return updateRow('debts', id, data, actor);
  }
  if (!data.direction) throw new Error('direction es obligatorio');
  if (!data.description) throw new Error('description es obligatoria');
  if (data.amount == null) throw new Error('amount es obligatorio');
  if (!data.client_id && !data.counterparty) throw new Error('Indica un cliente o la otra parte (counterparty)');
  data.started_on ||= today();
  return insertRow('debts', data, actor);
}

export function deleteDebt(id, actor) {
  if (db.prepare('SELECT count(*) FROM debt_payments WHERE debt_id = ?').pluck().get(id))
    throw new Error('La deuda tiene abonos: elimínalos primero');
  return deleteRow('debts', id, actor);
}

/** Record a (partial) payment in the debt's currency. Paying more than the balance is rejected. */
export function addDebtPayment(debtId, body, actor) {
  const d = getDebt(debtId);
  if (!d) throw new Error('debt not found');
  const amount = Number(body.amount ?? d.balance);
  if (!(amount > 0)) throw new Error('amount debe ser mayor que 0');
  if (amount > d.balance + 1e-9) throw new Error(`El abono supera el saldo pendiente (${d.balance} ${d.currency})`);
  return insertRow('debt_payments', { debt_id: debtId, amount, paid_on: body.paid_on || today(), notes: body.notes }, actor);
}
