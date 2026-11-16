// Recurring income from clients (maintenance/hosting/support plans). Billing a cycle issues a normal invoice
// (documents.plan_id) and moves next_due one cycle; income counts in Finanzas only when the receipt is issued.
import { db, getRow, insertRow, updateRow, deleteRow } from './db.js';
import { lastRate } from './fx.js';
import { today } from './domain.js';
import { createDocument } from './documents.js';
import { addIncome, rateOn, savePdf } from './finance.js';
import { gydRate } from './fx.js';

// days15 = every 15 days (≈ 2 per month); the others step whole months on the plan's billing day.
const STEP_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
const STEP_DAYS = { days15: 15 };
const PER_MONTH = { days15: 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const PLAN_FIELDS = ['client_id', 'name', 'amount', 'currency', 'cycle', 'started_on', 'next_due', 'active', 'notes', 'billing', 'billing_platform'];
const only = (body, keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));

/** Same day n months later, clamped to the month's end (Jan 31 + 1 → Feb 28); anchorDay keeps a plan on its billing day. */
function addMonths(day, n, anchorDay) {
  const [y, m, dd] = day.split('-').map(Number);
  const d = anchorDay || dd;
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

function nextCycle(start, p) {
  if (STEP_DAYS[p.cycle]) return addDays(start, STEP_DAYS[p.cycle]);
  return addMonths(start, STEP_MONTHS[p.cycle] ?? 1, Number((p.started_on || start).slice(8, 10)));
}

/** Invoice line period, in English: "3 Oct – 17 Oct 2026", "October 2026", "Oct 2026 – Dec 2026". */
function periodLabel(start, cycle) {
  const months = STEP_MONTHS[cycle] ?? 1;
  const fmt = (day, opts) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { ...opts, year: 'numeric', timeZone: 'UTC' });
  if (STEP_DAYS[cycle]) {
    const end = addDays(start, STEP_DAYS[cycle] - 1);
    const short = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `${start.slice(0, 4) === end.slice(0, 4) ? short(start) : fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`;
  }
  if (months === 1) return fmt(start, { month: 'long' });
  return `${fmt(start, { month: 'short' })} – ${fmt(addMonths(start, months - 1), { month: 'short' })}`;
}

// Last billed cycle, CRM invoice (INV number) or external one ("Remote REF").
const BILLED = `(SELECT d.number AS label, d.issue_date AS day, d.id FROM documents d WHERE d.plan_id = p.id AND d.status != 'void'
  UNION ALL SELECT e.platform || coalesce(' ' || e.reference, ''), e.issued_on, e.id FROM external_invoices e WHERE e.plan_id = p.id AND e.status != 'void')`;
const PLAN_SELECT = `
  SELECT p.*, c.company,
    (SELECT label FROM ${BILLED} ORDER BY day DESC, id DESC LIMIT 1) AS last_invoice,
    (SELECT day FROM ${BILLED} ORDER BY day DESC, id DESC LIMIT 1) AS last_invoiced_on
  FROM client_plans p JOIN clients c ON c.id = p.client_id`;

/** Monthly equivalent in GYD at the latest stored rate (USD plans). */
const withMonthly = (p, sell) => ({ ...p, monthly_gyd: Math.round(p.amount * (PER_MONTH[p.cycle] ?? 1) * (p.currency === 'GYD' ? 1 : sell)) });

export function listPlans({ client_id } = {}) {
  const sell = lastRate()?.sell ?? 0;
  const where = client_id ? 'WHERE p.client_id = @client_id' : '';
  return db.prepare(`${PLAN_SELECT} ${where} ORDER BY p.active DESC, p.next_due IS NULL, p.next_due, c.company`)
    .all(client_id ? { client_id: Number(client_id) } : {}).map(p => withMonthly(p, sell));
}

/** Active recurring income per month in GYD (MRR) and how many plans make it up. */
export function planTotals() {
  const active = listPlans().filter(p => p.active);
  return { mrr_gyd: active.reduce((n, p) => n + p.monthly_gyd, 0), active: active.length };
}

/** Active plans whose next cycle is due within 7 days or overdue (Today board). */
export function plansDue() {
  const in7 = new Date(Date.parse(today()) + 7 * 86400e3).toISOString().slice(0, 10);
  return listPlans().filter(p => p.active && p.next_due && p.next_due <= in7);
}

export function savePlan(id, body, actor) {
  const data = only(body, PLAN_FIELDS);
  if (data.cycle != null && !PER_MONTH[data.cycle]) throw new Error('cycle: days15 | monthly | quarterly | yearly');
  if (data.currency != null && !['GYD', 'USD'].includes(data.currency)) throw new Error('currency debe ser GYD o USD');
  if (data.amount != null) {
    data.amount = Number(data.amount);
    if (!(data.amount > 0)) throw new Error('amount debe ser mayor que 0');
  }
  if (data.active != null) data.active = data.active ? 1 : 0;
  if (data.billing != null && !['crm', 'external'].includes(data.billing)) throw new Error('billing debe ser crm o external');
  if (id) {
    if (!getRow('client_plans', id)) throw new Error('plan not found');
    return updateRow('client_plans', id, data, actor);
  }
  if (!getRow('clients', data.client_id)) throw new Error('client not found');
  if (!data.name) throw new Error('name es obligatorio');
  if (data.amount == null) throw new Error('amount es obligatorio');
  data.started_on ||= today();
  data.next_due ||= data.started_on;
  return insertRow('client_plans', data, actor);
}

