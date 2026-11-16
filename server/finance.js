// Finance tab: income (receipts), OpEx fixed/variable (expenses + Claude API tokens), subscriptions.
// Everything is reported in GYD; foreign amounts carry the Demerara Bank rate of the moment they happened.
import fs from 'node:fs';
import path from 'node:path';
import { db, insertRow, updateRow, getRow, DB_PATH } from './db.js';
import { currentRate, lastRate, gydRate } from './fx.js';
import { today } from './domain.js';
import { monthTax } from './taxes.js';

const RECEIPTS_DIR = path.join(path.dirname(DB_PATH), 'receipts');
const MONTHLY = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
// Chat timestamps are UTC; months are Guyana months.
const LOCAL = "datetime(created_at, '-4 hours')";

function nextDue(date, cycle) {
  const d = new Date(`${date}T00:00:00Z`);
  if (cycle === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + (STEP_MONTHS[cycle] ?? 1));
  return d.toISOString().slice(0, 10);
}

/** Charge per cycle on a given day: promo price until promo_until, then the regular one; × quantity. */
export function priceOn(s, day = today()) {
  const promo = s.promo_amount != null && s.promo_until && day < s.promo_until;
  return (promo ? s.promo_amount : s.amount) * (s.quantity || 1);
}

const monthRange = m => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10) };
};
const shiftMonth = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
};

/** GYD per USD on a given day: last stored rate up to that day, else the oldest known one. */
export function rateOn(day) {
  return db.prepare("SELECT sell FROM fx_rates WHERE currency = 'USD' AND date(fetched_at, '-4 hours') <= ? ORDER BY fetched_at DESC LIMIT 1").pluck().get(day)
    ?? db.prepare("SELECT sell FROM fx_rates WHERE currency = 'USD' ORDER BY fetched_at LIMIT 1").pluck().get() ?? null;
}

function tokenTotals(from, to) {
  const fallback = lastRate()?.sell ?? 0;
  return db.prepare(`SELECT count(*) turns, coalesce(sum(cost_usd), 0) usd,
      coalesce(sum(coalesce(cost_gyd, round(cost_usd * @fallback))), 0) gyd,
      coalesce(sum(input_tokens), 0) input, coalesce(sum(output_tokens), 0) output,
      coalesce(sum(cache_read_tokens), 0) cache_read, coalesce(sum(cache_write_tokens), 0) cache_write
    FROM chat_messages WHERE role = 'assistant' AND cost_usd IS NOT NULL AND ${LOCAL} >= @from AND ${LOCAL} < @to`).get({ from, to, fallback });
}

function monthTotals(month) {
  const { from, to } = monthRange(month);
  const receipts = db.prepare(`SELECT coalesce(paid_on, issue_date) day, currency, total FROM documents
    WHERE type = 'receipt' AND status != 'void' AND coalesce(paid_on, issue_date) >= ? AND coalesce(paid_on, issue_date) < ?`).all(from, to)
    .reduce((s, r) => s + (r.currency === 'GYD' ? r.total : Math.round(r.total * (rateOn(r.day) ?? 0))), 0);
  const otherIncome = db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM income WHERE received_on >= ? AND received_on < ?').pluck().get(from, to);
  const income = receipts + otherIncome;
  const exp = db.prepare(`SELECT kind, coalesce(sum(amount_gyd), 0) gyd FROM expenses WHERE spent_on >= ? AND spent_on < ? GROUP BY kind`).all(from, to);
  const fixed = exp.find(e => e.kind === 'fixed')?.gyd ?? 0;
  const otherVariable = exp.find(e => e.kind === 'variable')?.gyd ?? 0;
  const tokens = tokenTotals(from, to);
  const variable = otherVariable + tokens.gyd;
  return { month, income, income_receipts: receipts, income_other: otherIncome, fixed, variable, tokens_gyd: tokens.gyd, tokens_usd: tokens.usd, margin: income - fixed - variable, tokens };
}

function taxCols(month, cache) {
  const t = monthTax(month, cache);
  return t ? { nis: t.nis, income_tax: t.income_tax, profit_real: t.profit, net_real: t.net } : { nis: 0, income_tax: 0, profit_real: null, net_real: null };
}

