// MCP server exposing the CRM to Claude (stdio). Writes go through the HTTP API so they are audited
// (actor = claude) and the UI refreshes live.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DB_PATH } from './db.js';

const API = `http://127.0.0.1:${process.env.CRM_API_PORT || 4100}/api`;
const ro = new Database(DB_PATH, { readonly: true, fileMustExist: true });

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-actor': 'claude' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const tool = (name, description, inputSchema, fn) =>
  server.registerTool(name, { description, inputSchema }, async args => {
    try { const r = await fn(args); return r?.__content ? { content: r.__content } : ok(r); } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });

const server = new McpServer({ name: 'crm', version: '1.0.0' });

const STAGE = z.enum(['evaluated', 'demo_ready', 'msg1_sent', 'replied', 'demo_shown', 'negotiating', 'won', 'delivered', 'maintenance', 'lost', 'discarded']);
const clientFields = {
  company: z.string().optional(),
  slug: z.string().optional().describe('Short unique id, e.g. acme-ltd'),
  contact_name: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  website_url: z.string().optional().describe('Their original website'),
  facebook_url: z.string().optional(),
  sector: z.string().optional(),
  characterization: z.string().optional(),
  pain_points: z.array(z.string()).optional().describe('Replaces the whole list'),
  stage: STAGE.optional(),
  temperature: z.enum(['hot', 'warm', 'cold', 'fixed']).nullable().optional().describe('Manual override; fixed = cliente fijo (recurring client); null = automatic'),
  source: z.enum(['referral', 'facebook_ads', 'website_form', 'event', 'walk_in', 'other']).optional(),
  referrer_id: z.number().nullable().optional(),
  verdict: z.enum(['GO', 'MAYBE', 'NO']).optional(),
  est_price: z.number().optional(),
  est_currency: z.enum(['GYD', 'USD']).optional(),
  est_monthly: z.string().optional(),
  notes: z.string().optional(),
};

tool('crm_today', "Today's board: overdue/due/upcoming tasks, follow-ups, quiet hot leads, unpaid invoices.", {}, () => call('GET', '/today'));

tool('crm_search_clients', 'Search clients/prospects by name, contact, email, phone or slug. Empty query lists all.',
  { query: z.string().optional(), stage: STAGE.optional() },
  ({ query, stage }) => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (stage) p.set('stage', stage);
    return call('GET', `/clients?${p}`).then(rows => rows.map(c => ({
      id: c.id, company: c.company, stage: c.stage, temp: c.temp, contact: c.contact_name, whatsapp: c.whatsapp,
      email: c.email, last_contact_at: c.last_contact_at, open_actions: c.open_actions, balance: c.balance,
    })));
  });

tool('crm_get_client', 'Full client record with interactions, action items and documents.', { id: z.number() },
  async ({ id }) => {
    const [client, interactions, actions, documents] = await Promise.all([
      call('GET', `/clients/${id}`), call('GET', `/clients/${id}/interactions`),
      call('GET', `/actions?client_id=${id}`), call('GET', `/documents?client_id=${id}`),
    ]);
    return { client, interactions, actions, documents };
  });

tool('crm_create_client', 'Create a client or prospect.', { ...clientFields, company: z.string() }, args => call('POST', '/clients', args));
tool('crm_update_client', 'Update fields of a client (only the fields given). Changing stage logs it in the timeline.',
  { id: z.number(), ...clientFields }, ({ id, ...rest }) => call('PATCH', `/clients/${id}`, rest));

tool('crm_add_interaction', 'Log an interaction (message, call, meeting, note) on the client timeline.', {
  client_id: z.number(),
  channel: z.enum(['whatsapp', 'email', 'call', 'meeting', 'note']),
  direction: z.enum(['in', 'out']).optional().describe('in = they contacted the owner; out = the owner contacted them'),
  summary: z.string(),
  body: z.string().optional(),
  occurred_at: z.string().optional().describe('YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (UTC); default now'),
}, args => call('POST', '/interactions', args));

