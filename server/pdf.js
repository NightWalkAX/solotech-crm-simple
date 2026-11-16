// Renders quotes/invoices/receipts to PDF with the same layout as the receipts already issued (REC-000001..3).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DB_PATH, getSetting, getRow, updateRow } from './db.js';
import { getDocument } from './documents.js';

const DOCS_DIR = path.join(path.dirname(DB_PATH), 'docs');
// The business logo (Integraciones → Emisor y firma, settings.issuer.logo as a PNG/JPEG data URL); none = no logo.
export function logoSrc() {
  const l = getSetting('issuer', {}).logo || '';
  return /^data:image\/(png|jpeg);base64,/.test(l) ? l : '';
}
const TITLE = { quote: 'QUOTATION', invoice: 'INVOICE', receipt: 'RECEIPT' };

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const fmtDate = d => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
// Negatives (discount lines) read "-G$45,000"; -0 from rounding prints as G$0.
const money = (n, cur) => `${Number(n) < 0 ? '-' : ''}${cur === 'GYD' ? 'G$' : cur === 'USD' ? 'US$' : cur + ' '}${Math.abs(Number(n) || 0).toLocaleString('en-US')}`;

/** Notes as paragraphs (blank line = new paragraph, single newline = line break), "Notes:" before the first. */
const notesParas = notes => String(notes ?? '').trim().split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
const paraHtml = (text, first, cls = 'np') => `<p class="${cls}">${first ? '<b>Notes:</b> ' : ''}${esc(text).replace(/\n/g, '<br>')}</p>`;

/** Split a long paragraph so only its last sentences (≤ ~45 words) travel with the signature block. */
function splitTail(text, max = 45) {
  const words = t => t.split(/\s+/).filter(Boolean).length;
  if (words(text) <= max) return ['', text];
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n|$)\s*/g) || [text];
  let tail = '';
  for (let i = sentences.length - 1; i > 0 && words(sentences[i] + tail) <= max; i--) tail = sentences[i] + tail;
  if (!tail.trim()) { // one huge sentence: split at a word boundary
    const w = text.split(/(\s+)/);
    let i = w.length, n = 0;
    while (i > 0 && n < max) { i--; if (w[i].trim()) n++; }
    tail = w.slice(i).join('');
  }
  return [text.slice(0, text.length - tail.length).trimEnd(), tail.trim()];
}

/** Issuer's stored signature (settings.issuer.signature, PNG/JPEG data URL) or '' when none is saved. */
const sigImg = issuer => (/^data:image\/(png|jpeg);base64,/.test(issuer.signature || '') ? `<img class="simg" src="${issuer.signature}">` : '');

/** Quote acceptance block: client and issuer, Name / Title / Signature / Date (no stamp). The issuer column comes
 *  pre-filled (signer name, title, saved signature, issue date) when settings.issuer has them. */
function signatureHtml(client, issuer, doc, footer = '') {
  const field = (label, cls = '', val = '') => `<div class="sf ${cls}"><span>${label}</span><i>${val}</i></div>`;
  const col = (who, org, f = {}) => `<div class="scol"><b>${who}</b><div class="org">${esc(org)}</div>
      ${field('Name', '', esc(f.name))}${field('Title / Position', '', esc(f.title))}${field('Signature', 'tall', f.sign)}${field('Date', '', f.date)}</div>`;
  const sign = sigImg(issuer);
  const mine = { name: issuer.signer_name, title: issuer.signer_title, sign, date: sign ? fmtDate(doc.issue_date) : '' };
  return `<div class="sign">
    <div class="sintro"><b>Acceptance</b> — by signing below, the client accepts this quotation, its scope and terms.</div>
    <div class="scols">${col('For the client', client.company || client.contact_name || '')}${col('For the issuer', issuer.name || '', mine)}</div>${footer}
  </div>`;
}

/** Invoices/receipts: the issuer's signature on the right, only when one is saved and sign_all isn't off. */
function issuerSignHtml(issuer) {
  const sign = sigImg(issuer);
  if (!sign || issuer.sign_all === false) return '';
  return `<div class="isign"><div class="ibox">${sign}<i></i><div><b>Authorised signature</b></div>
    ${issuer.signer_name ? `<div>${esc(issuer.signer_name)}${issuer.signer_title ? ' — ' + esc(issuer.signer_title) : ''}</div>` : ''}
    <div class="org">${esc(issuer.name)}</div></div></div>`;
}

