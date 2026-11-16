// Impuestos tab: NIS (self-employed) and GRA income tax estimated from the CRM's real money, due-date calendar,
// payments made (tax_payments) and the tax reserve account (owner_moves reserve_in/out).
// Real money only: income = receipts + `income` rows, costs = `expenses` (Claude tokens are left out: they are an
// API-equivalent figure, not cash paid). Rules live in settings.taxes because they change with every national budget.
import { db, getSetting, setSetting, insertRow, deleteRow, getRow } from './db.js';
import { today } from './domain.js';
import { rateOn } from './finance.js';

export const TAX_DEFAULTS = {
  business_start: `${new Date().getFullYear()}-01-01`, // first day counted (GRA registration): set it in Impuestos
  nis_start: `${new Date().getFullYear()}-01`,       // first month NIS is owed (NIS registration): set it in Impuestos
  nis_rate: 12.5,               // % of the month's profit
  nis_cap_monthly: 280000,      // insurable earnings ceiling per month
  allowance_min: 1680000,       // personal allowance: the greater of this…
  allowance_fraction: 33.3333,  // …and this % of the taxable income
  band_limit: 3360000,          // chargeable income taxed at band1_rate, the rest at band2_rate
  band1_rate: 25,
  band2_rate: 35,
  reserve_pct: 25,              // suggested share of every payment received to set aside
  advance_override: {},         // { "2026": quarterly advance } when GRA sets a different amount
};

const KINDS = ['nis', 'income_advance', 'income_balance', 'penalty'];
const QUARTERS = [['Q1', '04-01'], ['Q2', '07-01'], ['Q3', '10-01'], ['Q4', '12-31']];

export function taxConfig() {
  return { ...TAX_DEFAULTS, ...getSetting('taxes', {}) };
}

export function saveTaxConfig(body) {
  const cfg = taxConfig();
  for (const k of Object.keys(TAX_DEFAULTS)) {
    if (body[k] === undefined) continue;
    if (k === 'business_start' && !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) throw new Error('business_start debe ser YYYY-MM-DD');
    if (k === 'nis_start' && !/^\d{4}-\d{2}$/.test(body[k])) throw new Error('nis_start debe ser YYYY-MM');
    if (k === 'advance_override') {
      cfg[k] = Object.fromEntries(Object.entries(body[k] || {}).filter(([, v]) => v !== '' && v != null).map(([y, v]) => [y, Number(v)]));
    } else if (typeof TAX_DEFAULTS[k] === 'number') {
      const n = Number(body[k]);
      if (!(n >= 0)) throw new Error(`${k} debe ser un número ≥ 0`);
      cfg[k] = n;
    } else cfg[k] = body[k];
  }
  setSetting('taxes', cfg);
  return cfg;
}

const nextMonth = m => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
};

/** Real income and spend of one month, counting only from the business start. */
function realMonth(month, cfg) {
  const from = [`${month}-01`, cfg.business_start].sort()[1];
  const to = `${nextMonth(month)}-01`;
  const receipts = db.prepare(`SELECT coalesce(paid_on, issue_date) day, currency, total FROM documents
    WHERE type = 'receipt' AND status != 'void' AND coalesce(paid_on, issue_date) >= ? AND coalesce(paid_on, issue_date) < ?`).all(from, to)
    .reduce((s, r) => s + (r.currency === 'GYD' ? r.total : Math.round(r.total * (rateOn(r.day) ?? 0))), 0);
  const other = db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM income WHERE received_on >= ? AND received_on < ?').pluck().get(from, to);
  const expenses = db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM expenses WHERE spent_on >= ? AND spent_on < ?').pluck().get(from, to);
  const income = receipts + other;
  return { income, expenses, profit: income - expenses };
}

/** Income tax on a year's taxable income (profit minus NIS paid). */
export function incomeTax(taxable, cfg = taxConfig()) {
  if (taxable <= 0) return 0;
  const allowance = Math.max(cfg.allowance_min, taxable * cfg.allowance_fraction / 100);
  const chargeable = Math.max(0, taxable - allowance);
  const low = Math.min(chargeable, cfg.band_limit);
  return Math.round(low * cfg.band1_rate / 100 + (chargeable - low) * cfg.band2_rate / 100);
}

