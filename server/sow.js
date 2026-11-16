// Scope of Work, Terms and Acceptance (crm_save_sow): the signed companion of a quote (one per quote + phase,
// e.g. "Phase 1" and "Phase 2 and services").
// Rendered here with the saved issuer signature and stored in Contratos y Acuerdos (kind 'sow'); same quote + phase = same row.
import fs from 'node:fs';
import path from 'node:path';
import { db, DB_PATH, getRow, getSetting, insertRow, updateRow } from './db.js';
import { htmlToPdf, logoSrc } from './pdf.js';
import { today } from './domain.js';

const CONTRACTS_DIR = path.join(path.dirname(DB_PATH), 'contracts');
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = d => { const [y, m, day] = d.slice(0, 10).split('-').map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };
const fmtDate = d => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

// The template: standard terms used when the chat doesn't pass its own list ({client}, {validity} are replaced).
export const DEFAULT_SOW_TEMPLATE = {
  terms: [
    { title: 'Not included', text: 'any change to the scope described in this document, which will be quoted separately.' },
    { title: 'Dates', text: 'work starts once the first payment is received. Delivery dates are estimates and may come earlier or later depending on when payments are processed.' },
    { title: 'Validity', text: '{validity} days from the issue date of the quote.' },
  ],
};
export const sowTemplate = () => ({ ...DEFAULT_SOW_TEMPLATE, ...getSetting('sow_template', {}) });