tool('crm_log_messages', `Log real WhatsApp/email messages (e.g. a chat the owner pastes) into the client's conversation, so it shows in the Inbox.
Use this for the actual messages; crm_add_interaction is only for summaries/notes on the timeline. Logs only — never sends anything.
Duplicates (same client, channel, sent_at, direction and body) are skipped. Inbound messages are unread unless read: true.`, {
  client_id: z.number(),
  messages: z.array(z.object({
    channel: z.enum(['whatsapp', 'email']),
    direction: z.enum(['in', 'out']).describe('in = they wrote to the owner; out = the owner wrote to them'),
    body: z.string(),
    sent_at: z.string().describe('UTC YYYY-MM-DD HH:MM:SS (Guyana local + 4h)'),
    subject: z.string().optional(),
    sender: z.string().optional(),
  })).min(1),
  read: z.boolean().optional().describe('Mark inbound messages as already read'),
}, async ({ client_id, messages, read }) => {
  const out = [];
  for (const m of messages) {
    const external_id = 'manual:' + crypto.createHash('sha1').update(`${client_id}|${m.channel}|${m.sent_at}|${m.direction}|${m.body}`).digest('hex');
    const row = await call('POST', '/messages', { ...m, client_id, external_id, ...(read && m.direction === 'in' ? { read_at: m.sent_at } : {}) });
    out.push(row ? { id: row.id, sent_at: m.sent_at, direction: m.direction } : { skipped: 'duplicate', sent_at: m.sent_at });
  }
  return out;
});

tool('crm_add_action','Create an action item (task, follow-up or delivery) optionally tied to a client.', {
  title: z.string(),
  client_id: z.number().optional(),
  kind: z.enum(['task', 'followup', 'delivery']).optional(),
  due_date: z.string().optional().describe('YYYY-MM-DD'),
  notes: z.string().optional(),
  effort: z.enum(['quick', 'medium', 'big']).optional().describe('Rough size (Tasks tab): quick = a moment (reply, call, confirm), medium = one sitting, big = a long session or several'),
}, args => call('POST', '/actions', args));

tool('crm_update_action', 'Update an action item (e.g. mark done, change date, size). status dropped = no longer applies.', {
  id: z.number(), title: z.string().optional(), status: z.enum(['open', 'done', 'dropped']).optional(),
  effort: z.enum(['quick', 'medium', 'big']).nullable().optional(),
  due_date: z.string().nullable().optional(), notes: z.string().optional(), kind: z.enum(['task', 'followup', 'delivery']).optional(),
}, ({ id, ...rest }) => call('PATCH', `/actions/${id}`, rest));

tool('crm_create_document', 'Issue a quote or invoice (number assigned automatically, PDF generated). Amounts are whole currency units.', {
  type: z.enum(['quote', 'invoice']),
  client_id: z.number(),
  currency: z.enum(['GYD', 'USD']).optional(),
  due_date: z.string().optional(),
  notes: z.string().optional().describe('Blank line = new paragraph; long notes flow onto the next PDF pages'),
  show_signature: z.boolean().optional().describe('Quotes: client/issuer signature block at the end of the PDF (default true)'),
  terms_page: z.boolean().optional().describe('Forced page break: notes (terms) + signature start on their own page after the lines and totals (default false)'),
  lines: z.array(z.object({
    description: z.string(), qty: z.number().default(1), unit_price: z.number(),
    vat_rate: z.number().optional().describe('0 = exempt (default), 0.14 = standard VAT'),
  })).min(1),
}, args => call('POST', '/documents', args));

tool('crm_invoice_from_quote', 'Invoice an accepted quote: 100% or a percentage (e.g. 50 for the deposit).', {
  quote_id: z.number(), percent: z.number().optional(), label: z.string().optional(),
}, ({ quote_id, ...rest }) => call('POST', `/documents/${quote_id}/invoice`, rest));