/** Plans that already billed something are paused, not deleted, so their invoices keep the link. */
export function deletePlan(id, actor) {
  if (db.prepare('SELECT (SELECT count(*) FROM documents WHERE plan_id = @id) + (SELECT count(*) FROM external_invoices WHERE plan_id = @id)').pluck().get({ id }))
    throw new Error('El plan ya tiene facturas: páusalo en lugar de eliminarlo');
  return deleteRow('client_plans', id, actor);
}

/**
 * Bill the plan's next cycle and move next_due one cycle. CRM: invoice (due on the cycle start, or today if that passed).
 * External (body.external, default the plan's billing): billed on another platform (Remote…), no INV number; it stays
 * "por cobrar" until markExternalPaid. The choice and platform are remembered on the plan.
 */
export function invoicePlan(id, body = {}, actor) {
  const p = getRow('client_plans', id);
  if (!p) throw new Error('plan not found');
  if (!p.active) throw new Error('El plan está pausado');
  const start = p.next_due || today();
  const external = body.external ?? p.billing === 'external';
  if (external) {
    const platform = (body.platform || p.billing_platform || '').trim();
    if (!platform) throw new Error('Indica la plataforma de la factura externa (p. ej. Remote)');
    return db.transaction(() => {
      const row = insertRow('external_invoices', {
        plan_id: p.id, client_id: p.client_id, platform, reference: body.reference || null,
        description: `${p.name} — ${periodLabel(start, p.cycle)}`, period_start: start,
        amount: Number(body.amount ?? p.amount), currency: body.currency || p.currency, issued_on: body.issue_date || today(), notes: body.notes ?? null,
      }, actor);
      updateRow('client_plans', p.id, { next_due: nextCycle(start, p), billing: 'external', billing_platform: platform }, actor);
      return { ...row, external: true };
    })();
  }
  return db.transaction(() => {
    const inv = createDocument({
      type: 'invoice', client_id: p.client_id, plan_id: p.id, currency: p.currency, issue_date: body.issue_date,
      due_date: body.due_date ?? (start > today() ? start : today()),
      lines: [{ description: `${p.name} — ${periodLabel(start, p.cycle)}`, qty: 1, unit_price: Math.round(body.amount ?? p.amount) }],
      notes: body.notes ?? null,
    }, actor);
    updateRow('client_plans', p.id, { next_due: nextCycle(start, p), ...(p.billing !== 'crm' ? { billing: 'crm' } : {}) }, actor);
    return inv;
  })();
}

const EXT_SELECT = `SELECT e.*, c.company FROM external_invoices e JOIN clients c ON c.id = e.client_id`;

/** External invoices, open ones first. status: issued | paid | void. */
export function listExternal({ status, client_id } = {}) {
  const where = [];
  const p = {};
  if (status) { where.push('e.status = @status'); p.status = status; }
  if (client_id) { where.push('e.client_id = @client_id'); p.client_id = Number(client_id); }
  return db.prepare(`${EXT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.status != 'issued', e.issued_on DESC, e.id DESC LIMIT 200`).all(p);
}

/**
 * Payment of an external invoice: recorded as income and the invoice marked paid. USD always converts at the Demerara Bank
 * rate (the owner's rule for these invoices): today's live rate, or the stored rate of that day for a past date. No manual rate.
 */
export async function markExternalPaid(id, body = {}, actor) {
  const e = db.prepare(`${EXT_SELECT} WHERE e.id = ?`).get(id);
  if (!e) throw new Error('external invoice not found');
  if (e.status !== 'issued') throw new Error(e.status === 'paid' ? 'Ya está cobrada' : 'Está anulada');
  const received_on = body.received_on || today();
  const currency = body.currency || e.currency;
  const fx_rate = currency === 'GYD' ? 1 : received_on < today() ? rateOn(received_on) ?? await gydRate(currency) : await gydRate(currency);
  const income = await addIncome({
    received_on, payer: e.company, currency, amount: body.amount ?? e.amount, fx_rate,
    description: `${e.description} (${e.platform}${e.reference ? ` ${e.reference}` : ''})`, notes: body.notes,
  }, actor);
  return updateRow('external_invoices', e.id, { status: 'paid', paid_on: received_on, income_id: income.id }, actor);
}

/** Void an unpaid external invoice (the plan's next_due is left as is: change it on the plan if needed). */
export function voidExternal(id, actor) {
  const e = getRow('external_invoices', id);
  if (!e) throw new Error('external invoice not found');
  if (e.status === 'paid') throw new Error('Ya está cobrada: elimina primero el ingreso');
  return updateRow('external_invoices', id, { status: 'void' }, actor);
}

/** Attach the PDF of an external invoice (as issued on the platform). Replaces the previous one; old files are kept for undo. */
export function attachExternalPdf(id, buf, name, actor) {
  if (!getRow('external_invoices', id)) throw new Error('external invoice not found');
  const pdf = savePdf(buf, name, `external-invoice-${id}`, 'factura.pdf');
  return updateRow('external_invoices', id, { pdf_path: pdf.file, pdf_name: pdf.name }, actor);
}