function sowHtml(s, issuer) {
  const logo = logoSrc();
  const sig = /^data:image\/(png|jpeg);base64,/.test(issuer.signature || '') ? `<img class="simg" src="${issuer.signature}">` : '';
  const money = n => Number(n).toLocaleString('en-US');
  let n = 0;
  const h2 = t => `<h2>${++n}. ${esc(t)}</h2>`;
  const parts = [s.maintenance?.length && 'the monthly maintenance'].filter(Boolean);
  const describes = ['the action items', 'the payment terms', ...parts].join(', ') + ` and the terms of ${s.phase}`;
  const total = s.payments.reduce((a, p) => a + Number(p.amount || 0), 0);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
    @page { size: A4; margin: 14mm 14mm 16mm; }
    body { font-family: 'Open Sans', sans-serif; color: #111; font-size: 11.5px; margin: 0; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
    header img { width: 36px; height: 36px; }
    header h1 { font-size: 18px; margin: 0; }
    header .meta { margin-left: auto; text-align: right; color: #555; font-size: 10.5px; line-height: 1.5; }
    h2 { font-size: 13.5px; margin: 18px 0 6px; break-after: avoid; }
    p { margin: 4px 0 8px; line-height: 1.5; }
    ul { margin: 4px 0 8px; padding-left: 18px; line-height: 1.5; }
    ol { margin: 4px 0 8px; padding-left: 0; list-style: none; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; }
    tr { break-inside: avoid; }
    th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: 600; }
    .r { text-align: right; }
    .accept { break-inside: avoid; }
    .accept td { height: 22px; vertical-align: bottom; }
    .accept td.sig { height: 52px; position: relative; }
    .line { display: block; border-bottom: 1px solid #111; width: 85%; height: 14px; }
    .simg { position: absolute; left: 10px; bottom: 4px; max-height: 46px; max-width: 200px; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}">` : ''}<div><h1>Scope of Work, Terms and Acceptance - ${esc(s.phase)}</h1>
      <div>Quote ${esc(s.quote.number)} - ${esc(issuer.name)} for ${esc(s.client_label)}${s.project_short ? ` - ${esc(s.project_short)}` : ''}</div></div>
      <div class="meta">${esc(issuer.name)}<br>${fmtDate(s.date)}</div></header>

    ${h2('Overview')}
    <p>This document is part of quote <b>${esc(s.quote.number)}</b>, issued on ${longDate(s.quote.issue_date)}${s.quote.due_date ? ` and valid for ${s.validity} days (until ${longDate(s.quote.due_date)})` : ''}. It describes ${describes}. The last section is for signature.</p>
    <p><b>Project:</b> ${inline(s.project)}${s.start ? `<br><b>Start:</b> ${inline(s.start)}` : ''}${s.delivery ? `${s.start ? ' ' : '<br>'}<b>Delivery:</b> ${inline(s.delivery)}` : ''}</p>

    ${h2(s.items_heading || 'Action items')}
    <table><thead><tr><th>No.</th><th>Action item</th><th>Deliverable</th><th>Estimated due</th></tr></thead><tbody>
      ${s.items.map((it, i) => `<tr><td>${esc(it.no || i + 1)}</td><td>${esc(it.item)}</td><td>${inline(it.deliverable)}</td><td>${esc(it.due || '')}</td></tr>`).join('')}
    </tbody></table>

    ${h2('Payment terms')}
    <table><thead><tr><th>When</th><th class="r">Amount (${esc(s.currency)})</th></tr></thead><tbody>
      ${s.payments.map(p => `<tr><td>${esc(p.when)}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}
      <tr><td><b>Total of this quote</b></td><td class="r"><b>${money(total)}</b></td></tr>
    </tbody></table>

    ${s.maintenance?.length ? `${h2('Monthly maintenance')}<ul>${s.maintenance.map(m => `<li>${inline(m)}</li>`).join('')}</ul>` : ''}

    ${h2('Terms and conditions')}
    <ol>${s.terms.map((t, i) => `<li>${i + 1}. <b>${esc(t.title)}:</b> ${inline(t.text)}</li>`).join('')}</ol>

    <div class="accept">${h2('Acceptance and signatures')}
    <p>By signing below, both parties accept quote ${esc(s.quote.number)} and the scope, payment terms${s.maintenance?.length ? ', monthly maintenance' : ''} and terms in this document.</p>
    <table><thead><tr><th style="width:16%"></th><th>For ${esc(s.client_label)}</th><th>For ${esc(issuer.name)}</th></tr></thead><tbody>
      <tr><td>Name</td><td><span class="line"></span></td><td>${esc(issuer.signer_name || '')}</td></tr>
      <tr><td>Title</td><td><span class="line"></span></td><td>${esc(issuer.signer_title || '')}</td></tr>
      <tr><td>Signature</td><td class="sig"><span class="line"></span></td><td class="sig">${sig || '<span class="line"></span>'}</td></tr>
      <tr><td>Date</td><td><span class="line"></span></td><td>${sig ? fmtDate(s.date) : '<span class="line"></span>'}</td></tr>
    </tbody></table></div>
  </body></html>`;
}

/** Render the SOW signed by the issuer and save/replace it in Contratos y Acuerdos. Returns the contract row + report_file. */
export async function saveSow(input, actor) {
  const quote = input.quote_id ? getRow('documents', input.quote_id)
    : db.prepare("SELECT * FROM documents WHERE number = ?").get(input.quote_number);
  if (!quote || quote.type !== 'quote') throw new Error('Cotización no encontrada (quote_id o quote_number)');
  const client = getRow('clients', quote.client_id);
  if (!input.phase || !input.project) throw new Error('phase y project son obligatorios');
  if (!input.items?.length) throw new Error('items (acciones) obligatorios');
  if (!input.payments?.length) throw new Error('payments obligatorios');
  const client_label = input.client_label || client?.company || client?.contact_name || 'the client';
  const validity = quote.due_date ? Math.round((new Date(quote.due_date) - new Date(quote.issue_date)) / 864e5) : 30;
  const fill = t => ({ title: t.title, text: String(t.text).replaceAll('{client}', client_label).replaceAll('{validity}', validity) });
  const terms = (input.terms?.length ? input.terms : [...sowTemplate().terms, ...(input.extra_terms || [])]).map(fill);
  const s = { ...input, quote, client_label, validity, terms, currency: input.currency || quote.currency || 'GYD', date: today() };
  const issuer = getSetting('issuer', {});

  const title = `Scope of Work - ${input.phase} (${quote.number})`;
  const existing = db.prepare("SELECT * FROM contracts WHERE kind = 'sow' AND client_id IS ? AND title = ?").get(quote.client_id, title);
  const notes = input.notes ?? existing?.notes ?? `Firmado por ${issuer.signer_name || issuer.name || 'el emisor'}; pendiente de la firma del cliente (reemplaza el archivo por la copia firmada).`;
  const row = existing ? updateRow('contracts', existing.id, { notes }, actor)
    : insertRow('contracts', { title, kind: 'sow', client_id: quote.client_id, signed_on: null, notes }, actor);

  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  const file = path.join(CONTRACTS_DIR, `contract-${row.id}-${Date.now()}.pdf`); // old files kept so undo still works
  await htmlToPdf(sowHtml(s, issuer), file);
  const file_name = `${title.replace(/[^\w.\- ()]/g, '_')}.pdf`;
  const saved = updateRow('contracts', row.id, { file_path: file, file_name, file_type: 'application/pdf' }, actor);
  return { contract: saved, report_file: file, name: file_name, updated: !!existing };
}