tool('crm_record_payment', 'Record a payment against an invoice and issue the receipt.', {
  invoice_id: z.number(), amount: z.number().optional().describe('Default: full balance'),
  payment_method: z.string().optional().describe('cash, bank transfer, cheque, mmg, other'), issue_date: z.string().optional(),
}, ({ invoice_id, ...rest }) => call('POST', `/documents/${invoice_id}/receipt`, rest));

tool('crm_delete_messages', `Delete messages from the Inbox by id (e.g. a duplicate: same text logged twice). Look them up first with crm_query on messages;
keep the synced one (source whatsapp_api/graph, external_id) over a manual copy. Audited and undoable from the chat.`, {
  ids: z.array(z.number()).min(1),
}, async ({ ids }) => {
  const out = [];
  for (const id of ids) out.push({ id, deleted: (await call('DELETE', `/messages/${id}`)).ok });
  return out;
});

tool('crm_batch', `Many writes in ONE call and one transaction (all-or-nothing). Prefer it over repeated single-row tools when filling data.
Tables: clients, interactions, actions. Columns = the same fields as the other crm_* tools (crm_query PRAGMA table_info(<table>) if unsure).
op: insert {data} | update {id or match, data} | upsert {match, data} (update if match finds a row, else insert match+data) | delete {id or match}.
match: column equality, text case-insensitive, e.g. {"slug":"acme"} or {"company":"Acme Ltd"}; must hit at most one row.
"$N" in data/match/id = id from op N of this batch, e.g. insert a client as op 0 then {"table":"interactions","op":"insert","data":{"client_id":"$0",...}}.
Client stage changes are logged in the timeline. Returns only [{i, t, id, did}].`, {
  ops: z.array(z.object({
    op: z.enum(['insert', 'update', 'upsert', 'delete']),
    table: z.enum(['clients', 'interactions', 'actions']),
    id: z.union([z.number(), z.string()]).optional(),
    match: z.record(z.string(), z.any()).optional(),
    data: z.record(z.string(), z.any()).optional(),
  })).min(1),
}, ({ ops }) => call('POST', '/batch', { ops }));

tool('crm_save_subscription', 'Create (no id) or update (id) a recurring OpEx item. kind: fixed (same amount every cycle) or variable (usage-based; amount = monthly estimate). amount = regular price per unit; for introductory discounts set promo_amount + promo_until.', {
  id: z.number().optional(), name: z.string().optional(), vendor: z.string().optional(),
  kind: z.enum(['fixed', 'variable']).optional(), amount: z.number().optional().describe('Per cycle, in currency (cents allowed)'),
  currency: z.enum(['USD', 'GYD']).optional(), cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
  next_due: z.string().nullable().optional().describe('YYYY-MM-DD'), active: z.boolean().optional(), notes: z.string().optional(),
  started_on: z.string().nullable().optional().describe('YYYY-MM-DD first purchase'),
  quantity: z.number().int().optional().describe('licences/seats; amount and promo_amount are per unit'),
  promo_amount: z.number().nullable().optional().describe('introductory price per unit per cycle'),
  promo_until: z.string().nullable().optional().describe('YYYY-MM-DD: regular `amount` applies from this day (e.g. renewal date)'),
}, ({ id, ...rest }) => (id ? call('PATCH', `/subscriptions/${id}`, rest) : call('POST', '/subscriptions', rest)));

tool('crm_pay_subscription', 'Record that a subscription cycle was paid: creates the expense at the current Demerara Bank USD→GYD rate and moves next_due one cycle.', {
  id: z.number(), amount: z.number().optional().describe('Default: the price of that day (promo or regular) × quantity; use the real one for variable'),
  spent_on: z.string().optional().describe('YYYY-MM-DD, default today'),
}, ({ id, ...rest }) => call('POST', `/subscriptions/${id}/pay`, rest));