export function renderHtml(doc, client, issuer) {
  const m = n => money(n, doc.currency);
  const logo = logoSrc();
  const exempt = doc.lines.some(l => !l.vat_rate);
  const billName = client.contact_name || client.company;
  const rows = doc.lines.map(l => `
    <tr><td>${esc(l.description)}</td><td class="r">${l.qty}</td><td class="r">${m(l.unit_price)}</td>
    <td class="r">${esc(l.vat_label)}</td><td class="r">${m(Math.round(l.amount * l.vat_rate))}</td><td class="r">${m(l.amount + Math.round(l.amount * l.vat_rate))}</td></tr>`).join('');
  const settle = doc.type === 'quote' ? '' : `
    <tr><td>Paid</td><td class="r">${m(doc.paid)}</td></tr>
    <tr class="b"><td>Balance due</td><td class="r">${m(Math.max(doc.total - doc.paid, 0))}</td></tr>`;
  const footer = `<div class="footer">${esc(issuer.footer)}</div>`;
  // The footer goes inside the signature block so it can't be left alone on a last page either.
  const sign = doc.type === 'quote' && doc.show_signature !== 0 ? signatureHtml(client, issuer, doc, footer) : '';
  const isign = doc.type === 'quote' ? '' : issuerSignHtml(issuer);
  const raw = notesParas(doc.notes);
  const paras = raw.map((p, i) => paraHtml(p, i === 0));
  const totalsTable = `<table class="totals">
      <tr><td>Subtotal</td><td class="r">${m(doc.subtotal)}</td></tr>
      <tr class="line"><td>VAT</td><td class="r">${m(doc.vat)}</td></tr>
      <tr class="b"><td>TOTAL</td><td class="r">${m(doc.total)}</td></tr>${settle}
    </table>
    ${exempt ? `<div class="note">${esc(issuer.vat_note || 'Includes VAT-exempt supplies.')}</div>` : ''}`;
  const totals = `${totalsTable}<hr>`;
  const words = raw.join(' ').split(/\s+/).filter(Boolean).length;
  // The signature block never sits alone on a page: an unbreakable group carries it with the last sentences of the notes
  // (a long last paragraph keeps flowing normally above it) or, without notes, with the totals. Short notes (≤ 160 words)
  // travel whole with the signature, so "Notes:" is never left alone at the bottom of a page.
  // terms_page = forced break: lines + totals end page 1's flow, notes (terms) + signature open a page of their own.
  const tp = doc.terms_page === 1;
  const tpHead = `<div class="tpage"><h2>${sign ? 'Terms and acceptance' : 'Notes and terms'} — ${esc(doc.number)}</h2>`;
  let tail;
  if (!sign) tail = tp
    ? `${totalsTable}${tpHead}${paras.join('')}${isign ? `<div class="keep">${isign}${footer}</div>` : footer}</div>`
    : totals + paras.join('') + (isign ? `<div class="keep">${isign}${footer}</div>` : footer);
  else if (tp) {
    const [head, end] = words > 160 ? splitTail(raw.at(-1)) : ['', null];
    const last = raw.length - 1;
    tail = !raw.length ? `${totalsTable}${tpHead}${sign}</div>`
      : end === null ? `${totalsTable}${tpHead}<div class="keep">${paras.join('')}${sign}</div></div>`
      : `${totalsTable}${tpHead}${paras.slice(0, -1).join('')}${head ? paraHtml(head, last === 0, 'np head') : ''}`
        + `<div class="keep">${paraHtml(end, !head && last === 0, head ? 'np cont' : 'np')}${sign}</div></div>`;
  }
  else if (!raw.length) tail = `<div class="keep">${totals}${sign}</div>`;
  else if (words <= 160) tail = `${totalsTable}<div class="keep"><hr>${paras.join('')}${sign}</div>`;
  else {
    const [head, end] = splitTail(raw.at(-1));
    const last = raw.length - 1;
    tail = totals + paras.slice(0, -1).join('') + (head ? paraHtml(head, last === 0, 'np head') : '')
      + `<div class="keep">${paraHtml(end, !head && last === 0, head ? 'np cont' : 'np')}${sign}</div>`;
  }
  const extraDate = doc.due_date ? `<div>${doc.type === 'quote' ? 'Valid until' : 'Due'}: ${fmtDate(doc.due_date)}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
    /* Margins on @page (not body padding) so every continuation page keeps them too. */
    @page { size: A4; margin: 52px 64px; }
    body { font-family: 'Open Sans', sans-serif; color: #111; font-size: 13px; margin: 0; padding: 0; }
    .top { display: flex; justify-content: space-between; }
    .issuer { display: flex; gap: 22px; line-height: 1.6; }
    .issuer img { width: 44px; height: 44px; margin-top: 4px; }
    .issuer b { font-size: 16px; }
    .doc { text-align: right; line-height: 1.6; }
    .doc h1 { font-size: 18px; margin: 0; }
    .bill { margin-top: 40px; line-height: 1.6; }
    .org { font-size: 11px; color: #444; }
    table.lines { width: 100%; border-collapse: collapse; margin-top: 18px; }
    table.lines th, table.lines td { border: 1.5px solid #111; padding: 8px 10px; }
    table.lines th { background: #f2f2f2; text-align: left; }
    table.lines thead { display: table-header-group; }
    table.lines tr { break-inside: avoid; }
    .r { text-align: right !important; }
    .totals { margin: 18px 0 0 auto; width: 165px; border-collapse: collapse; break-inside: avoid; }
    .totals td { padding: 4px 0; }
    .totals tr.line td { border-bottom: 1.5px solid #111; }
    .totals tr.b td { font-weight: 700; }
    .note { font-size: 11px; margin-top: 18px; }
    hr { border: 0; border-top: 1.5px solid #111; margin: 20px 0 12px; }
    .footer { text-align: center; font-size: 11px; margin-top: 18px; break-before: avoid; }
    .np { margin: 0; orphans: 3; widows: 3; }
    .np:first-of-type { break-after: avoid; }
    .np + .np, .np + .keep { margin-top: 8px; }
    .np.head + .keep { margin-top: 0; }
    /* .keep = last sentences (≤ ~45 words) or totals + signature: always shorter than a page, never split. */
    .keep { break-inside: avoid; }
    .tpage { break-before: page; }
    .tpage h2 { font-size: 15px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1.5px solid #111; }
    .sign { break-inside: avoid; break-before: avoid; margin-top: 22px; font-size: 12px; }
    .sintro { margin-bottom: 14px; }
    .scols { display: flex; gap: 48px; }
    .scol { flex: 1; }
    .scol .org { margin-bottom: 4px; }
    .sf { display: flex; align-items: flex-end; gap: 8px; height: 30px; }
    .sf.tall { height: 46px; }
    .sf span { white-space: nowrap; }
    .sf i { flex: 1; border-bottom: 1px solid #111; font-style: normal; padding-left: 2px; position: relative; }
    .sf.tall i { height: 100%; }
    .simg { position: absolute; left: 6px; bottom: 1px; max-height: 42px; max-width: 190px; }
    .isign { display: flex; justify-content: flex-end; margin-top: 26px; break-before: avoid; font-size: 12px; }
    .ibox { width: 230px; text-align: center; line-height: 1.5; }
    .ibox .simg { position: static; display: block; margin: 0 auto -2px; max-height: 60px; }
    .ibox i { display: block; border-bottom: 1px solid #111; margin-bottom: 4px; }
  </style></head><body>
    <div class="top">
      <div class="issuer">${logo ? `<img src="${logo}">` : ''}<div>
        <b>${esc(issuer.name)}</b><br>${esc(issuer.address)}<br>${esc(issuer.phone)}<br>${esc(issuer.email)}<br>TIN: ${esc(issuer.tin)}
      </div></div>
      <div class="doc"><h1>${TITLE[doc.type]}</h1><div>No: ${esc(doc.number)}</div><div>Date: ${fmtDate(doc.issue_date)}</div>${extraDate}</div>
    </div>
    <div class="bill"><b>Bill to:</b><br>${esc(billName)}<br>${client.address ? esc(client.address) + '<br>' : ''}${esc(client.phone || client.whatsapp || '')}${client.email ? '<br>' + esc(client.email) : ''}
      ${client.contact_name ? `<div class="org">Company / organisation: ${esc(client.company)}</div>` : ''}</div>
    <table class="lines"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">VAT</th><th class="r">VAT amt</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${tail}
  </body></html>`;
}

let browserPromise;
const browser = () => (browserPromise ??= chromium.launch());

/** Render a document to data/docs/<number>.pdf and store the path. Imported PDFs are never overwritten unless forced. */
export async function generatePdf(id, { force = false } = {}) {
  const doc = getDocument(id);
  if (!doc) throw new Error('document not found');
  if (doc.pdf_path && fs.existsSync(doc.pdf_path) && !force) return doc.pdf_path;
  const client = getRow('clients', doc.client_id);
  const html = renderHtml(doc, client, getSetting('issuer', {}));
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const out = path.join(DOCS_DIR, `${doc.number}.pdf`);
  await htmlToPdf(html, out);
  updateRow('documents', id, { pdf_path: out }, 'system');
  return out;
}

/** Print an HTML page to an A4 PDF (margins come from the page's own @page rule). */
export async function htmlToPdf(html, out) {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
  return out;
}
