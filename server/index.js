import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { db, bus, migrate, watchExternalWrites, insertRow, updateRow, deleteRow, getRow, getSetting, setSetting, changed } from './db.js';
import { STAGES, listClients, getClient, todayBoard } from './domain.js';
import fs from 'node:fs';
import { generatePdf } from './pdf.js';
import { makeReport } from './reports.js';
import path from 'node:path';
import { addMessage, listThreads, threadMessages, markRead, assignThread, ignoreThread, listIgnored, exportSenders, detectDayFirst, importWhatsAppExport, threadKeyFor, matchClient, digits } from './messages.js';
import { runBatch } from './batch.js';
import { financeSummary, saveSubscription, addExpense, updateExpense, paySubscription, attachReceipt, listExpenses, listIncome, addIncome, updateIncome } from './finance.js';
import { currentRate } from './fx.js';
import { listContracts, attachContractFile } from './contracts.js';
import { saveSow, sowTemplate } from './sow.js';
import { taxSummary, addTaxPayment, deleteTaxPayment, saveTaxConfig } from './taxes.js';
import { budgetMonth, saveBudgetLine, deleteBudgetLine, addOwnerMove, deleteOwnerMove } from './budget.js';
import { listDebts, getDebt, debtTotals, debtsDue, saveDebt, deleteDebt, addDebtPayment } from './debts.js';
import { listPlans, planTotals, plansDue, savePlan, deletePlan, invoicePlan, listExternal, markExternalPaid, voidExternal, attachExternalPdf } from './plans.js';
import { listJobs, jobRuns, saveJob, draftApproved, jobsConfig, saveJobsConfig } from './jobs.js';
import * as push from './push.js';
import { listDocuments, getDocument, createDocument, receiptForInvoice, invoiceFromQuote } from './documents.js';
import { getContext, explainTask, estimateEfforts } from './taskcontext.js';

migrate();
watchExternalWrites();

const app = new Hono().basePath('/api');
const actor = c => c.req.header('x-actor') || 'ui';
const id = c => Number(c.req.param('id'));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 400);
});

app.get('/meta', c => c.json({ stages: STAGES, issuer: getSetting('issuer') }));
// Emisor y firma (Integraciones card): issuer data printed on every PDF + the owner's signature (PNG/JPEG data URL, ≤ 400 KB).
// Not audited (like the other settings); already generated PDFs are not re-rendered.
const ISSUER_FIELDS = ['name', 'address', 'phone', 'email', 'tin', 'footer', 'vat_note', 'signer_name', 'signer_title'];
app.get('/issuer', c => c.json(getSetting('issuer', {})));
app.put('/issuer', async c => {
  const body = await c.req.json();
  const next = { ...getSetting('issuer', {}) };
  for (const k of ISSUER_FIELDS) if (typeof body[k] === 'string') next[k] = body[k].trim();
  if (body.sign_all !== undefined) next.sign_all = !!body.sign_all;
  if (body.signature !== undefined) {
    if (body.signature && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.signature)) throw new Error('La firma debe ser una imagen PNG o JPG');
    if (body.signature && body.signature.length > 550_000) throw new Error('La imagen de la firma es muy grande (máx. 400 KB)');
    next.signature = body.signature || '';
  }
  if (body.logo !== undefined) {
    if (body.logo && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(body.logo)) throw new Error('El logo debe ser una imagen PNG o JPG');
    if (body.logo && body.logo.length > 550_000) throw new Error('El logo es muy grande (máx. 400 KB)');
    next.logo = body.logo || '';
  }
  setSetting('issuer', next);
  return c.json(next);
});
// PWA push notifications (Integraciones → Notificaciones; web/public/sw.js shows them).
app.get('/push', c => c.json(push.status()));
app.post('/push/config', async c => c.json(push.configure(await c.req.json())));
app.post('/push/subscribe', async c => c.json(push.subscribe(await c.req.json(), c.req.header('user-agent'))));
app.post('/push/unsubscribe', async c => c.json(push.unsubscribe(await c.req.json())));
app.post('/push/test', async c => c.json({ sent: await push.notify(null, { title: 'CRM', body: 'Las notificaciones funcionan ✅', url: '/settings', tag: 'test' }) }));
app.get('/today', c => c.json({ ...todayBoard(), debts_due: debtsDue(), plans_due: plansDue(), external_unpaid: listExternal({ status: 'issued' }) }));

