import { db, insertRow, updateRow, getRow, changed } from './db.js';
import { nextNumber, today } from './domain.js';

function lineAmounts(l) {
  const qty = Number(l.qty ?? 1);
  const unit = Math.round(Number(l.unit_price ?? 0));
  const net = Math.round(qty * unit);
  const rate = Number(l.vat_rate ?? 0);
  return { qty, unit_price: unit, amount: net, vat_rate: rate, vat_amt: Math.round(net * rate), vat_label: l.vat_label || (rate ? `${Math.round(rate * 100)}%` : 'Exempt') };
}

export function getDocument(id) {
  const doc = db.prepare('SELECT d.*, c.company, c.contact_name FROM documents d JOIN clients c ON c.id = d.client_id WHERE d.id = ?').get(id);
  if (!doc) return null;
  doc.lines = db.prepare('SELECT * FROM document_lines WHERE document_id = ? ORDER BY position, id').all(id);
  return doc;
}

export function listDocuments({ client_id, type } = {}) {
  const where = [];
  const p = {};
  if (client_id) { where.push('d.client_id = @client_id'); p.client_id = client_id; }
  if (type) { where.push('d.type = @type'); p.type = type; }
  return db.prepare(`SELECT d.*, c.company,
      (SELECT number FROM documents r WHERE r.id = d.related_id) AS related_number
    FROM documents d JOIN clients c ON c.id = d.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.issue_date DESC, d.number DESC`).all(p);
}

/**
 * Create a quote/invoice/receipt. `number` may be passed only for imports of already-issued documents;
 * otherwise the next number in the sequence is assigned.
 */
export function createDocument(input, actor = 'ui') {
  const { type, client_id, lines = [] } = input;
  if (!['quote', 'invoice', 'receipt'].includes(type)) throw new Error('type must be quote|invoice|receipt');
  if (!getRow('clients', client_id)) throw new Error('client not found');
  return db.transaction(() => {
    const calc = lines.map(lineAmounts);
    const subtotal = calc.reduce((s, l) => s + l.amount, 0);
    const vat = calc.reduce((s, l) => s + l.vat_amt, 0);
    const total = subtotal + vat;
    const doc = insertRow('documents', {
      type,
      number: input.number || nextNumber(type),
      client_id,
      related_id: input.related_id ?? null,
      plan_id: input.plan_id ?? null,
      issue_date: input.issue_date || today(),
      due_date: input.due_date ?? null,
      status: input.status || (type === 'receipt' ? 'paid' : 'issued'),
      currency: input.currency || 'GYD',
      subtotal, vat, total,
      paid: input.paid ?? (type === 'receipt' ? total : 0),
      payment_method: input.payment_method ?? null,
      notes: input.notes ?? null,
      show_signature: input.show_signature === undefined || input.show_signature === null ? 1 : input.show_signature ? 1 : 0,
      terms_page: input.terms_page ? 1 : 0,
      pdf_path: input.pdf_path ?? null,
    }, actor);
    calc.forEach((l, i) => {
      db.prepare(`INSERT INTO document_lines (document_id, position, description, qty, unit_price, vat_rate, vat_label, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(doc.id, i, lines[i].description, l.qty, l.unit_price, l.vat_rate, l.vat_label, l.amount);
    });
    // A receipt against an invoice settles (part of) that invoice.
    if (type === 'receipt' && doc.related_id) applyPayment(doc.related_id, actor);
    changed('document_lines', doc.id);
    return getDocument(doc.id);
  })();
}

export function applyPayment(invoiceId, actor = 'ui') {
  const inv = getRow('documents', invoiceId);
  if (!inv || inv.type !== 'invoice') return;
  const paid = db.prepare("SELECT coalesce(sum(total), 0) FROM documents WHERE type = 'receipt' AND related_id = ? AND status != 'void'").pluck().get(invoiceId);
  updateRow('documents', invoiceId, { paid, status: paid >= inv.total ? 'paid' : 'issued' }, actor);
}

/** Record a payment against an invoice: issues the receipt with the next REC number. */
export function receiptForInvoice(invoiceId, { amount, payment_method = 'cash', issue_date } = {}, actor = 'ui') {
  const inv = getRow('documents', invoiceId);
  if (!inv || inv.type !== 'invoice') throw new Error('invoice not found');
  const due = inv.total - inv.paid;
  const amt = Math.round(amount ?? due);
  return createDocument({
    type: 'receipt', client_id: inv.client_id, related_id: inv.id, currency: inv.currency, issue_date, payment_method,
    lines: [{ description: `Payment received — ${inv.number} (${payment_method})`, qty: 1, unit_price: amt }],
    notes: `Payment received against ${inv.number}`,
  }, actor);
}

/** Turn an accepted quote into an invoice with the same lines (optionally a percentage, e.g. the 50% deposit). */
export function invoiceFromQuote(quoteId, { percent = 100, label } = {}, actor = 'ui') {
  const q = getDocument(quoteId);
  if (!q || q.type !== 'quote') throw new Error('quote not found');
  const f = percent / 100;
  const lines = percent === 100
    ? q.lines
    : [{ description: label || `${percent}% of ${q.number}`, qty: 1, unit_price: Math.round(q.subtotal * f), vat_rate: q.subtotal ? q.vat / q.subtotal : 0 }];
  const inv = createDocument({ type: 'invoice', client_id: q.client_id, related_id: q.id, currency: q.currency, lines, notes: `Ref. ${q.number}` }, actor);
  updateRow('documents', q.id, { status: 'accepted' }, actor);
  return inv;
}