tool('crm_add_expense', 'Record a one-off business expense (OpEx). Converted to GYD at the current Demerara Bank rate and stored with it. Claude API tokens are tracked automatically; do not add them.', {
  description: z.string(), amount: z.number(), currency: z.enum(['USD', 'GYD']).optional(),
  kind: z.enum(['fixed', 'variable']).optional().describe('default variable'), spent_on: z.string().optional(),
  subscription_id: z.number().optional(), notes: z.string().optional(),
  budget_line_id: z.number().optional().describe('only for a "tagged" budget line (e.g. Facebook Ads); otherwise it counts on the fixed/variable line'),
}, args => call('POST', '/expenses', args));

tool('crm_update_expense', 'Edit an expense (date, description, amount, currency, kind, notes). Keeps the original exchange rate unless the currency changes.', {
  id: z.number(), spent_on: z.string().optional().describe('YYYY-MM-DD'), description: z.string().optional(), amount: z.number().optional(),
  currency: z.enum(['USD', 'GYD']).optional(), kind: z.enum(['fixed', 'variable']).optional(), notes: z.string().optional(),
  budget_line_id: z.number().nullable().optional(),
}, ({ id, ...rest }) => call('PATCH', `/expenses/${id}`, rest));

tool('crm_taxes', 'Impuestos tab: NIS and GRA income tax estimated from real money (receipts + income − expenses; Claude tokens excluded) month by month with net, the due-date calendar with status (paid/overdue/soon/upcoming/none/running), payments made, the tax reserve account (balance vs owed) and the rules (settings). Estimates, not tax advice.', {
  year: z.number().optional().describe('default current year'),
}, ({ year }) => call('GET', `/taxes${year ? `?year=${year}` : ''}`));

tool('crm_tax_payment', 'Record a tax payment the owner made. kind nis (period YYYY-MM = the month it covers), income_advance (YYYY-Qn: Q1 1 Apr, Q2 1 Jul, Q3 1 Oct, Q4 31 Dec), income_balance (YYYY = the year of the return), penalty (YYYY). Not an expense: taxes are kept apart from OpEx.', {
  kind: z.enum(['nis', 'income_advance', 'income_balance', 'penalty']), period: z.string(), amount_gyd: z.number(),
  paid_on: z.string().optional().describe('YYYY-MM-DD, default today'), reference: z.string().optional(), channel: z.string().optional().describe('bank, GRA portal, GTT Mobile Money…'),
  from_reserve: z.boolean().optional().describe('paid from the tax reserve account (default true)'), notes: z.string().optional(),
}, args => call('POST', '/tax-payments', args));

tool('crm_budget', 'Presupuesto (Finanzas) of a month: each line planned vs actual (salary = salary paid, reserve = tax reserve deposits, fixed/variable = expenses of that kind, tagged = expenses tagged to the line), income received, what is left, expected recurring income.', {
  month: z.string().optional().describe('YYYY-MM, default current'),
}, ({ month }) => call('GET', `/budget${month ? `?month=${month}` : ''}`));

tool('crm_save_budget_line', 'Create (no id) or update (id) a monthly budget line. kind: salary (the owner\'s salary) | reserve (tax reserve deposits) | fixed | variable (expenses of that kind) | tagged (only expenses with this budget_line_id, e.g. Facebook Ads). Pause with active false.', {
  id: z.number().optional(), name: z.string().optional(), kind: z.enum(['salary', 'reserve', 'fixed', 'variable', 'tagged']).optional(),
  amount_gyd: z.number().optional().describe('per month'), active: z.boolean().optional(), position: z.number().optional(), notes: z.string().optional(),
}, ({ id, ...rest }) => (id ? call('PATCH', `/budget-lines/${id}`, rest) : call('POST', '/budget-lines', rest)));

tool('crm_owner_move', 'Money the owner moves out of the business: salary (their monthly pay), reserve_in (deposit into the tax reserve account), reserve_out (withdrawal from it). Not OpEx, not income.', {
  kind: z.enum(['salary', 'reserve_in', 'reserve_out']), amount_gyd: z.number(), moved_on: z.string().optional().describe('YYYY-MM-DD, default today'), notes: z.string().optional(),
}, args => call('POST', '/owner-moves', args));