// Server-sent events: the UI invalidates its queries on every change.
app.get('/events', c => streamSSE(c, async stream => {
  const onChange = e => stream.writeSSE({ event: 'change', data: JSON.stringify(e) });
  await stream.writeSSE({ event: 'hello', data: '' }); // flush headers through proxies
  bus.on('change', onChange);
  const ping = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }), 25000);
  await new Promise(resolve => stream.onAbort(resolve));
  clearInterval(ping);
  bus.off('change', onChange);
}));

// Clients
app.get('/clients', c => c.json(listClients({ q: c.req.query('q'), stage: c.req.query('stage') })));
app.get('/clients/:id', c => {
  const client = getClient(id(c));
  return client ? c.json(client) : c.json({ error: 'not found' }, 404);
});
function normalizeClient(body) {
  if (Array.isArray(body.pain_points)) body.pain_points = JSON.stringify(body.pain_points);
  return body;
}
app.post('/clients', async c => {
  const row = insertRow('clients', normalizeClient(await c.req.json()), actor(c));
  return c.json(getClient(row.id), 201);
});
app.patch('/clients/:id', async c => {
  const body = normalizeClient(await c.req.json());
  const before = getRow('clients', id(c));
  if (!before) return c.json({ error: 'not found' }, 404);
  updateRow('clients', id(c), body, actor(c));
  if (body.stage && body.stage !== before.stage) {
    const label = k => STAGES.find(s => s.key === k)?.label ?? k;
    insertRow('interactions', { client_id: id(c), channel: 'system', summary: `Etapa: ${label(before.stage)} → ${label(body.stage)}` }, actor(c));
  }
  return c.json(getClient(id(c)));
});
app.delete('/clients/:id', c => c.json({ ok: deleteRow('clients', id(c), actor(c)) }));

// Interactions
app.get('/clients/:id/interactions', c => c.json(
  db.prepare('SELECT * FROM interactions WHERE client_id = ? ORDER BY occurred_at DESC, id DESC').all(id(c))
));
app.post('/interactions', async c => c.json(insertRow('interactions', await c.req.json(), actor(c)), 201));
app.patch('/interactions/:id', async c => c.json(updateRow('interactions', id(c), await c.req.json(), actor(c))));
app.delete('/interactions/:id', c => c.json({ ok: deleteRow('interactions', id(c), actor(c)) }));

// Action items
app.get('/actions', c => {
  const { client_id, status } = c.req.query();
  const where = [];
  const p = {};
  if (client_id) { where.push('a.client_id = @client_id'); p.client_id = Number(client_id); }
  if (status) { where.push('a.status = @status'); p.status = status; }
  return c.json(db.prepare(`SELECT a.*, c.company FROM action_items a LEFT JOIN clients c ON c.id = a.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.status, a.due_date IS NULL, a.due_date, a.id`).all(p));
});
app.post('/actions', async c => c.json(insertRow('action_items', await c.req.json(), actor(c)), 201));
app.patch('/actions/:id', async c => {
  const body = await c.req.json();
  if (body.status === 'done' || body.status === 'dropped') body.done_at = new Date().toISOString();
  if (body.status === 'open') body.done_at = null;
  return c.json(updateRow('action_items', id(c), body, actor(c)));
});
// Tasks tab: Sonnet sizes every open task without effort (quick | medium | big). Waits for the answer (~30-60 s).
app.post('/actions/estimate', async c => c.json(await estimateEfforts(actor(c))));
// Contexto: Sonnet explains what a task is about (server/taskcontext.js); POST waits for the answer (~20-60 s).
app.get('/actions/:id/context', c => c.json(getContext(id(c))));
app.post('/actions/:id/context', async c => c.json(await explainTask(id(c))));
app.delete('/actions/:id', c => c.json({ ok: deleteRow('action_items', id(c), actor(c)) }));