export async function financeSummary(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = today().slice(0, 7);
  const fx = await currentRate().catch(() => lastRate());
  const { from, to } = monthRange(month);
  const totals = monthTotals(month);
  // Open CRM invoices + cycles billed on other platforms (external_invoices, server/plans.js) not yet paid.
  const receivable = db.prepare(`SELECT currency, coalesce(sum(total - paid), 0) due FROM documents
    WHERE type = 'invoice' AND status NOT IN ('paid', 'void', 'draft') GROUP BY currency
    UNION ALL SELECT currency, sum(amount) FROM external_invoices WHERE status = 'issued' GROUP BY currency`).all()
    .reduce((s, r) => s + (r.currency === 'GYD' ? r.due : Math.round(r.due * (fx?.sell ?? 0))), 0);
  const fallback = fx?.sell ?? 0;
  const byMode = db.prepare(`SELECT coalesce(mode, '—') mode, count(*) turns, sum(cost_usd) usd,
      sum(coalesce(cost_gyd, round(cost_usd * @fallback))) gyd
    FROM chat_messages WHERE role = 'assistant' AND cost_usd IS NOT NULL AND ${LOCAL} >= @from AND ${LOCAL} < @to
    GROUP BY 1 ORDER BY gyd DESC`).all({ from, to, fallback });
  const subscriptions = db.prepare('SELECT * FROM subscriptions ORDER BY active DESC, kind, next_due IS NULL, next_due, name').all()
    .map(s => {
      const current = priceOn(s);
      const promo = current !== s.amount * (s.quantity || 1);
      return { ...s, current_amount: current, promo_active: promo, regular_total: s.amount * (s.quantity || 1),
        monthly_gyd: Math.round(current * (MONTHLY[s.cycle] ?? 1) * (s.currency === 'GYD' ? 1 : fallback)) };
    });
  const active = subscriptions.filter(s => s.active);
  const expenses = db.prepare(`SELECT e.*, s.name subscription FROM expenses e LEFT JOIN subscriptions s ON s.id = e.subscription_id
    WHERE spent_on >= ? AND spent_on < ? ORDER BY spent_on DESC, e.id DESC`).all(from, to);
  const taxCache = new Map();
  return {
    month, fx,
    totals: { ...totals, receivable },
    tokens: { ...totals.tokens, by_mode: byMode },
    budget: {
      fixed_gyd: active.filter(s => s.kind === 'fixed').reduce((n, s) => n + s.monthly_gyd, 0),
      variable_gyd: active.filter(s => s.kind === 'variable').reduce((n, s) => n + s.monthly_gyd, 0),
    },
    subscriptions, expenses,
    // nis / income_tax / net_real come from server/taxes.js: real money only (no tokens), from the business start.
    taxes: taxCols(month, taxCache),
    history: Array.from({ length: 6 }, (_, i) => monthTotals(shiftMonth(month, i - 5))).map(({ tokens, ...t }) => ({ ...t, ...taxCols(t.month, taxCache) })),
  };
}

/** Expenses between two days (both inclusive), newest first. */
export function listExpenses(from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || '') || !day.test(to || '')) throw new Error('from y to deben ser YYYY-MM-DD');
  return db.prepare(`SELECT e.*, s.name subscription FROM expenses e LEFT JOIN subscriptions s ON s.id = e.subscription_id
    WHERE spent_on >= ? AND spent_on <= ? ORDER BY spent_on DESC, e.id DESC`).all(from, to);
}

/** Income outside CRM receipts between two days (both inclusive), newest first. */
export function listIncome(from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || '') || !day.test(to || '')) throw new Error('from y to deben ser YYYY-MM-DD');
  return db.prepare('SELECT * FROM income WHERE received_on >= ? AND received_on <= ? ORDER BY received_on DESC, id DESC').all(from, to);
}

// --- writes (all audited through insertRow/updateRow) ---

const SUB_FIELDS = ['name', 'vendor', 'kind', 'amount', 'currency', 'cycle', 'next_due', 'active', 'notes', 'started_on', 'quantity', 'promo_amount', 'promo_until'];
const EXP_FIELDS = ['spent_on', 'subscription_id', 'description', 'kind', 'amount', 'currency', 'notes', 'budget_line_id'];
const only = (body, keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));

function checkKind(kind) {
  if (kind != null && !['fixed', 'variable'].includes(kind)) throw new Error('kind debe ser fixed o variable');
}

export function saveSubscription(id, body, actor) {
  const data = only(body, SUB_FIELDS);
  checkKind(data.kind);
  if (data.cycle && !MONTHLY[data.cycle]) throw new Error('cycle: weekly | monthly | quarterly | yearly');
  if (data.active != null) data.active = data.active ? 1 : 0;
  if (data.quantity != null && !(Number.isInteger(+data.quantity) && +data.quantity >= 1)) throw new Error('quantity debe ser un entero ≥ 1');
  if (data.promo_amount != null && data.promo_until === undefined && !(id && getRow('subscriptions', id)?.promo_until)) throw new Error('promo_until es obligatorio con promo_amount');
  if (id) return updateRow('subscriptions', id, data, actor);
  if (!data.name) throw new Error('name es obligatorio');
  return insertRow('subscriptions', data, actor);
}