tool('crm_list_debts', 'Debts both ways with balance and payments: receivable = someone owes the owner, payable = the owner owes. Also open totals in GYD.', {
  direction: z.enum(['receivable', 'payable']).optional(), client_id: z.number().optional(),
}, ({ direction, client_id }) => {
  const p = new URLSearchParams();
  if (direction) p.set('direction', direction);
  if (client_id) p.set('client_id', String(client_id));
  return call('GET', `/debts?${p}`);
});

tool('crm_save_debt', 'Create (no id) or update (id) a debt. direction: receivable (someone owes the owner) | payable (the owner owes). Give client_id for a CRM client or counterparty (name) for anyone else. Debts are not income/OpEx and never appear as such in Finanzas.', {
  id: z.number().optional(), direction: z.enum(['receivable', 'payable']).optional(),
  client_id: z.number().nullable().optional(), counterparty: z.string().optional(), description: z.string().optional(),
  amount: z.number().optional().describe('original principal in currency'), currency: z.enum(['USD', 'GYD']).optional().describe('default GYD'),
  started_on: z.string().optional().describe('YYYY-MM-DD, default today'), due_date: z.string().nullable().optional().describe('YYYY-MM-DD'),
  notes: z.string().optional(),
}, ({ id, ...rest }) => (id ? call('PATCH', `/debts/${id}`, rest) : call('POST', '/debts', rest)));

tool('crm_add_debt_payment', 'Record a (partial) payment on a debt, in the debt currency. Default: the whole remaining balance. Cannot exceed the balance.', {
  debt_id: z.number(), amount: z.number().optional(), paid_on: z.string().optional().describe('YYYY-MM-DD, default today'), notes: z.string().optional(),
}, ({ debt_id, ...rest }) => call('POST', `/debts/${debt_id}/payments`, rest));

tool('crm_add_income', 'Record income that is NOT a CRM receipt (cash, bank transfers, external receipt books). Counted in Finanzas with the receipts; never creates a document number. Leave fx_rate empty: USD converts at the current Demerara Bank rate. Pass fx_rate only when the money was really exchanged at another rate.', {
  description: z.string(), amount: z.number(), currency: z.enum(['USD', 'GYD']).optional().describe('default GYD'),
  fx_rate: z.number().optional().describe('only when the money was exchanged at a known rate other than the bank rate'), received_on: z.string().optional().describe('YYYY-MM-DD, default today'),
  payer: z.string().optional(), notes: z.string().optional(),
}, args => call('POST', '/income', args));

tool('crm_update_income', 'Edit an income row (date, payer, description, amount, currency, fx_rate, notes).', {
  id: z.number(), description: z.string().optional(), amount: z.number().optional(), currency: z.enum(['USD', 'GYD']).optional(),
  fx_rate: z.number().optional(), received_on: z.string().optional(), payer: z.string().optional(), notes: z.string().optional(),
}, ({ id, ...rest }) => call('PATCH', `/income/${id}`, rest));

tool('crm_list_plans', 'Recurring income plans of clients (maintenance, hosting, support): amount per cycle, next_due, last invoice, monthly GYD equivalent; plus totals.mrr_gyd (active recurring income per month in GYD).', {
  client_id: z.number().optional(),
}, ({ client_id }) => call('GET', `/plans${client_id ? `?client_id=${client_id}` : ''}`));