// Documents
app.get('/documents', c => c.json(listDocuments({ client_id: c.req.query('client_id'), type: c.req.query('type') })));
app.get('/documents/:id', c => c.json(getDocument(id(c))));
// Every newly issued document gets its PDF right away; the invoice PDF is refreshed when a payment lands.
async function withPdf(doc) {
  await generatePdf(doc.id).catch(e => console.error('[pdf]', e.message));
  if (doc.type === 'receipt' && doc.related_id) await generatePdf(doc.related_id, { force: true }).catch(e => console.error('[pdf]', e.message));
  return getDocument(doc.id);
}
app.post('/documents', async c => c.json(await withPdf(createDocument(await c.req.json(), actor(c))), 201));
app.post('/documents/:id/receipt', async c => c.json(await withPdf(receiptForInvoice(id(c), await c.req.json().catch(() => ({})), actor(c))), 201));
app.post('/documents/:id/invoice', async c => c.json(await withPdf(invoiceFromQuote(id(c), await c.req.json().catch(() => ({})), actor(c))), 201));
app.get('/documents/:id/pdf', async c => {
  if (!getRow('documents', id(c))) return c.json({ error: 'not found' }, 404);
  await generatePdf(id(c));
  const doc = getRow('documents', id(c));
  return c.body(fs.readFileSync(doc.pdf_path), 200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${doc.number}.pdf"` });
});
app.post('/reports', async c => c.json(await makeReport(await c.req.json()), 201));
// Local path of a document's PDF (crm_document_pdf): in WhatsApp chats the file is sent to the owner after the turn.
app.post('/documents/:id/pdf-file', async c => {
  const doc = getRow('documents', id(c));
  if (!doc) return c.json({ error: 'document not found' }, 404);
  return c.json({ report_file: await generatePdf(doc.id), name: `${doc.number}.pdf`, number: doc.number, status: doc.status });
});

// Programados: scheduled emails, reminders, hunts, briefings (server/jobs.js; run by scheduler.js in the chat worker).
app.get('/jobs', c => c.json(listJobs({ status: c.req.query('status') })));
app.get('/jobs/config', c => c.json(jobsConfig()));
app.put('/jobs/config', async c => c.json(saveJobsConfig(await c.req.json())));
app.post('/jobs', async c => c.json(saveJob(null, await c.req.json(), actor(c)), 201));
app.patch('/jobs/:id', async c => c.json(saveJob(id(c), await c.req.json(), actor(c))));
app.delete('/jobs/:id', c => c.json({ ok: deleteRow('scheduled_jobs', id(c), actor(c)) }));
app.get('/jobs/:id/runs', c => c.json(jobRuns(id(c))));

// Notas: ideas, information and methodology the owner dictates (per client or general).
app.get('/notes', c => {
  const { client_id, kind, q } = c.req.query();
  const where = ['1 = 1'];
  if (client_id) where.push('n.client_id = @client_id');
  if (kind) where.push('n.kind = @kind');
  if (q) where.push("(n.title LIKE @q OR n.body LIKE @q OR n.tags LIKE @q OR c.company LIKE @q)");
  return c.json(db.prepare(`SELECT n.*, c.company FROM notes n LEFT JOIN clients c ON c.id = n.client_id
    WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC LIMIT 500`).all({ client_id, kind, q: `%${q ?? ''}%` }));
});
app.post('/notes', async c => c.json(insertRow('notes', await c.req.json(), actor(c)), 201));
app.patch('/notes/:id', async c => c.json(updateRow('notes', id(c), await c.req.json(), actor(c))));
app.delete('/notes/:id', c => c.json({ ok: deleteRow('notes', id(c), actor(c)) }));

app.patch('/documents/:id', async c => {
  // paid_on only moves the receipt in Finanzas; number and issue_date of an issued document never change.
  const { status, notes, due_date, paid_on, show_signature, terms_page } = await c.req.json();
  const sig = show_signature === undefined ? undefined : show_signature ? 1 : 0;
  const tp = terms_page === undefined ? undefined : terms_page ? 1 : 0;
  const row = updateRow('documents', id(c), { status, notes, due_date, paid_on, show_signature: sig, terms_page: tp }, actor(c));
  // Toggling a quote's signature block or the terms page re-renders its PDF (receipts imported as PDFs are left alone).
  if (row && row.type !== 'receipt' && (sig !== undefined || tp !== undefined)) await generatePdf(row.id, { force: true }).catch(e => console.error('[pdf]', e.message));
  return c.json(row);
});

// Finance
app.get('/finance', async c => c.json(await financeSummary(c.req.query('month'))));
app.get('/fx', async c => c.json(await currentRate({ force: c.req.query('refresh') === '1' })));
app.post('/subscriptions', async c => c.json(saveSubscription(null, await c.req.json(), actor(c)), 201));
app.patch('/subscriptions/:id', async c => c.json(saveSubscription(id(c), await c.req.json(), actor(c))));
app.delete('/subscriptions/:id', c => c.json({ ok: deleteRow('subscriptions', id(c), actor(c)) }));
app.post('/subscriptions/:id/pay', async c => c.json(await paySubscription(id(c), await c.req.json().catch(() => ({})), actor(c)), 201));
app.get('/expenses', c => c.json(listExpenses(c.req.query('from'), c.req.query('to'))));
app.post('/expenses', async c => c.json(await addExpense(await c.req.json(), actor(c)), 201));
app.patch('/expenses/:id', async c => c.json(await updateExpense(id(c), await c.req.json(), actor(c))));
// Proof of payment: raw PDF body, original file name in ?name=
app.post('/expenses/:id/receipt', async c =>
  c.json(attachReceipt(id(c), Buffer.from(await c.req.arrayBuffer()), c.req.query('name'), actor(c)), 201));
app.get('/expenses/:id/receipt', c => {
  const e = getRow('expenses', id(c));
  if (!e?.receipt_path || !fs.existsSync(e.receipt_path)) return c.json({ error: 'sin comprobante' }, 404);
  const name = (e.receipt_name || `gasto-${e.id}.pdf`).replace(/"/g, '');
  return c.body(fs.readFileSync(e.receipt_path), 200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"` });
});
app.delete('/expenses/:id/receipt', c => c.json(updateRow('expenses', id(c), { receipt_path: null, receipt_name: null }, actor(c))));
app.delete('/expenses/:id', c => c.json({ ok: deleteRow('expenses', id(c), actor(c)) }));
app.get('/income', c => c.json(listIncome(c.req.query('from'), c.req.query('to'))));
app.post('/income', async c => c.json(await addIncome(await c.req.json(), actor(c)), 201));
app.patch('/income/:id', async c => c.json(await updateIncome(id(c), await c.req.json(), actor(c))));
app.delete('/income/:id', c => c.json({ ok: deleteRow('income', id(c), actor(c)) }));

// Impuestos (server/taxes.js): estimates, calendar, payments made, reserve account; rules in settings.taxes.
app.get('/taxes', c => c.json(taxSummary(c.req.query('year'))));
app.put('/taxes/config', async c => c.json(saveTaxConfig(await c.req.json())));
app.post('/tax-payments', async c => c.json(addTaxPayment(await c.req.json(), actor(c)), 201));
app.delete('/tax-payments/:id', c => c.json({ ok: deleteTaxPayment(id(c), actor(c)) }));
// Presupuesto (server/budget.js) and owner moves: salary, tax reserve deposits/withdrawals.
app.get('/budget', c => c.json(budgetMonth(c.req.query('month'))));
app.post('/budget-lines', async c => c.json(saveBudgetLine(null, await c.req.json(), actor(c)), 201));
app.patch('/budget-lines/:id', async c => c.json(saveBudgetLine(id(c), await c.req.json(), actor(c))));
app.delete('/budget-lines/:id', c => c.json({ ok: deleteBudgetLine(id(c), actor(c)) }));
app.post('/owner-moves', async c => c.json(addOwnerMove(await c.req.json(), actor(c)), 201));
app.delete('/owner-moves/:id', c => c.json({ ok: deleteOwnerMove(id(c), actor(c)) }));

// Contratos y Acuerdos
app.get('/contracts', c => c.json(listContracts({ client_id: c.req.query('client_id') })));
app.post('/contracts', async c => c.json(insertRow('contracts', await c.req.json(), actor(c)), 201));
app.patch('/contracts/:id', async c => c.json(updateRow('contracts', id(c), await c.req.json(), actor(c))));
app.delete('/contracts/:id', c => c.json({ ok: deleteRow('contracts', id(c), actor(c)) }));
// Scope of Work signed by the owner (server/sow.js, crm_save_sow) → a 'sow' row here; template in settings.sow_template.
app.post('/sow', async c => c.json(await saveSow(await c.req.json(), actor(c)), 201));
app.get('/sow/template', c => c.json(sowTemplate()));
// Signed file: raw body, original file name in ?name=
app.post('/contracts/:id/file', async c =>
  c.json(attachContractFile(id(c), Buffer.from(await c.req.arrayBuffer()), c.req.query('name'), actor(c)), 201));
app.get('/contracts/:id/file', c => {
  const k = getRow('contracts', id(c));
  if (!k?.file_path || !fs.existsSync(k.file_path)) return c.json({ error: 'sin archivo' }, 404);
  const name = (k.file_name || `contrato-${k.id}`).replace(/"/g, '');
  const disposition = k.file_type?.includes('word') ? 'attachment' : 'inline';
  return c.body(fs.readFileSync(k.file_path), 200, { 'content-type': k.file_type || 'application/pdf', 'content-disposition': `${disposition}; filename="${name}"` });
});

// Deudas (me deben / yo debo) and their payments
app.get('/debts', c => c.json({ debts: listDebts({ direction: c.req.query('direction'), client_id: c.req.query('client_id') }), totals: debtTotals() }));
app.get('/debts/:id', c => c.json(getDebt(id(c))));
app.post('/debts', async c => c.json(saveDebt(null, await c.req.json(), actor(c)), 201));
app.patch('/debts/:id', async c => c.json(saveDebt(id(c), await c.req.json(), actor(c))));
app.delete('/debts/:id', c => c.json({ ok: deleteDebt(id(c), actor(c)) }));
app.post('/debts/:id/payments', async c => c.json(addDebtPayment(id(c), await c.req.json().catch(() => ({})), actor(c)), 201));
app.delete('/debt-payments/:id', c => c.json({ ok: deleteRow('debt_payments', id(c), actor(c)) }));

// Ingresos recurrentes: client plans (server/plans.js); billing a cycle issues an invoice and moves next_due.
app.get('/plans', c => c.json({ plans: listPlans({ client_id: c.req.query('client_id') }), totals: planTotals() }));
app.post('/plans', async c => c.json(savePlan(null, await c.req.json(), actor(c)), 201));
app.patch('/plans/:id', async c => c.json(savePlan(id(c), await c.req.json(), actor(c))));
app.delete('/plans/:id', c => c.json({ ok: deletePlan(id(c), actor(c)) }));
app.post('/plans/:id/invoice', async c => {
  const r = invoicePlan(id(c), await c.req.json().catch(() => ({})), actor(c));
  return c.json(r.external ? r : await withPdf(r), 201);
});
// Cycles billed on another platform (Remote…): open until paid; payment → income row.
app.get('/external-invoices', c => c.json(listExternal({ status: c.req.query('status'), client_id: c.req.query('client_id') })));
app.post('/external-invoices/:id/paid', async c => c.json(await markExternalPaid(id(c), await c.req.json().catch(() => ({})), actor(c))));
app.post('/external-invoices/:id/void', c => c.json(voidExternal(id(c), actor(c))));
// PDF of the external invoice: raw PDF body, original file name in ?name=
app.post('/external-invoices/:id/pdf', async c =>
  c.json(attachExternalPdf(id(c), Buffer.from(await c.req.arrayBuffer()), c.req.query('name'), actor(c)), 201));
app.get('/external-invoices/:id/pdf', c => {
  const e = getRow('external_invoices', id(c));
  if (!e?.pdf_path || !fs.existsSync(e.pdf_path)) return c.json({ error: 'sin PDF' }, 404);
  const name = (e.pdf_name || `factura-externa-${e.id}.pdf`).replace(/"/g, '');
  return c.body(fs.readFileSync(e.pdf_path), 200, { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"` });
});
app.delete('/external-invoices/:id/pdf', c => c.json(updateRow('external_invoices', id(c), { pdf_path: null, pdf_name: null }, actor(c))));
app.patch('/external-invoices/:id', async c => {
  const { reference, notes, platform } = await c.req.json();
  return c.json(updateRow('external_invoices', id(c), { reference, notes, platform }, actor(c)));
});

// Bulk writes (Claude's crm_batch): one transaction, compact result.
app.post('/batch', async c => c.json(runBatch((await c.req.json()).ops, actor(c))));

// Conversations
app.get('/inbox', c => c.json(listThreads()));
app.get('/messages', c => {
  const { client_id, thread_key, channel } = c.req.query();
  return c.json(threadMessages({ client_id: client_id ? Number(client_id) : null, thread_key, channel }));
});
// Manual log: a message the owner sent from their phone/mail (or pasted from the client) until the connectors are live.
app.post('/messages', async c => {
  const b = await c.req.json();
  const client = b.client_id ? getRow('clients', b.client_id) : null;
  return c.json(addMessage({
    ...b,
    thread_key: b.thread_key || (client ? threadKeyFor(client, b.channel) : '') || `client-${b.client_id}`,
    sent_at: b.sent_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
    status: b.status || (b.direction === 'out' ? 'sent_manual' : 'received'),
    source: 'manual',
    read_at: b.direction === 'in' ? (b.read_at ?? null) : undefined,
  }, actor(c)), 201);
});
// Fix a manually logged message (e.g. the text the owner actually sent).
app.patch('/messages/:id', async c => {
  const { body, sent_at } = await c.req.json();
  return c.json(updateRow('messages', id(c), { body, sent_at }, actor(c)));
});
app.delete('/messages/:id', c => c.json({ ok: deleteRow('messages', id(c), actor(c)) }));
app.post('/messages/read', async c => c.json({ marked: markRead(await c.req.json()) }));
app.post('/messages/assign', async c => {
  const { thread_key, client_id } = await c.req.json();
  return c.json({ moved: assignThread(thread_key, Number(client_id), actor(c)) });
});
app.post('/messages/ignore', async c => c.json(ignoreThread((await c.req.json()).thread_key, actor(c))));
app.get('/ignored', c => c.json(listIgnored()));
app.delete('/ignored/:id', c => c.json({ ok: deleteRow('ignored_threads', id(c), actor(c)) }));
app.post('/messages/import/whatsapp/preview', async c => {
  const { text, phone, dayFirst: hint = true } = await c.req.json();
  const dayFirst = detectDayFirst(text, hint);
  const client_id = phone && digits(phone).length >= 7 ? matchClient({ channel: 'whatsapp', thread_key: digits(phone) }) : null;
  return c.json({ senders: exportSenders(text, { dayFirst }), dayFirst, client: client_id ? getRow('clients', client_id) : null });
});
app.post('/messages/import/whatsapp', async c => c.json(importWhatsAppExport(await c.req.json())));

const port = Number(process.env.CRM_API_PORT || 4100);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`[api] http://127.0.0.1:${port}/api`));

// Open SSE streams would otherwise block `node --watch` restarts.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