/** Record a spend at the current Demerara Bank rate (stored with the row). */
export async function addExpense(body, actor) {
  const data = only(body, EXP_FIELDS);
  checkKind(data.kind);
  data.currency ||= 'USD';
  data.amount = Number(data.amount);
  if (!(data.amount > 0)) throw new Error('amount debe ser mayor que 0');
  if (!data.description) throw new Error('description es obligatoria');
  data.spent_on ||= today();
  data.fx_rate = await gydRate(data.currency);
  data.amount_gyd = Math.round(data.amount * data.fx_rate);
  return insertRow('expenses', data, actor);
}

export async function updateExpense(id, body, actor) {
  const before = getRow('expenses', id);
  if (!before) throw new Error('expense not found');
  const data = only(body, EXP_FIELDS);
  checkKind(data.kind);
  // Keep the rate of the original transaction unless the currency changes.
  if (data.currency && data.currency !== before.currency) data.fx_rate = await gydRate(data.currency);
  const amount = data.amount != null ? Number(data.amount) : before.amount;
  data.amount_gyd = Math.round(amount * (data.fx_rate ?? before.fx_rate ?? 1));
  return updateRow('expenses', id, data, actor);
}

const INC_FIELDS = ['received_on', 'payer', 'description', 'amount', 'currency', 'notes'];

/** Record income that isn't a CRM receipt. USD uses the current Demerara Bank rate; fx_rate only when the money was exchanged at another known rate. */
export async function addIncome(body, actor) {
  const data = only(body, INC_FIELDS);
  data.currency ||= 'GYD';
  data.amount = Number(data.amount);
  if (!(data.amount > 0)) throw new Error('amount debe ser mayor que 0');
  if (!data.description) throw new Error('description es obligatoria');
  data.received_on ||= today();
  data.fx_rate = data.currency === 'GYD' ? 1 : Number(body.fx_rate) || await gydRate(data.currency);
  data.amount_gyd = Math.round(data.amount * data.fx_rate);
  return insertRow('income', data, actor);
}

export async function updateIncome(id, body, actor) {
  const before = getRow('income', id);
  if (!before) throw new Error('income not found');
  const data = only(body, INC_FIELDS);
  if (body.fx_rate) data.fx_rate = Number(body.fx_rate);
  else if (data.currency && data.currency !== before.currency) data.fx_rate = data.currency === 'GYD' ? 1 : await gydRate(data.currency);
  const amount = data.amount != null ? Number(data.amount) : before.amount;
  data.amount_gyd = Math.round(amount * (data.fx_rate ?? before.fx_rate ?? 1));
  return updateRow('income', id, data, actor);
}

/** Validate and store an uploaded PDF in data/receipts/ (new file every time, so an undo still points to a real file). */
export function savePdf(buf, name, prefix, fallback) {
  if (!buf?.length || buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('El archivo debe ser un PDF');
  if (buf.length > 20 * 1024 * 1024) throw new Error('PDF demasiado grande (máx. 20 MB)');
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const file = path.join(RECEIPTS_DIR, `${prefix}-${Date.now()}.pdf`);
  fs.writeFileSync(file, buf);
  return { file, name: path.basename(name || fallback).replace(/[^\w.\- ()]/g, '_') };
}

/** Attach the PDF proof of payment to an expense. Old files are kept so an undo still points to a real file. */
export function attachReceipt(id, buf, name, actor) {
  if (!getRow('expenses', id)) throw new Error('expense not found');
  const pdf = savePdf(buf, name, `expense-${id}`, 'comprobante.pdf');
  return updateRow('expenses', id, { receipt_path: pdf.file, receipt_name: pdf.name }, actor);
}

/** Pay a subscription's current cycle: expense at today's rate, next_due moves one cycle. */
export async function paySubscription(id, body, actor) {
  const s = getRow('subscriptions', id);
  if (!s) throw new Error('subscription not found');
  const spent_on = body.spent_on || today();
  const exp = await addExpense({
    spent_on, subscription_id: s.id, kind: s.kind, currency: s.currency,
    amount: body.amount ?? priceOn(s, spent_on),
    description: body.description || `${s.name}${(s.quantity || 1) > 1 ? ` ×${s.quantity}` : ''}${s.vendor ? ` (${s.vendor})` : ''}`, notes: body.notes,
  }, actor);
  updateRow('subscriptions', s.id, { next_due: nextDue(s.next_due || spent_on, s.cycle) }, actor);
  return exp;
}