tool('crm_save_plan', 'Create (no id) or update (id) a client\'s recurring income plan. name goes on the invoice line, in English (e.g. "Website maintenance"). next_due = start of the next cycle to bill (default started_on, default today). Pause with active: false; plans with invoices cannot be deleted.', {
  id: z.number().optional(), client_id: z.number().optional(), name: z.string().optional(),
  amount: z.number().optional().describe('per cycle, whole currency units'), currency: z.enum(['GYD', 'USD']).optional().describe('default GYD'),
  cycle: z.enum(['days15', 'monthly', 'quarterly', 'yearly']).optional().describe('days15 = every 15 days (≈ 2 per month); default monthly'),
  started_on: z.string().optional().describe('YYYY-MM-DD'), next_due: z.string().nullable().optional().describe('YYYY-MM-DD'),
  active: z.boolean().optional(), notes: z.string().optional(),
  billing: z.enum(['crm', 'external']).optional().describe('where cycles are invoiced; external = another platform'),
  billing_platform: z.string().optional().describe('e.g. Remote'),
}, ({ id, ...rest }) => (id ? call('PATCH', `/plans/${id}`, rest) : call('POST', '/plans', rest)));

tool('crm_invoice_plan', `Bill the next cycle of a recurring plan (period starting at next_due; next_due moves one cycle).
CRM (external false): issues an invoice (new INV number, PDF); income when paid with crm_record_payment.
External (external true; default = the plan's billing): billed on another platform , no INV number;
stays open as an external invoice until crm_external_invoice_paid. Platform defaults to the plan's billing_platform.`, {
  id: z.number(), external: z.boolean().optional(), platform: z.string().optional().describe('external: Remote, Deel…'),
  reference: z.string().optional().describe('external: invoice number on that platform'),
  amount: z.number().optional().describe('default: the plan amount'), due_date: z.string().optional().describe('CRM: YYYY-MM-DD'),
  issue_date: z.string().optional().describe('YYYY-MM-DD, default today'), notes: z.string().optional(),
}, ({ id, ...rest }) => call('POST', `/plans/${id}/invoice`, rest));

tool('crm_list_external_invoices', 'Plan cycles billed on other platforms (Remote, Deel…). status: issued (open, por cobrar) | paid | void.', {
  status: z.enum(['issued', 'paid', 'void']).optional(), client_id: z.number().optional(),
}, ({ status, client_id }) => {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (client_id) p.set('client_id', String(client_id));
  return call('GET', `/external-invoices?${p}`);
});

tool('crm_external_invoice_paid', 'Record the payment of an open external invoice: creates the income row and marks it paid. USD always converts at the Demerara Bank rate (of received_on). Do not also call crm_add_income for it.', {
  id: z.number(), amount: z.number().optional().describe('default: the invoice amount'), currency: z.enum(['USD', 'GYD']).optional(),
  received_on: z.string().optional().describe('YYYY-MM-DD, default today'), notes: z.string().optional(),
}, ({ id, ...rest }) => call('POST', `/external-invoices/${id}/paid`, rest));

