import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, FileDown, Trash2 } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date } from '../lib/format.js';
import { PageHeader, Modal } from '../components/ui.jsx';
import { ExternalPdf } from '../components/RecurringPlans.jsx';

const TYPE = { quote: 'Cotización', invoice: 'Factura', receipt: 'Recibo' };
const STATUS = { draft: 'Borrador', issued: 'Emitida', accepted: 'Aceptada', paid: 'Pagada', void: 'Anulada' };
const STATUS_CLS = { paid: 'text-emerald-700', void: 'text-slate-400 line-through', issued: 'text-amber-700', accepted: 'text-brand' };

function PaymentButton({ doc }) {
  const pay = useMutate(body => api.post(`/documents/${doc.id}/receipt`, body));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: doc.total - doc.paid, payment_method: 'cash' });
  return (
    <>
      <button className="btn-ghost text-xs" onClick={() => setOpen(true)}>Registrar pago</button>
      {open && (
        <Modal title={`Pago de ${doc.number}`} onClose={() => setOpen(false)}>
          <form className="grid grid-cols-2 gap-3" onSubmit={e => { e.preventDefault(); pay.mutate({ ...f, amount: Number(f.amount) }, { onSuccess: () => setOpen(false) }); }}>
            <div><label className="label">Monto ({doc.currency})</label><input className="input" type="number" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></div>
            <div><label className="label">Método</label>
              <select className="input" value={f.payment_method} onChange={e => setF({ ...f, payment_method: e.target.value })}>
                <option value="cash">Efectivo</option><option value="bank transfer">Transferencia</option><option value="cheque">Cheque</option><option value="mmg">MMG</option><option value="other">Otro</option>
              </select>
            </div>
            <div className="col-span-2 flex justify-end"><button className="btn-primary" disabled={pay.isPending}>Emitir recibo</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function DocumentTable({ docs, showClient = true }) {
  const toInvoice = useMutate(({ id, percent }) => api.post(`/documents/${id}/invoice`, { percent, label: percent === 50 ? 'First payment — 50% (Demo approved, Sec. 4.1)' : undefined }));
  const voidDoc = useMutate(id => api.patch(`/documents/${id}`, { status: 'void' }));
  const setSig = useMutate(({ id, on }) => api.patch(`/documents/${id}`, { show_signature: on }));
  const setTp = useMutate(({ id, on }) => api.patch(`/documents/${id}`, { terms_page: on }));
  if (!docs.length) return <p className="px-4 py-3 text-sm text-slate-400">Sin documentos.</p>;
  return (
    <table className="w-full text-sm [&_td]:px-3 [&_td]:whitespace-nowrap [&_th]:px-3">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr><th className="px-4 py-2">Número</th>{showClient && <th>Cliente</th>}<th>Fecha</th><th className="text-right">Total</th><th className="text-right">Pagado</th><th className="pl-4">Estado</th><th></th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {docs.map(d => (
          <tr key={d.id} className="group">
            <td className="px-4 py-2"><b>{d.number}</b><div className="whitespace-normal text-xs text-slate-500">{TYPE[d.type]}{d.related_number ? ` · ref ${d.related_number}` : ''}</div></td>
            {showClient && <td><Link className="hover:text-brand" to={`/clients/${d.client_id}`}>{d.company}</Link></td>}
            <td>{date(d.issue_date)}{d.paid_on && d.paid_on !== d.issue_date && <div className="text-xs text-slate-500">pagado {date(d.paid_on)}</div>}</td>
            <td className="text-right">{money(d.total, d.currency)}</td>
            <td className="text-right">{d.type === 'invoice' ? money(d.paid, d.currency) : ''}</td>
            <td className={`pl-4 ${STATUS_CLS[d.status] ?? ''}`}>{STATUS[d.status] ?? d.status}</td>
            <td className="whitespace-nowrap pr-3 text-right">
              {<a className="btn-ghost text-xs" href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noreferrer"><FileDown size={13} /> PDF</a>}
              {d.type === 'invoice' && !['paid', 'void', 'draft'].includes(d.status) && <PaymentButton doc={d} />}
              {d.type === 'quote' && d.status !== 'void' && <label className="mr-2 inline-flex items-center gap-1 text-xs text-slate-500" title="Bloque de firma (cliente y emisor) al final del PDF">
                <input type="checkbox" checked={d.show_signature !== 0} disabled={setSig.isPending} onChange={e => setSig.mutate({ id: d.id, on: e.target.checked })} /> Firma
              </label>}
              {d.type !== 'receipt' && d.status !== 'void' && <label className="mr-2 inline-flex items-center gap-1 text-xs text-slate-500" title="Salto forzado: notas/términos y firma empiezan en una página aparte">
                <input type="checkbox" checked={d.terms_page === 1} disabled={setTp.isPending} onChange={e => setTp.mutate({ id: d.id, on: e.target.checked })} /> Pág. términos
              </label>}
              {d.type === 'quote' && ['issued', 'draft'].includes(d.status) && <>
                <button className="btn-ghost text-xs" onClick={() => toInvoice.mutate({ id: d.id, percent: 50 })}>Facturar 50%</button>
                <button className="btn-ghost text-xs" onClick={() => toInvoice.mutate({ id: d.id, percent: 100 })}>Facturar 100%</button>
              </>}
              {d.status !== 'void' && <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Anular"
                onClick={() => confirm(`¿Anular ${d.number}? El número no se reutiliza.`) && voidDoc.mutate(d.id)}><Trash2 size={13} /></button>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const EXT_STATUS = { issued: 'Por cobrar', paid: 'Cobrada', void: 'Anulada' };

/** Invoices issued on other platforms (Remote…): no INV number, the PDF is the one from the platform. */
export function ExternalInvoiceTable({ clientId }) {
  const { data: rows = [] } = useApi(`/external-invoices${clientId ? `?client_id=${clientId}` : ''}`);
  if (!rows.length) return clientId ? null : <p className="px-4 py-3 text-sm text-slate-400">Sin facturas externas.</p>;
  return (
    <table className="w-full text-sm [&_td]:px-3 [&_td]:whitespace-nowrap [&_th]:px-3">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr><th className="px-4 py-2">Plataforma</th>{!clientId && <th>Cliente</th>}<th>Fecha</th><th className="text-right">Total</th><th className="pl-4">Estado</th><th></th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(e => (
          <tr key={e.id} className="group">
            <td className="px-4 py-2"><b>{e.platform}{e.reference ? ` ${e.reference}` : ''}</b><div className="whitespace-normal text-xs text-slate-500">{e.description}</div></td>
            {!clientId && <td><Link className="hover:text-brand" to={`/clients/${e.client_id}`}>{e.company}</Link></td>}
            <td>{date(e.issued_on)}{e.paid_on && <div className="text-xs text-slate-500">cobrada {date(e.paid_on)}</div>}</td>
            <td className="text-right">{money(e.amount, e.currency)}</td>
            <td className={`pl-4 ${STATUS_CLS[e.status] ?? ''}`}>{EXT_STATUS[e.status] ?? e.status}</td>
            <td className="pr-3 text-right"><ExternalPdf inv={e} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NewDocumentForm({ clientId, onDone }) {
  const { data: clients = [] } = useApi('/clients');
  const create = useMutate(body => api.post('/documents', body));
  const [f, setF] = useState({ type: 'quote', client_id: clientId ?? '', currency: 'GYD', due_date: '', notes: '', show_signature: true, terms_page: false });
  const [lines, setLines] = useState([{ description: '', qty: 1, unit_price: '', vat_rate: 0 }]);
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_price || 0) * (1 + Number(l.vat_rate)), 0);
  const submit = e => {
    e.preventDefault();
    create.mutate({
      ...f, client_id: Number(f.client_id), due_date: f.due_date || null, show_signature: f.type === 'quote' ? f.show_signature : undefined,
      lines: lines.filter(l => l.description.trim()).map(l => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), vat_rate: Number(l.vat_rate) })),
    }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <div><label className="label">Tipo</label>
          <select className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
            <option value="quote">Cotización</option><option value="invoice">Factura</option>
          </select>
        </div>
        <div className="col-span-2"><label className="label">Cliente</label>
          <select className="input" required value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })}>
            <option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </div>
        <div><label className="label">Moneda</label>
          <select className="input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}><option>GYD</option><option>USD</option></select>
        </div>
      </div>
      <div>
        <label className="label">Líneas</label>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input className="input flex-1" placeholder="Descripción" value={l.description} onChange={e => setLine(i, 'description', e.target.value)} />
              <input className="input w-16" type="number" min="0" step="any" value={l.qty} onChange={e => setLine(i, 'qty', e.target.value)} />
              <input className="input w-32" type="number" placeholder="Precio" value={l.unit_price} onChange={e => setLine(i, 'unit_price', e.target.value)} />
              <select className="input w-28" value={l.vat_rate} onChange={e => setLine(i, 'vat_rate', e.target.value)}>
                <option value={0}>Exento</option><option value={0.14}>VAT 14%</option>
              </select>
              <button type="button" className="btn-ghost" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setLines(ls => [...ls, { description: '', qty: 1, unit_price: '', vat_rate: 0 }])}><Plus size={12} /> Línea</button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div><label className="label">{f.type === 'quote' ? 'Válida hasta' : 'Vence'}</label><input className="input" type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
          {f.type === 'quote' && <label className="mt-3 flex items-center gap-2 text-sm" title="Cliente y emisor: nombre, cargo, firma y fecha al final del PDF">
            <input type="checkbox" checked={f.show_signature} onChange={e => setF({ ...f, show_signature: e.target.checked })} /> Bloque de firma
          </label>}
          <label className="mt-2 flex items-center gap-2 text-sm" title="Salto forzado: notas/términos (y firma) empiezan en una página aparte">
            <input type="checkbox" checked={f.terms_page} onChange={e => setF({ ...f, terms_page: e.target.checked })} /> Términos en página aparte
          </label>
        </div>
        <div className="col-span-3"><label className="label">Notas</label><textarea className="input min-h-20" rows={3} placeholder="Línea en blanco = nuevo párrafo" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600">Total: <b>{money(Math.round(total), f.currency)}</b> · el número se asigna al emitir</span>
        <button className="btn-primary" disabled={create.isPending}>Emitir</button>
      </div>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
    </form>
  );
}

export function NewDocumentButton({ clientId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={14} /> Nuevo documento</button>
      {open && <Modal title="Nueva cotización / factura" onClose={() => setOpen(false)}><NewDocumentForm clientId={clientId} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}

export default function Documents() {
  const [type, setType] = useState('');
  const { data: docs = [] } = useApi(type === 'external' ? null : `/documents${type ? `?type=${type}` : ''}`);
  return (
    <>
      <PageHeader title="Documentos">
        <select className="input w-40" value={type} onChange={e => setType(e.target.value)}>
          <option value="">Todos</option><option value="quote">Cotizaciones</option><option value="invoice">Facturas</option><option value="receipt">Recibos</option><option value="external">Facturas externas</option>
        </select>
        <NewDocumentButton />
      </PageHeader>
      <div className="space-y-4 p-6">
        {type !== 'external' && <div className="card"><DocumentTable docs={docs} /></div>}
        {['', 'invoice', 'external'].includes(type) && <section className="card">
          <header className="border-b border-slate-100 px-4 py-2.5"><h2 className="text-sm font-semibold text-ink">Facturas externas</h2></header>
          <ExternalInvoiceTable />
        </section>}
      </div>
    </>
  );
}
