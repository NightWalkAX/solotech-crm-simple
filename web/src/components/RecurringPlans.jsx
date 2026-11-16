import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Pencil, Trash2, FileText, Pause, Play, CheckCircle2, ExternalLink, X, Paperclip } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date, todayISO } from '../lib/format.js';
import { Modal } from './ui.jsx';

export const PLAN_CYCLE = { days15: 'Cada 15 días', monthly: 'Mensual', quarterly: 'Trimestral', yearly: 'Anual' };

function PlanForm({ plan, clientId, onDone }) {
  const { data: clients = [] } = useApi(clientId ? null : '/clients');
  const save = useMutate(body => (plan ? api.patch(`/plans/${plan.id}`, body) : api.post('/plans', body)));
  const [f, setF] = useState({
    client_id: plan?.client_id ?? clientId ?? '', name: plan?.name ?? '', amount: plan?.amount ?? '', currency: plan?.currency ?? 'GYD',
    cycle: plan?.cycle ?? 'monthly', started_on: plan?.started_on ?? todayISO(), next_due: plan?.next_due ?? '', notes: plan?.notes ?? '',
    billing: plan?.billing ?? 'crm', billing_platform: plan?.billing_platform ?? '',
  });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = e => {
    e.preventDefault();
    save.mutate({ ...f, client_id: Number(f.client_id), amount: Number(f.amount), next_due: f.next_due || null, notes: f.notes || null,
      billing_platform: f.billing_platform || null }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-3 gap-3">
      {!clientId && !plan && (
        <div className="col-span-3"><label className="label">Cliente</label>
          <select className="input" required value={f.client_id} onChange={set('client_id')}>
            <option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </div>
      )}
      <div className="col-span-3"><label className="label">Concepto (sale en la factura, en inglés)</label>
        <input className="input" required autoFocus value={f.name} onChange={set('name')} placeholder="Website maintenance" />
      </div>
      <div><label className="label">Monto por ciclo</label><input className="input" type="number" min="0" step="any" required value={f.amount} onChange={set('amount')} /></div>
      <div><label className="label">Moneda</label><select className="input" value={f.currency} onChange={set('currency')}><option>GYD</option><option>USD</option></select></div>
      <div><label className="label">Ciclo</label>
        <select className="input" value={f.cycle} onChange={set('cycle')}>{Object.entries(PLAN_CYCLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div><label className="label">Inicio</label><input className="input" type="date" value={f.started_on ?? ''} onChange={set('started_on')} /></div>
      <div><label className="label">Próximo cobro</label><input className="input" type="date" value={f.next_due ?? ''} onChange={set('next_due')} /></div>
      <div><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div><label className="label">Se factura en</label>
        <select className="input" value={f.billing} onChange={set('billing')}><option value="crm">CRM (INV)</option><option value="external">Otra plataforma</option></select>
      </div>
      {f.billing === 'external' && <div><label className="label">Plataforma</label><input className="input" required value={f.billing_platform} onChange={set('billing_platform')} placeholder="Remote" /></div>}
      <div className="col-span-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{plan ? '' : 'Sin próximo cobro, el primero es la fecha de inicio.'}</span>
        {save.error && <span className="text-sm text-red-600">{save.error.message}</span>}
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

const BillChoice = ({ value, onChange }) => (
  <div className="col-span-2 flex gap-2">
    {[['crm', 'Factura del CRM (INV)'], ['external', 'Factura externa']].map(([k, label]) => (
      <button type="button" key={k} onClick={() => onChange(k)}
        className={`btn flex-1 justify-center ring-1 ${value === k ? 'bg-slate-900 text-white ring-slate-900' : 'text-slate-500 ring-slate-200'}`}>{label}</button>
    ))}
  </div>
);

function InvoicePlanForm({ plan, onDone }) {
  const bill = useMutate(body => api.post(`/plans/${plan.id}/invoice`, body));
  const [f, setF] = useState({ kind: plan.billing ?? 'crm', platform: plan.billing_platform ?? '', reference: '', amount: plan.amount, issue_date: todayISO() });
  const [file, setFile] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const external = f.kind === 'external';
  const submit = e => {
    e.preventDefault();
    bill.mutate(external
      ? { external: true, platform: f.platform, reference: f.reference || null, amount: Number(f.amount), issue_date: f.issue_date }
      : { external: false, amount: Number(f.amount) }, {
      onSuccess: async row => {
        if (external && file) await api.upload(`/external-invoices/${row.id}/pdf`, file).catch(err => alert(`Factura registrada, pero el PDF no se subió: ${err.message}`));
        onDone();
      },
    });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <BillChoice value={f.kind} onChange={kind => setF({ ...f, kind })} />
      <p className="col-span-2 text-sm text-slate-600">Ciclo que empieza el <b>{date(plan.next_due)}</b> · {PLAN_CYCLE[plan.cycle]}</p>
      {external && <>
        <div><label className="label">Plataforma</label><input className="input" required autoFocus value={f.platform} onChange={set('platform')} placeholder="Remote" /></div>
        <div><label className="label">Referencia (opcional)</label><input className="input" value={f.reference} onChange={set('reference')} placeholder="Nº de factura en la plataforma" /></div>
      </>}
      <div><label className="label">Monto ({plan.currency})</label><input className="input" type="number" min="0" step="any" required value={f.amount} onChange={set('amount')} /></div>
      {external && <div><label className="label">Fecha</label><input className="input" type="date" value={f.issue_date} onChange={set('issue_date')} /></div>}
      {external && <div className="col-span-2"><label className="label">PDF de la factura (opcional)</label>
        <input className="input" type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files[0] ?? null)} /></div>}
      <div className="col-span-2 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{external
          ? 'No usa número INV. Queda por cobrar hasta que marques «Cobrado».'
          : 'Se emite la siguiente factura INV con su PDF.'}</span>
        {bill.error && <span className="text-sm text-red-600">{bill.error.message}</span>}
        <button className="btn-primary" disabled={bill.isPending}>{bill.isPending ? 'Guardando…' : external ? 'Registrar factura externa' : 'Emitir factura'}</button>
      </div>
    </form>
  );
}

/** Bills the plan's next cycle: CRM invoice or one issued on another platform (moves next_due one cycle). */
export function InvoicePlanButton({ plan }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost px-2 py-0.5 text-xs" title={`Facturar el ciclo que empieza el ${date(plan.next_due)}`} onClick={() => setOpen(true)}>
        <FileText size={12} /> Facturar
      </button>
      {open && <Modal title={`Facturar ${plan.name} · ${plan.company}`} onClose={() => setOpen(false)}><InvoicePlanForm plan={plan} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}

function ExternalPaidForm({ inv, onDone }) {
  const pay = useMutate(body => api.post(`/external-invoices/${inv.id}/paid`, body));
  const { data: fx } = useApi('/fx');
  const [f, setF] = useState({ amount: inv.amount, currency: inv.currency, received_on: todayISO() });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-2 gap-3" onSubmit={e => {
      e.preventDefault();
      pay.mutate({ ...f, amount: Number(f.amount) }, { onSuccess: onDone });
    }}>
      <p className="col-span-2 text-sm text-slate-600">{inv.description} · {inv.platform}{inv.reference ? ` ${inv.reference}` : ''}</p>
      <div><label className="label">Monto recibido</label><input className="input" type="number" min="0" step="any" required value={f.amount} onChange={set('amount')} /></div>
      <div><label className="label">Moneda</label><select className="input" value={f.currency} onChange={set('currency')}><option>USD</option><option>GYD</option></select></div>
      <div><label className="label">Fecha</label><input className="input" type="date" value={f.received_on} onChange={set('received_on')} /></div>
      <div className="col-span-2 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">Se registra en Finanzas como ingreso{f.currency === 'USD'
          ? ` a la tasa de Demerara Bank${f.received_on < todayISO() ? ' de ese día' : fx ? ` (hoy G$${fx.sell} → ${money(Math.round(Number(f.amount || 0) * fx.sell))})` : ''}` : ''}.</span>
        {pay.error && <span className="text-sm text-red-600">{pay.error.message}</span>}
        <button className="btn-primary" disabled={pay.isPending}>{pay.isPending ? 'Guardando…' : 'Registrar cobro'}</button>
      </div>
    </form>
  );
}