tool('crm_attach_expense_pdf', 'Attach a local PDF (proof of payment / invoice from the vendor) to an expense. Replaces any previous one.', {
  expense_id: z.number(), path: z.string().describe('absolute path to the PDF on this machine'),
}, async ({ expense_id, path }) => {
  const res = await fetch(`${API}/expenses/${expense_id}/receipt?name=${encodeURIComponent(path.split('/').pop())}`, {
    method: 'POST', headers: { 'content-type': 'application/pdf', 'x-actor': 'claude' }, body: fs.readFileSync(path),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
});

tool('crm_attach_external_invoice_pdf', 'Attach a local PDF of an external invoice (the one issued on the other platform; id from crm_list_external_invoices). Shown in Documentos and on the client. Replaces any previous one.', {
  external_invoice_id: z.number(), path: z.string().describe('absolute path to the PDF on this machine'),
}, async ({ external_invoice_id, path }) => {
  const res = await fetch(`${API}/external-invoices/${external_invoice_id}/pdf?name=${encodeURIComponent(path.split('/').pop())}`, {
    method: 'POST', headers: { 'content-type': 'application/pdf', 'x-actor': 'claude' }, body: fs.readFileSync(path),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
});

tool('crm_query','Run a read-only SQL query on the CRM database (SQLite). Tables: clients, interactions, messages, action_items, documents, document_lines, settings, audit_log, subscriptions, expenses (budget_line_id), income, debts, debt_payments, tax_payments, owner_moves (salary / reserve_in / reserve_out), budget_lines, client_plans (recurring income; documents.plan_id), external_invoices (plan cycles billed on another platform; income_id when paid; pdf_name when its PDF is attached), fx_rates, chats, chat_messages (cost_usd, cost_gyd, tokens per turn), notes, scheduled_jobs, scheduled_runs, (times in UTC; Guyana = UTC-4).',
  { sql: z.string() }, ({ sql }) => {
    const stmt = ro.prepare(sql);
    if (!stmt.reader) throw new Error('Only SELECT queries are allowed here; use the crm_* tools to write.');
    return stmt.all().slice(0, 200);
  });

tool('crm_document_pdf', 'Get the PDF of an issued quote/invoice/receipt (by document id). In WhatsApp chats the PDF is sent to the owner automatically after your reply; in the panel it returns the path.',
  { document_id: z.number() }, ({ document_id }) => call('POST', `/documents/${document_id}/pdf-file`));

tool('crm_save_sow', 'Scope of Work, Terms and Acceptance for a quote: renders it in English, already signed with the saved signature (Integraciones → Emisor y firma), and saves it in Contratos y Acuerdos (kind sow) on the client. ALWAYS use this for SOWs, never crm_make_report. One per quote: "Phase 1" (core build) and "Phase 2 and services" (extensions, initial costs, maintenance). Same quote + phase replaces the file (no duplicates). terms omitted = standard template (Ownership, Credit, Not included, Dates, Validity) + extra_terms; crm_sow_template shows it. In WhatsApp chats the PDF is sent to the owner automatically.',
  {
    quote_id: z.number().optional(), quote_number: z.string().optional().describe('e.g. QUO-000010 (if no quote_id)'),
    phase: z.string().describe('"Phase 1" | "Phase 2 and services" | ...'),
    client_label: z.string().optional().describe('How the client is named in the text, e.g. "the Guyana Learning Channel" (default: company)'),
    project: z.string().describe('What is built in this phase (one or two sentences)'),
    project_short: z.string().optional().describe('Short project name for the subtitle, e.g. "Quiz mobile application"'),
    start: z.string().optional().describe('e.g. "once the first payment is received (estimated 1 November 2026)."'),
    delivery: z.string().optional().describe('e.g. "estimated 1 December 2026. The date is an estimate..."'),
    items_heading: z.string().optional().describe('Default "Action items"; "Action items and services" for phase 2'),
    items: z.array(z.object({ no: z.string().optional(), item: z.string(), deliverable: z.string(), due: z.string().optional() })).min(1),
    payments: z.array(z.object({ when: z.string(), amount: z.number() })).min(1).describe('Must add up to the quote total'),
    currency: z.string().optional(),
    maintenance: z.array(z.string()).optional().describe('Bullets of the monthly maintenance section (phase 2)'),
    terms: z.array(z.object({ title: z.string(), text: z.string() })).optional().describe('Full list, replaces the template; {client} and {validity} are filled'),
    extra_terms: z.array(z.object({ title: z.string(), text: z.string() })).optional().describe('Appended to the template terms'),
    notes: z.string().optional().describe('Note on the Contratos row (Spanish)'),
  },
  args => call('POST', '/sow', args));

tool('crm_sow_template', 'The standard Scope of Work template (terms used by crm_save_sow when none are passed).', {}, () => call('GET', '/sow/template'));

const NOTE_KIND = z.enum(['idea', 'info', 'methodology', 'reference']);
tool('crm_save_note', 'Save knowledge the owner gives you that is not a client field or a task: idea = business idea; info = facts/information; methodology = how to work/deliver (for a client: set client_id); reference = links, contacts, resources. Pass id to update an existing note (search first to avoid duplicates; append to it rather than creating a near-copy).',
  {
    id: z.number().optional(),
    kind: NOTE_KIND.optional(),
    title: z.string().optional().describe('Short, searchable'),
    body: z.string().optional().describe('Full content in the owner\'s words, cleaned up; replaces the body when updating'),
    client_id: z.number().nullable().optional(),
    tags: z.string().optional().describe('comma separated'),
  },
  ({ id, ...note }) => id ? call('PATCH', `/notes/${id}`, note)
    : call('POST', '/notes', { kind: 'info', ...note, source: process.env.CRM_CHAT ? 'chat' : 'mcp' }));

tool('crm_search_notes', 'Search Notas (ideas, info, methodology, references) by text, kind or client.',
  { query: z.string().optional(), kind: NOTE_KIND.optional(), client_id: z.number().optional() },
  ({ query, kind, client_id }) => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (kind) p.set('kind', kind);
    if (client_id) p.set('client_id', String(client_id));
    return call('GET', `/notes?${p}`);
  });

const SCRIPT_STATUS = z.enum(['draft', 'ready', 'recorded', 'published']);
const JOB_KIND = z.enum(['reminder', 'briefing', 'task']);
const jobFields = {
  title: z.string().optional().describe('Short label, e.g. "Briefing 7 pm" or "Llamar a Eddie"'),
  prompt: z.string().optional().describe('briefing/task: full self-contained instruction for that future run (it starts without this conversation). reminder: optional extra text.'),
  run_at: z.string().optional().describe('One-shot, Guyana local time "YYYY-MM-DD HH:MM"'),
  cron: z.string().optional().describe('Recurring, 5 fields in Guyana time: "min hour day month weekday" (0=Sun), e.g. "0 7 * * *", "0 19 * * 1-5"'),
  deliver: z.enum(['whatsapp', 'panel']).optional().describe('whatsapp (default) = the owner\'s phone + CRM panel; panel = CRM only'),
  mode: z.enum(['edit', 'build']).nullable().optional().describe('Chat mode for Claude runs; default edit'),
  client_id: z.number().nullable().optional(),
};

tool('crm_schedule_job', 'Schedule something for later (Programados): reminder = message to the owner; briefing / task = Claude runs prompt at that time and sends the owner the result. Times are Guyana local. Returns the job with next_run_local.',
  { kind: JOB_KIND, ...jobFields, title: z.string() }, args => call('POST', '/jobs', args));

tool('crm_list_jobs', 'Scheduled jobs (Programados) with next/last run in Guyana time; with job_id also its recent runs (output, errors).',
  { status: z.enum(['active', 'paused', 'done', 'cancelled']).optional(), job_id: z.number().optional() },
  async ({ status, job_id }) => job_id
    ? { job: (await call('GET', '/jobs')).find(j => j.id === job_id), runs: await call('GET', `/jobs/${job_id}/runs`) }
    : call('GET', `/jobs${status ? `?status=${status}` : ''}`));

tool('crm_update_job', 'Change a scheduled job: new time (run_at or cron), text, delivery, or status paused / active / cancelled.',
  { id: z.number(), ...jobFields, status: z.enum(['active', 'paused', 'cancelled']).optional() },
  ({ id, ...rest }) => call('PATCH', `/jobs/${id}`, rest));

tool('crm_make_report', 'Build a report file for the owner: pdf (to read) or xlsx (data to filter/edit; each table becomes a sheet). Content in English or Spanish as asked. In WhatsApp chats the file is sent to them automatically after your reply. Returns the file path.',
  {
    format: z.enum(['pdf', 'xlsx']),
    title: z.string(),
    subtitle: z.string().optional(),
    sections: z.array(z.object({
      page_break: z.boolean().optional().describe('Start this section on a new page'),
      keep_together: z.boolean().optional().describe('Never split this section across pages (e.g. a signature table); must fit on one page'),
      heading: z.string().optional(),
      text: z.string().optional().describe('Paragraphs; "- " bullets; **bold**'),
      table: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).describe('Numbers as numbers (money in whole units)'),
      }).optional(),
    })).min(1),
  },
  args => call('POST', '/reports', args));

await server.connect(new StdioServerTransport());