const nisFor = (month, profit, cfg) =>
  month < cfg.nis_start ? 0 : Math.round(Math.min(Math.max(profit, 0), cfg.nis_cap_monthly) * cfg.nis_rate / 100);

/**
 * Month by month for one year up to the current month: profit, NIS, income tax attributed to the month
 * (year-to-date tax minus the previous month's) and net. Months before the business start are left out.
 */
export function yearView(year, cfg = taxConfig()) {
  const now = today().slice(0, 7);
  const start = cfg.business_start.slice(0, 7);
  const months = [];
  let ytdProfit = 0, ytdNis = 0, prevTax = 0;
  for (let i = 1; i <= 12; i++) {
    const month = `${year}-${String(i).padStart(2, '0')}`;
    if (month < start) continue;
    if (month > now) break;
    const r = realMonth(month, cfg);
    const nis = nisFor(month, r.profit, cfg);
    ytdProfit += r.profit;
    ytdNis += nis;
    const ytdTax = incomeTax(ytdProfit - ytdNis, cfg);
    months.push({ month, ...r, nis, income_tax: ytdTax - prevTax, net: r.profit - nis - (ytdTax - prevTax), running: month === now });
    prevTax = ytdTax;
  }
  const sum = k => months.reduce((n, m) => n + m[k], 0);
  return {
    year, months,
    totals: { income: sum('income'), expenses: sum('expenses'), profit: ytdProfit, nis: ytdNis, income_tax: prevTax, net: ytdProfit - ytdNis - prevTax,
      taxable: ytdProfit - ytdNis, allowance: Math.max(cfg.allowance_min, (ytdProfit - ytdNis) * cfg.allowance_fraction / 100) },
  };
}

/** NIS and income tax for a single month (Finanzas history). */
export function monthTax(month, cache = new Map()) {
  const year = month.slice(0, 4);
  if (!cache.has(year)) cache.set(year, yearView(Number(year)));
  return cache.get(year).months.find(m => m.month === month) ?? null;
}

const paidFor = (kind, period) =>
  db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM tax_payments WHERE kind = ? AND period = ?').pluck().get(kind, period);

function status(amount, paid, due, running) {
  if (running) return 'running';
  if (amount > 0 && paid >= amount) return 'paid';
  if (amount <= 0) return paid > 0 ? 'paid' : 'none';
  const t = today();
  if (due < t) return 'overdue';
  return Date.parse(due) - Date.parse(t) <= 14 * 86400e3 ? 'soon' : 'upcoming';
}

/** Quarterly advance for a year: GRA's figure if set, else last year's estimated tax ÷ 4 (0 in the first year). */
function advanceQuarter(year, cfg) {
  if (cfg.advance_override?.[year] != null) return Math.round(cfg.advance_override[year]);
  if (year - 1 < Number(cfg.business_start.slice(0, 4))) return 0;
  return Math.round(yearView(year - 1, cfg).totals.income_tax / 4);
}

/** Every due date of a year: NIS per month (day 15 of the next one), the four advances and the April return. */
export function calendar(year, cfg = taxConfig(), view = yearView(year, cfg)) {
  const items = [];
  for (const m of view.months) {
    if (m.month < cfg.nis_start) continue;
    const due = `${nextMonth(m.month)}-15`;
    const paid = paidFor('nis', m.month);
    items.push({ kind: 'nis', period: m.month, label: `NIS ${m.month}`, due, amount: m.nis, paid, status: status(m.nis, paid, due, m.running) });
  }
  const q = advanceQuarter(year, cfg);
  for (const [name, md] of QUARTERS) {
    const due = `${year}-${md}`;
    if (due < cfg.business_start) continue;
    const period = `${year}-${name}`;
    const paid = paidFor('income_advance', period);
    items.push({ kind: 'income_advance', period, label: `Pago adelantado ${name} ${year}`, due, amount: q, paid, status: status(q, paid, due) });
  }
  const advancesPaid = db.prepare("SELECT coalesce(sum(amount_gyd), 0) FROM tax_payments WHERE kind = 'income_advance' AND period LIKE ?").pluck().get(`${year}-%`);
  const balance = Math.max(0, view.totals.income_tax - advancesPaid);
  const due = `${year + 1}-04-30`;
  const paid = paidFor('income_balance', String(year));
  items.push({ kind: 'income_balance', period: String(year), label: `Declaración y saldo ${year}`, due, amount: balance, paid,
    status: status(balance, paid, due, year === Number(today().slice(0, 4))), estimate: true });
  return items.sort((a, b) => a.due.localeCompare(b.due));
}

