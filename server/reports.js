// Report files Claude builds on request (crm_make_report): PDF to read, Excel to filter/edit. Saved in data/reports/;
// in WhatsApp chats chat.js picks up `report_file` from the tool result and sends the file to the owner.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { DB_PATH, getSetting } from './db.js';
import { htmlToPdf, logoSrc } from './pdf.js';
import { today } from './domain.js';

const REPORTS_DIR = path.join(path.dirname(DB_PATH), 'reports');
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'reporte';
const cell = v => (typeof v === 'number' ? v.toLocaleString('en-US') : esc(v));

// Light markdown for text blocks: paragraphs, "- " bullets, **bold**.
function textHtml(text) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return String(text).split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-•*]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

function tableHtml({ columns = [], rows = [] }) {
  const num = columns.map((_, i) => rows.length && rows.every(r => r[i] == null || r[i] === '' || typeof r[i] === 'number'));
  // Short tables (signature blocks, schedules) never split; longer ones break between rows with the header repeated.
  return `<table${rows.length <= 6 ? ' class="keep"' : ''}><thead><tr>${columns.map((c, i) => `<th${num[i] ? ' class="r"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${columns.map((_, i) => `<td${num[i] ? ' class="r"' : ''}>${cell(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function reportHtml({ title, subtitle, sections }) {
  const issuer = getSetting('issuer', {});
  const logo = logoSrc();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap');
    @page { size: A4; margin: 14mm 14mm 16mm; }
    body { font-family: 'Open Sans', sans-serif; color: #111; font-size: 11.5px; margin: 0; }
    header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; }
    header img { width: 36px; height: 36px; }
    header h1 { font-size: 18px; margin: 0; }
    header .meta { margin-left: auto; text-align: right; color: #555; font-size: 10.5px; line-height: 1.5; }
    h2 { font-size: 13.5px; margin: 18px 0 6px; }
    p { margin: 4px 0 8px; line-height: 1.5; }
    ul { margin: 4px 0 8px; padding-left: 18px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    h2 { break-after: avoid; }
    .keep, section.keep { break-inside: avoid; }
    section.pb { break-before: page; }
    th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: 600; }
    .r { text-align: right; }
  </style></head><body>
    <header>${logo ? `<img src="${logo}">` : ''}<div><h1>${esc(title)}</h1>${subtitle ? `<div>${esc(subtitle)}</div>` : ''}</div>
      <div class="meta">${esc(issuer.name || '')}<br>${today().split('-').reverse().join('/')}</div></header>
    ${sections.map(s => `<section class="${[s.page_break && 'pb', s.keep_together && 'keep'].filter(Boolean).join(' ')}">${s.heading ? `<h2>${esc(s.heading)}</h2>` : ''}${s.text ? textHtml(s.text) : ''}${s.table ? tableHtml(s.table) : ''}</section>`).join('')}
  </body></html>`;
}

async function writeXlsx(file, { title, sections }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM';
  const used = new Set();
  const sheetName = base => {
    let name = String(base || 'Datos').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Datos';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 27)} (${i})`;
    used.add(name.toLowerCase());
    return name;
  };
  const notes = sections.filter(s => s.text);
  if (notes.length) {
    const ws = wb.addWorksheet(sheetName('Resumen'));
    ws.addRow([title]).font = { bold: true, size: 14 };
    for (const s of notes) {
      ws.addRow([]);
      if (s.heading) ws.addRow([s.heading]).font = { bold: true };
      for (const line of String(s.text).split('\n')) ws.addRow([line.replace(/\*\*/g, '')]);
    }
    ws.getColumn(1).width = 100;
  }
  for (const s of sections.filter(s => s.table)) {
    const ws = wb.addWorksheet(sheetName(s.heading || title));
    const { columns = [], rows = [] } = s.table;
    ws.addRow(columns).font = { bold: true };
    for (const r of rows) ws.addRow(columns.map((_, i) => r[i] ?? null));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    columns.forEach((c, i) => {
      const width = Math.max(String(c).length, ...rows.slice(0, 200).map(r => String(r[i] ?? '').length));
      ws.getColumn(i + 1).width = Math.min(Math.max(width + 2, 8), 60);
    });
  }
  if (!wb.worksheets.length) wb.addWorksheet('Datos');
  await wb.xlsx.writeFile(file);
}

/** Build one report file; returns { report_file, name, format }. */
export async function makeReport({ format = 'pdf', title, subtitle, sections = [] }) {
  if (!title) throw new Error('title required');
  if (!['pdf', 'xlsx'].includes(format)) throw new Error('format must be pdf or xlsx');
  if (!sections.length) throw new Error('sections required');
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const name = `${slug(title)}-${today()}.${format}`;
  const file = path.join(REPORTS_DIR, `${Date.now().toString(36)}-${name}`);
  if (format === 'pdf') await htmlToPdf(reportHtml({ title, subtitle, sections }), file);
  else await writeXlsx(file, { title, sections });
  return { report_file: file, name, format };
}