/** PDF of an external invoice: link + remove, or upload. */
export function ExternalPdf({ inv }) {
  const upload = useMutate(file => api.upload(`/external-invoices/${inv.id}/pdf`, file));
  const remove = useMutate(() => api.del(`/external-invoices/${inv.id}/pdf`));
  if (inv.pdf_name) return (
    <span className="inline-flex items-center gap-1">
      <a className="btn-ghost text-xs" href={`/api/external-invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer" title={inv.pdf_name}><FileText size={13} /> PDF</a>
      <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Quitar PDF"
        onClick={() => confirm('¿Quitar el PDF de esta factura externa?') && remove.mutate()}><X size={11} /></button>
    </span>
  );
  return (
    <label className={`btn-ghost cursor-pointer text-xs ${upload.error ? 'text-red-600' : 'text-slate-400 hover:text-ink'}`} title={upload.error?.message ?? 'Subir PDF de la factura'}>
      <Paperclip size={12} /> {upload.isPending ? 'Subiendo…' : upload.error ? 'Error' : 'Subir PDF'}
      <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={upload.isPending}
        onChange={ev => { const file = ev.target.files[0]; ev.target.value = ''; file && upload.mutate(file); }} />
    </label>
  );
}

/** Open external invoices (billed on Remote etc.) with Cobrado / Anular. */
export function ExternalRows({ rows, showClient = true }) {
  const [paying, setPaying] = useState(null);
  const voidIt = useMutate(id => api.post(`/external-invoices/${id}/void`));
  const today = todayISO();
  return (
    <>
      {rows.map(e => (
        <div key={e.id} className="group flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700"><ExternalLink size={10} /> {e.platform}{e.reference ? ` ${e.reference}` : ''}</span>
            {showClient && <> <Link className="font-medium hover:text-brand" to={`/clients/${e.client_id}`}>{e.company}</Link> ·</>} {e.description}
            <span className={`ml-2 text-xs ${e.issued_on < today ? 'text-slate-500' : 'text-slate-400'}`}>{date(e.issued_on)}</span>
          </span>
          <span className="font-medium text-red-600">{money(e.amount, e.currency)}</span>
          <ExternalPdf inv={e} />
          <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setPaying(e)}><CheckCircle2 size={12} /> Cobrado</button>
          <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Anular"
            onClick={() => confirm('¿Anular esta factura externa? El próximo cobro del plan no cambia.') && voidIt.mutate(e.id)}><X size={13} /></button>
        </div>
      ))}
      {paying && <Modal title={`Cobro · ${paying.company}`} onClose={() => setPaying(null)}><ExternalPaidForm inv={paying} onDone={() => setPaying(null)} /></Modal>}
    </>
  );
}

/** Open external invoices section (self-fetching); renders nothing when there are none. */
export function ExternalPending({ clientId }) {
  const { data: rows = [] } = useApi(`/external-invoices?status=issued${clientId ? `&client_id=${clientId}` : ''}`);
  if (!rows.length) return null;
  return (
    <div className="border-t border-slate-100">
      <div className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Facturas externas por cobrar</div>
      <div className="divide-y divide-slate-100"><ExternalRows rows={rows} showClient={!clientId} /></div>
    </div>
  );
}

export function PlanTable({ plans, showClient = true }) {
  const [edit, setEdit] = useState(null);
  const toggle = useMutate(p => api.patch(`/plans/${p.id}`, { active: !p.active }));
  const del = useMutate(id => api.del(`/plans/${id}`));
  const today = todayISO();
  if (!plans.length) return <p className="px-4 py-3 text-sm text-slate-400">Sin planes recurrentes.</p>;
  return (
    <>
      <div className="overflow-x-auto">
      <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="py-2">Concepto</th>{showClient && <th>Cliente</th>}<th className="text-right">Monto</th><th>Próximo</th>{showClient && <><th>Última</th><th className="text-right">≈ al mes</th></>}<th></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {plans.map(p => (
            <tr key={p.id} className={`group ${p.active ? '' : 'text-slate-400'}`}>
              <td><b className={p.active ? 'text-ink' : ''}>{p.name}</b>{!p.active && <span className="text-xs"> (pausado)</span>}
                {p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}</td>
              {showClient && <td><Link className="hover:text-brand" to={`/clients/${p.client_id}`}>{p.company}</Link></td>}
              <td className="whitespace-nowrap text-right tabular-nums">{money(p.amount, p.currency)}<div className="text-xs text-slate-500">{PLAN_CYCLE[p.cycle]}</div></td>
              <td className={`whitespace-nowrap ${p.active && p.next_due && p.next_due <= today ? 'font-medium text-red-600' : ''}`}>{date(p.next_due)}</td>
              {showClient && <td className="whitespace-nowrap text-xs text-slate-500">{p.last_invoice ? <>{p.last_invoice}<div>{date(p.last_invoiced_on)}</div></> : '—'}</td>}
              {showClient && <td className="text-right tabular-nums">{money(p.monthly_gyd)}</td>}
              <td className="whitespace-nowrap text-right">
                {p.active ? <InvoicePlanButton plan={p} /> : null}
                <button className="btn-ghost px-1.5" title="Editar" onClick={() => setEdit(p)}><Pencil size={12} /></button>
                <button className="btn-ghost px-1.5" title={p.active ? 'Pausar' : 'Activar'} onClick={() => toggle.mutate(p)}>{p.active ? <Pause size={12} /> : <Play size={12} />}</button>
                <button className="invisible px-1 text-slate-400 hover:text-red-600 group-hover:visible" title={p.last_invoice ? 'Ya tiene facturas: páusalo' : 'Eliminar'}
                  disabled={!!p.last_invoice} onClick={() => confirm(`¿Eliminar ${p.name}?`) && del.mutate(p.id)}><Trash2 size={12} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {edit && <Modal title={`Editar ${edit.name}`} onClose={() => setEdit(null)}><PlanForm plan={edit} onDone={() => setEdit(null)} /></Modal>}
    </>
  );
}

export function NewPlanButton({ clientId, ghost = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={ghost ? 'btn-ghost text-xs' : 'btn-primary'} onClick={() => setOpen(true)}><Plus size={ghost ? 12 : 14} /> Plan recurrente</button>
      {open && <Modal title="Nuevo plan recurrente" onClose={() => setOpen(false)}><PlanForm clientId={clientId} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}