/** What's still owed (NIS of finished months + income tax estimate − payments) for this year and the previous one. */
function owed(cfg) {
  const year = Number(today().slice(0, 4));
  let nis = 0, income = 0;
  for (const y of [year - 1, year]) {
    if (y < Number(cfg.business_start.slice(0, 4))) continue;
    const view = yearView(y, cfg);
    for (const m of view.months) if (m.month >= cfg.nis_start && !m.running) nis += Math.max(0, m.nis - paidFor('nis', m.month));
    const incomePaid = db.prepare("SELECT coalesce(sum(amount_gyd), 0) FROM tax_payments WHERE kind IN ('income_advance', 'income_balance') AND (period = ? OR period LIKE ?)").pluck().get(String(y), `${y}-%`);
    income += Math.max(0, view.totals.income_tax - incomePaid);
  }
  return { nis, income, total: nis + income };
}

/** Tax reserve account: deposits − withdrawals − taxes paid out of it, against what is owed. */
export function reserveStatus(cfg = taxConfig()) {
  const sum = kind => db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM owner_moves WHERE kind = ?').pluck().get(kind);
  const paidFromReserve = db.prepare('SELECT coalesce(sum(amount_gyd), 0) FROM tax_payments WHERE from_reserve = 1').pluck().get();
  const balance = sum('reserve_in') - sum('reserve_out') - paidFromReserve;
  const debt = owed(cfg);
  return { deposits: sum('reserve_in'), withdrawals: sum('reserve_out'), paid_from_reserve: paidFromReserve, balance, owed: debt, gap: debt.total - balance };
}

export function taxSummary(year) {
  const cfg = taxConfig();
  year = Number(year) || Number(today().slice(0, 4));
  const view = yearView(year, cfg);
  return {
    year, config: cfg, defaults: TAX_DEFAULTS, ...view,
    calendar: calendar(year, cfg, view),
    reserve: { ...reserveStatus(cfg), suggested_ytd: Math.round(view.totals.income * cfg.reserve_pct / 100) },
    payments: db.prepare("SELECT * FROM tax_payments WHERE substr(period, 1, 4) = ? OR substr(paid_on, 1, 4) = ? ORDER BY paid_on DESC, id DESC").all(String(year), String(year)),
    moves: db.prepare("SELECT * FROM owner_moves WHERE kind LIKE 'reserve_%' ORDER BY moved_on DESC, id DESC LIMIT 50").all(),
    first_year: Number(cfg.business_start.slice(0, 4)),
  };
}

export function addTaxPayment(body, actor) {
  const kind = body.kind;
  if (!KINDS.includes(kind)) throw new Error(`kind: ${KINDS.join(' | ')}`);
  const period = String(body.period || '');
  const ok = { nis: /^\d{4}-\d{2}$/, income_advance: /^\d{4}-Q[1-4]$/, income_balance: /^\d{4}$/, penalty: /^\d{4}$/ }[kind];
  if (!ok.test(period)) throw new Error(`period para ${kind}: ${{ nis: 'YYYY-MM', income_advance: 'YYYY-Qn', income_balance: 'YYYY', penalty: 'YYYY' }[kind]}`);
  const amount_gyd = Math.round(Number(body.amount_gyd));
  if (!(amount_gyd > 0)) throw new Error('amount_gyd debe ser mayor que 0');
  return insertRow('tax_payments', {
    kind, period, amount_gyd, paid_on: body.paid_on || today(), reference: body.reference || null, channel: body.channel || null,
    from_reserve: body.from_reserve === false || body.from_reserve === 0 ? 0 : 1, notes: body.notes || null,
  }, actor);
}

export const deleteTaxPayment = (id, actor) => {
  if (!getRow('tax_payments', id)) throw new Error('pago no encontrado');
  return deleteRow('tax_payments', id, actor);
};
