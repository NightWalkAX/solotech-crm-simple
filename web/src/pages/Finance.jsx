import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Pencil, CheckCircle2, RefreshCw, FileText, Paperclip, X, HandCoins } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date, ago, todayISO } from '../lib/format.js';
import { PageHeader, Section, Modal } from '../components/ui.jsx';
import { DebtTiles } from './Debts.jsx';
import { PlanTable, NewPlanButton, ExternalPending } from '../components/RecurringPlans.jsx';

const KIND = { fixed: 'Fijo', variable: 'Flotante' };
const CYCLE = { weekly: 'Semanal', monthly: 'Mensual', quarterly: 'Trimestral', yearly: 'Anual' };
const MODE = { build: 'Build · Opus', edit: 'Edit · Sonnet' };
const gyd = n => money(Math.round(n ?? 0));
const usd = n => `US$${(n ?? 0).toFixed(2)}`;
const tok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0));
const amount = (a, cur) => (cur === 'GYD' ? money(Math.round(a)) : `US$${Number(a).toFixed(2)}`);
const plusYear = d => (d ? `${Number(d.slice(0, 4)) + 1}${d.slice(4)}` : '');
const monthBounds = m => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${m}-01`, to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
};
const monthLabel = m => {
  const s = new Date(`${m}-15T00:00:00Z`).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s[0].toUpperCase() + s.slice(1);
};

export function Tile({ label, value, sub, tone = 'text-ink' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function SubscriptionForm({ sub, onDone }) {
  const save = useMutate(body => (sub ? api.patch(`/subscriptions/${sub.id}`, body) : api.post('/subscriptions', body)));
  const [f, setF] = useState({ name: '', vendor: '', kind: 'fixed', amount: '', currency: 'USD', cycle: 'monthly', next_due: '', notes: '',
    started_on: '', quantity: 1, promo_amount: '', promo_until: '', ...sub });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const hasPromo = f.promo_amount !== '' && f.promo_amount != null;
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => {
      e.preventDefault();
      save.mutate({ name: f.name, vendor: f.vendor || null, kind: f.kind, amount: Number(f.amount), currency: f.currency, cycle: f.cycle, next_due: f.next_due || null, notes: f.notes || null,
        started_on: f.started_on || null, quantity: Number(f.quantity) || 1,
        promo_amount: hasPromo ? Number(f.promo_amount) : null, promo_until: hasPromo ? f.promo_until || null : null }, { onSuccess: onDone });
    }}>
      <div className="col-span-2"><label className="label">Nombre</label><input className="input" required value={f.name} onChange={set('name')} placeholder="Cloudflare Workers Paid" /></div>
      <div><label className="label">Proveedor</label><input className="input" value={f.vendor ?? ''} onChange={set('vendor')} /></div>
      <div><label className="label">Tipo</label>
        <select className="input" value={f.kind} onChange={set('kind')}><option value="fixed">Fijo</option><option value="variable">Flotante (por uso)</option></select>
      </div>
      <div><label className="label">{f.kind === 'variable' ? 'Estimado por ciclo' : 'Precio regular por ciclo'}</label><input className="input" type="number" step="any" min="0" required value={f.amount} onChange={set('amount')} /></div>
      <div><label className="label">Moneda</label><select className="input" value={f.currency} onChange={set('currency')}><option>USD</option><option>GYD</option></select></div>
      <div><label className="label">Ciclo</label>
        <select className="input" value={f.cycle} onChange={set('cycle')}>{Object.entries(CYCLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div><label className="label">Próximo cobro</label><input className="input" type="date" value={f.next_due ?? ''} onChange={set('next_due')} /></div>
      <div><label className="label">Notas</label><input className="input" value={f.notes ?? ''} onChange={set('notes')} /></div>
      <div><label className="label">Primera compra</label>
        <input className="input" type="date" value={f.started_on ?? ''} onChange={e => setF({ ...f, started_on: e.target.value, promo_until: f.promo_until || plusYear(e.target.value) })} />
      </div>
      <div><label className="label">Cantidad (licencias)</label><input className="input" type="number" min="1" step="1" value={f.quantity ?? 1} onChange={set('quantity')} /></div>
      <div className="col-span-3 grid grid-cols-3 gap-3 rounded-md bg-amber-50/60 p-3">
        <div className="col-span-3 text-xs text-slate-600">Precio de introducción (opcional): se cobra hasta la fecha indicada; después, el precio regular.</div>
        <div><label className="label">Precio promo por ciclo</label><input className="input" type="number" step="any" min="0" value={f.promo_amount ?? ''} onChange={set('promo_amount')} /></div>
        <div><label className="label">Promo hasta</label><input className="input" type="date" required={hasPromo} value={f.promo_until ?? ''} onChange={set('promo_until')} /></div>
        <div className="self-end pb-2 text-xs text-slate-500">Precios por licencia; el total se multiplica por la cantidad.</div>
      </div>
      <div className="col-span-3 flex items-center justify-end gap-3">
        {save.error && <span className="text-sm text-red-600">{save.error.message}</span>}
        <button className="btn-primary" disabled={save.isPending}>Guardar</button>
      </div>
    </form>
  );
}

function ExpenseForm({ sub, onDone }) {
  const add = useMutate(async ({ file, ...body }) => {
    const exp = await (sub ? api.post(`/subscriptions/${sub.id}/pay`, body) : api.post('/expenses', body));
    if (file) await api.upload(`/expenses/${exp.id}/receipt`, file);
    return exp;
  });
  const [f, setF] = useState({ description: '', amount: sub?.current_amount ?? '', currency: sub?.currency ?? 'USD', kind: 'variable', spent_on: todayISO(), budget_line_id: '', file: null });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const { data: budget } = useApi(sub ? null : '/budget');
  const tagged = budget?.lines.filter(l => l.active && l.kind === 'tagged') ?? [];
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); add.mutate({ ...f, amount: Number(f.amount), budget_line_id: f.budget_line_id ? Number(f.budget_line_id) : undefined }, { onSuccess: onDone }); }}>
      {!sub && <div className="col-span-3"><label className="label">Descripción</label><input className="input" required value={f.description} onChange={set('description')} placeholder="Facebook Ads — campaña octubre" /></div>}
      <div><label className="label">Monto</label><input className="input" type="number" step="any" min="0" required value={f.amount} onChange={set('amount')} /></div>
      {!sub && <div><label className="label">Moneda</label><select className="input" value={f.currency} onChange={set('currency')}><option>USD</option><option>GYD</option></select></div>}
      {!sub && <div><label className="label">Tipo</label><select className="input" value={f.kind} onChange={set('kind')}><option value="variable">Flotante</option><option value="fixed">Fijo</option></select></div>}
      <div><label className="label">Fecha</label><input className="input" type="date" value={f.spent_on} onChange={set('spent_on')} /></div>
      {tagged.length > 0 && <div className="col-span-2"><label className="label">Línea del presupuesto</label>
        <select className="input" value={f.budget_line_id} onChange={set('budget_line_id')}>
          <option value="">Según el tipo ({KIND[f.kind]})</option>{tagged.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>}
      <div className={sub ? 'col-span-2' : 'col-span-3'}><label className="label">Comprobante (PDF, opcional)</label>
        <input className="input" type="file" accept="application/pdf,.pdf" onChange={e => setF({ ...f, file: e.target.files[0] ?? null })} />
      </div>
      <div className="col-span-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{(sub?.currency ?? f.currency) === 'USD' ? 'Se convierte a GYD con la tasa de Demerara Bank de este momento y queda guardada.' : ''}</span>
        {add.error && <span className="text-sm text-red-600">{add.error.message}</span>}
        <button className="btn-primary" disabled={add.isPending}>{sub ? 'Registrar pago' : 'Agregar gasto'}</button>
      </div>
    </form>
  );
}

function Subscriptions({ subs }) {
  const [edit, setEdit] = useState(null); // null | {} (new) | sub
  const [pay, setPay] = useState(null);
  const toggle = useMutate(s => api.patch(`/subscriptions/${s.id}`, { active: !s.active }));
  const del = useMutate(id => api.del(`/subscriptions/${id}`));
  const today = todayISO();
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Suscripciones y OpEx recurrente</h2>
        <button className="btn-ghost text-xs" onClick={() => setEdit({})}><Plus size={12} /> Suscripción</button>
      </header>
      {!subs.length ? <p className="px-4 py-3 text-sm text-slate-400">Sin suscripciones. Agrega hosting, dominios, herramientas…</p> : (
        <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Nombre</th><th>Tipo</th><th className="text-right">Monto</th><th>Ciclo</th><th>Próximo</th><th className="text-right">≈ al mes</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subs.map(s => (
              <tr key={s.id} className={`group ${s.active ? '' : 'text-slate-400'}`}>
                <td><b className={s.active ? 'text-ink' : ''}>{s.name}</b>{s.vendor && <span className="text-xs text-slate-500"> · {s.vendor}</span>}{!s.active && <span className="text-xs"> (pausada)</span>}</td>
                <td><span className={`rounded px-1.5 py-0.5 text-xs ${s.kind === 'fixed' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-700'}`}>{KIND[s.kind]}</span></td>
                <td className="text-right tabular-nums">
                  {s.kind === 'variable' ? '≈ ' : ''}{amount(s.current_amount ?? s.amount * (s.quantity || 1), s.currency)}
                  {s.quantity > 1 && <div className="text-xs text-slate-500">{s.quantity} × {amount(s.current_amount / s.quantity, s.currency)}</div>}
                  {s.promo_active && <div className="text-xs text-amber-700" title={s.started_on ? `Primera compra ${date(s.started_on)}` : undefined}>promo hasta {date(s.promo_until)} → {amount(s.regular_total, s.currency)}</div>}
                </td>
                <td>{CYCLE[s.cycle]}</td>
                <td className={s.active && s.next_due && s.next_due <= today ? 'font-medium text-red-600' : ''}>{date(s.next_due)}</td>
                <td className="text-right tabular-nums">{gyd(s.monthly_gyd)}</td>
                <td className="whitespace-nowrap text-right">
                  {s.active ? <button className="btn-ghost text-xs" onClick={() => setPay(s)}><CheckCircle2 size={12} /> Pagado</button> : null}
                  <button className="btn-ghost px-1.5" title="Editar" onClick={() => setEdit(s)}><Pencil size={12} /></button>
                  <button className="btn-ghost text-xs" onClick={() => toggle.mutate(s)}>{s.active ? 'Pausar' : 'Activar'}</button>
                  <button className="invisible px-1 text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                    onClick={() => confirm(`¿Eliminar ${s.name}? Los gastos ya registrados se conservan.`) && del.mutate(s.id)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <Modal title={edit.id ? `Editar ${edit.name}` : 'Nueva suscripción'} onClose={() => setEdit(null)}><SubscriptionForm sub={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
      {pay && <Modal title={`Pago de ${pay.name}`} onClose={() => setPay(null)}><ExpenseForm sub={pay} onDone={() => setPay(null)} /></Modal>}
    </section>
  );
}

function Receipt({ e }) {
  const upload = useMutate(file => api.upload(`/expenses/${e.id}/receipt`, file));
  const remove = useMutate(() => api.del(`/expenses/${e.id}/receipt`));
  if (e.receipt_path) return (
    <span className="inline-flex items-center gap-1">
      <a className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline" href={`/api/expenses/${e.id}/receipt`} target="_blank" rel="noreferrer" title={e.receipt_name}>
        <FileText size={12} /> PDF
      </a>
      <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Quitar PDF"
        onClick={() => confirm('¿Quitar el PDF de este gasto?') && remove.mutate()}><X size={11} /></button>
    </span>
  );
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1 text-xs ${upload.error ? 'text-red-600' : 'text-slate-400 hover:text-ink'}`} title={upload.error?.message ?? 'Subir PDF del pago'}>
      <Paperclip size={12} /> {upload.isPending ? 'Subiendo…' : upload.error ? 'Error' : 'Subir'}
      <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={upload.isPending}
        onChange={ev => { const file = ev.target.files[0]; ev.target.value = ''; file && upload.mutate(file); }} />
    </label>
  );
}

// Starts on the selected month; the range can be widened to see other months' spending.
function Expenses({ month }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(() => monthBounds(month));
  const { data: rows = [] } = useApi(range.from && range.to ? `/expenses?from=${range.from}&to=${range.to}` : null, { placeholderData: prev => prev });
  const del = useMutate(id => api.del(`/expenses/${id}`));
  const total = rows.reduce((n, e) => n + (e.amount_gyd ?? 0), 0);
  return (
    <section className="card">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Gastos <span className="font-normal text-slate-500">· {gyd(total)}</span></h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          Desde <input className="input w-36 py-1 text-xs" type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          hasta <input className="input w-36 py-1 text-xs" type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          <button className="btn-ghost text-xs" onClick={() => setOpen(true)}><Plus size={12} /> Gasto</button>
        </div>
      </header>
      {!rows.length ? <p className="px-4 py-3 text-sm text-slate-400">Sin gastos registrados en este rango.</p> : (
        <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Fecha</th><th>Descripción</th><th>Tipo</th><th className="text-right">Monto</th><th className="text-right">Tasa</th><th className="text-right">GYD</th><th>Comprobante</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(e => (
              <tr key={e.id} className="group">
                <td className="whitespace-nowrap">{date(e.spent_on)}</td>
                <td>{e.description}</td>
                <td className="text-xs">{KIND[e.kind]}</td>
                <td className="text-right tabular-nums">{amount(e.amount, e.currency)}</td>
                <td className="text-right text-xs tabular-nums text-slate-500">{e.currency === 'GYD' ? '' : e.fx_rate}</td>
                <td className="text-right font-medium tabular-nums">{gyd(e.amount_gyd)}</td>
                <td className="whitespace-nowrap"><Receipt e={e} /></td>
                <td className="text-right">
                  <button className="invisible px-1 text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                    onClick={() => confirm('¿Eliminar este gasto?') && del.mutate(e.id)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <Modal title="Nuevo gasto" onClose={() => setOpen(false)}><ExpenseForm onDone={() => setOpen(false)} /></Modal>}
    </section>
  );
}

function IncomeForm({ onDone }) {
  const add = useMutate(body => api.post('/income', body));
  const [f, setF] = useState({ description: '', payer: '', amount: '', currency: 'GYD', received_on: todayISO(), notes: '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => {
      e.preventDefault();
      add.mutate({ ...f, amount: Number(f.amount), payer: f.payer || null, notes: f.notes || null }, { onSuccess: onDone });
    }}>
      <div className="col-span-2"><label className="label">Descripción</label><input className="input" required value={f.description} onChange={set('description')} placeholder="Pago en efectivo" /></div>
      <div><label className="label">Pagador</label><input className="input" value={f.payer} onChange={set('payer')} /></div>
      <div><label className="label">Monto</label><input className="input" type="number" step="any" min="0" required value={f.amount} onChange={set('amount')} /></div>
      <div><label className="label">Moneda</label><select className="input" value={f.currency} onChange={set('currency')}><option>GYD</option><option>USD</option></select></div>
      <div><label className="label">Fecha</label><input className="input" type="date" value={f.received_on} onChange={set('received_on')} /></div>
      <div className="col-span-3"><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div className="col-span-3 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">{f.currency === 'USD' ? 'Se convierte a GYD con la tasa de Demerara Bank de este momento y queda guardada.' : ''}</span>
        {add.error && <span className="text-sm text-red-600">{add.error.message}</span>}
        <button className="btn-primary" disabled={add.isPending}>Agregar ingreso</button>
      </div>
    </form>
  );
}

// Income outside CRM receipts (cash, transfers, external receipt books; past USDT rows keep their 240 rate). Same range behaviour as Expenses.
function Income({ month }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(() => monthBounds(month));
  const { data: rows = [] } = useApi(range.from && range.to ? `/income?from=${range.from}&to=${range.to}` : null, { placeholderData: prev => prev });
  const del = useMutate(id => api.del(`/income/${id}`));
  const total = rows.reduce((n, e) => n + (e.amount_gyd ?? 0), 0);
  return (
    <section className="card">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Otros ingresos <span className="font-normal text-slate-500">· {gyd(total)}</span></h2>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          Desde <input className="input w-36 py-1 text-xs" type="date" value={range.from} max={range.to} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          hasta <input className="input w-36 py-1 text-xs" type="date" value={range.to} min={range.from} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          <button className="btn-ghost text-xs" onClick={() => setOpen(true)}><Plus size={12} /> Ingreso</button>
        </div>
      </header>
      {!rows.length ? <p className="px-4 py-3 text-sm text-slate-400">Sin otros ingresos en este rango.</p> : (
        <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Fecha</th><th>Descripción</th><th>Pagador</th><th className="text-right">Monto</th><th className="text-right">Tasa</th><th className="text-right">GYD</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(e => (
              <tr key={e.id} className="group">
                <td className="whitespace-nowrap">{date(e.received_on)}</td>
                <td>{e.description}{e.notes && <div className="text-xs text-slate-500">{e.notes}</div>}</td>
                <td className="text-xs">{e.payer}</td>
                <td className="text-right tabular-nums">{amount(e.amount, e.currency)}</td>
                <td className="text-right text-xs tabular-nums text-slate-500">{e.currency === 'GYD' ? '' : e.fx_rate}</td>
                <td className="text-right font-medium tabular-nums text-emerald-700">{gyd(e.amount_gyd)}</td>
                <td className="text-right">
                  <button className="invisible px-1 text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                    onClick={() => confirm('¿Eliminar este ingreso?') && del.mutate(e.id)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && <Modal title="Nuevo ingreso" onClose={() => setOpen(false)}><IncomeForm onDone={() => setOpen(false)} /></Modal>}
    </section>
  );
}

// Recurring income from clients: each cycle is billed from here and counts as income once the receipt lands.
function Plans({ plans }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Ingresos recurrentes de clientes</h2>
        <NewPlanButton ghost />
      </header>
      <PlanTable plans={plans} />
      <ExternalPending />
    </section>
  );
}

const LINE_KIND = { salary: 'Salario', reserve: 'Reserva impuestos', fixed: 'Gastos fijos', variable: 'Gastos flotantes', tagged: 'Etiquetado' };
const LINE_HELP = {
  salary: 'Real = salario pagado (botón "Pagar salario").',
  reserve: 'Real = lo apartado en la cuenta de impuestos (pestaña Impuestos).',
  fixed: 'Real = gastos de tipo Fijo que no van a una línea etiquetada.',
  variable: 'Real = gastos de tipo Flotante que no van a una línea etiquetada (los tokens de Claude no cuentan).',
  tagged: 'Real = solo los gastos que asignes a esta línea al registrarlos (ej. Facebook Ads).',
};

function BudgetLineForm({ line, onDone }) {
  const save = useMutate(body => (line ? api.patch(`/budget-lines/${line.id}`, body) : api.post('/budget-lines', body)));
  const [f, setF] = useState({ name: '', kind: 'variable', amount_gyd: '', notes: '', ...line });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); save.mutate({ name: f.name, kind: f.kind, amount_gyd: Number(f.amount_gyd), notes: f.notes || null }, { onSuccess: onDone }); }}>
      <div className="col-span-2"><label className="label">Nombre</label><input className="input" required autoFocus value={f.name} onChange={set('name')} placeholder="Facebook Ads" /></div>
      <div><label className="label">Monto al mes (GYD)</label><input className="input" type="number" min="0" step="1" required value={f.amount_gyd} onChange={set('amount_gyd')} /></div>
      <div><label className="label">Tipo</label>
        <select className="input" value={f.kind} onChange={set('kind')}>{Object.entries(LINE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div className="col-span-2"><label className="label">Notas</label><input className="input" value={f.notes ?? ''} onChange={set('notes')} /></div>
      <p className="col-span-3 text-xs text-slate-500">{LINE_HELP[f.kind]}</p>
      <div className="col-span-3 flex items-center justify-end gap-3">
        {save.error && <span className="text-sm text-red-600">{save.error.message}</span>}
        <button className="btn-primary" disabled={save.isPending}>Guardar</button>
      </div>
    </form>
  );
}

function SalaryForm({ amount, onDone }) {
  const add = useMutate(body => api.post('/owner-moves', body));
  const [f, setF] = useState({ amount_gyd: amount || '', moved_on: todayISO(), notes: '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); add.mutate({ kind: 'salary', ...f, amount_gyd: Number(f.amount_gyd) }, { onSuccess: onDone }); }}>
      <div><label className="label">Monto (GYD)</label><input className="input" type="number" min="1" step="1" required value={f.amount_gyd} onChange={set('amount_gyd')} /></div>
      <div><label className="label">Fecha</label><input className="input" type="date" value={f.moved_on} onChange={set('moved_on')} /></div>
      <div><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <p className="col-span-3 text-xs text-slate-500">Tu salario sale de la utilidad: no es un gasto del negocio ni baja los impuestos.</p>
      <div className="col-span-3 flex items-center justify-end gap-3">
        {add.error && <span className="text-sm text-red-600">{add.error.message}</span>}
        <button className="btn-primary" disabled={add.isPending}>Registrar salario</button>
      </div>
    </form>
  );
}

// Monthly plan per line vs. what really happened (server/budget.js).
function Budget({ month }) {
  const { data: b } = useApi(`/budget?month=${month}`);
  const [edit, setEdit] = useState(null);
  const [salary, setSalary] = useState(false);
  const toggle = useMutate(l => api.patch(`/budget-lines/${l.id}`, { active: !l.active }));
  const del = useMutate(id => api.del(`/budget-lines/${id}`));
  const delMove = useMutate(id => api.del(`/owner-moves/${id}`));
  if (!b) return null;
  const t = b.totals;
  const salaryLine = b.lines.find(l => l.active && l.kind === 'salary');
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Presupuesto del mes <span className="font-normal text-slate-500">· plan {gyd(t.planned)} · real {gyd(t.actual)}</span></h2>
        <span className="flex gap-1">
          {salaryLine && <button className="btn-ghost text-xs" onClick={() => setSalary(true)}><HandCoins size={12} /> Pagar salario</button>}
          <button className="btn-ghost text-xs" onClick={() => setEdit({})}><Plus size={12} /> Línea</button>
        </span>
      </header>
      {!b.lines.length ? <p className="px-4 py-3 text-sm text-slate-400">Sin presupuesto. Agrega tu salario, gastos fijos, flotantes, anuncios y la reserva de impuestos.</p> : (
        <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-2">Línea</th><th>Tipo</th><th className="text-right">Plan</th><th className="text-right">Real</th><th className="w-48">Avance</th><th className="text-right">Queda</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {b.lines.map(l => {
              const pct = l.amount_gyd ? Math.round(l.actual / l.amount_gyd * 100) : 0;
              const over = l.actual > l.amount_gyd;
              return (
                <tr key={l.id} className={`group ${l.active ? '' : 'text-slate-400'}`}>
                  <td className="whitespace-nowrap" title={l.notes ?? undefined}><b className={l.active ? 'text-ink' : ''}>{l.name}</b>{!l.active && ' (pausada)'}</td>
                  <td className="text-xs">{LINE_KIND[l.kind]}</td>
                  <td className="text-right tabular-nums">{gyd(l.amount_gyd)}</td>
                  <td className="text-right tabular-nums">{gyd(l.actual)}</td>
                  <td>
                    <div className="h-1.5 w-full rounded bg-slate-100"><div className={`h-1.5 rounded ${over && l.kind !== 'reserve' ? 'bg-red-500' : 'bg-amber'}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                    <div className="mt-0.5 text-[10px] text-slate-500">{pct}%</div>
                  </td>
                  <td className={`text-right tabular-nums ${over && l.kind !== 'reserve' ? 'text-red-600' : ''}`}>{gyd(l.amount_gyd - l.actual)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost px-1.5" title="Editar" onClick={() => setEdit(l)}><Pencil size={12} /></button>
                    <button className="btn-ghost text-xs" onClick={() => toggle.mutate(l)}>{l.active ? 'Pausar' : 'Activar'}</button>
                    <button className="invisible px-1 text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                      onClick={() => confirm(`¿Eliminar la línea ${l.name}? Los gastos asignados vuelven a su tipo.`) && del.mutate(l.id)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-4 gap-3 border-t border-slate-100 px-4 py-3 text-sm">
        <div><div className="text-xs text-slate-500">Cobrado este mes</div><b className="tabular-nums text-emerald-700">{gyd(t.income)}</b></div>
        <div><div className="text-xs text-slate-500">Recurrente esperado</div><b className="tabular-nums">{gyd(t.expected_income)}</b>
          <div className={`text-xs ${t.expected_income < t.planned ? 'text-red-600' : 'text-slate-500'}`}>{t.expected_income < t.planned ? `no cubre el plan: faltan ${gyd(t.planned - t.expected_income)}` : 'cubre el plan'}</div></div>
        <div><div className="text-xs text-slate-500">Sin presupuesto</div><b className="tabular-nums">{gyd(b.unbudgeted)}</b></div>
        <div><div className="text-xs text-slate-500">Queda del mes</div><b className={`tabular-nums ${t.left < 0 ? 'text-red-600' : ''}`}>{gyd(t.left)}</b><div className="text-xs text-slate-500">cobrado − real</div></div>
      </div>
      {b.salary.length > 0 && (
        <div className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          Salario pagado: {b.salary.map(m => (
            <span key={m.id} className="group inline-flex items-center gap-1">{date(m.moved_on)} <b>{gyd(m.amount_gyd)}</b>
              <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar" onClick={() => confirm('¿Eliminar este pago de salario?') && delMove.mutate(m.id)}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {edit && <Modal title={edit.id ? `Editar ${edit.name}` : 'Nueva línea del presupuesto'} onClose={() => setEdit(null)}><BudgetLineForm line={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
      {salary && <Modal title="Pagar salario" onClose={() => setSalary(false)}><SalaryForm amount={salaryLine?.amount_gyd} onDone={() => setSalary(false)} /></Modal>}
    </section>
  );
}

function Tokens({ t }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Tokens de Claude (costo API)</h2>
        <span className="text-xs text-slate-500">{t.turns} respuesta{t.turns === 1 ? '' : 's'}</span>
      </header>
      <div className="grid grid-cols-5 gap-3 px-4 py-3 text-sm">
        <div><div className="text-xs text-slate-500">Costo</div><b className="tabular-nums">{gyd(t.gyd)}</b><div className="text-xs text-slate-500">{usd(t.usd)}</div></div>
        <div><div className="text-xs text-slate-500">↑ Entrada</div><b className="tabular-nums">{tok(t.input)}</b></div>
        <div><div className="text-xs text-slate-500">↓ Salida</div><b className="tabular-nums">{tok(t.output)}</b></div>
        <div><div className="text-xs text-slate-500">Cache leído</div><b className="tabular-nums">{tok(t.cache_read)}</b></div>
        <div><div className="text-xs text-slate-500">Cache escrito</div><b className="tabular-nums">{tok(t.cache_write)}</b></div>
      </div>
      {t.by_mode.length > 0 && (
        <div className="flex gap-4 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
          {t.by_mode.map(m => <span key={m.mode}>{MODE[m.mode] ?? 'Sin modo'}: <b>{gyd(m.gyd)}</b> ({m.turns})</span>)}
        </div>
      )}
    </section>
  );
}

export default function Finance() {
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const { data } = useApi(`/finance?month=${month}`);
  const { data: plans } = useApi('/plans');
  const refresh = useMutate(() => api.get('/fx?refresh=1'));
  if (!data) return <PageHeader title="Finanzas" />;
  const { totals: t, fx, budget } = data;
  return (
    <>
      <PageHeader title="Finanzas">
        {fx && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500" title={`Compra ${fx.buy ?? '—'} · Venta ${fx.sell} (no efectivo, "Others")`}>
            Demerara Bank USD <b className="text-slate-700">G${fx.sell}</b> · {ago(fx.fetched_at)}
            <button className="btn-ghost px-1" title="Actualizar tasa" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
              <RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} />
            </button>
          </span>
        )}
        <input className="input w-40" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
      </PageHeader>
      <div className="space-y-5 p-6">
        <div className="grid grid-cols-6 gap-3">
          <Tile label="Cobrado" value={gyd(t.income)} sub={`recibos ${gyd(t.income_receipts)} · otros ${gyd(t.income_other)}`} tone="text-emerald-700" />
          <Tile label="Recurrente / mes" value={gyd(plans?.totals.mrr_gyd)} tone="text-emerald-700"
            sub={`${plans?.totals.active ?? 0} plan${plans?.totals.active === 1 ? '' : 'es'}${budget.fixed_gyd ? ` · cubre ${Math.round((plans?.totals.mrr_gyd ?? 0) / budget.fixed_gyd * 100)}% del fijo` : ''}`} />
          <Tile label="OpEx fijo" value={gyd(t.fixed)} sub={`presupuesto ${gyd(budget.fixed_gyd)}/mes`} />
          <Tile label="OpEx flotante" value={gyd(t.variable)} sub={`tokens ${gyd(t.tokens_gyd)} · otros ${gyd(t.variable - t.tokens_gyd)}`} />
          <Tile label="Margen" value={gyd(t.margin)} sub={<>{monthLabel(month)} · <Link className="hover:underline" to="/taxes" title="Después de NIS y renta estimados, sin tokens">neto de impuestos {gyd(data.taxes.net_real)}</Link></>} tone={t.margin < 0 ? 'text-red-600' : 'text-ink'} />
          <Tile label="Por cobrar" value={gyd(t.receivable)} sub="facturas abiertas, incl. externas" tone="text-amber-700" />
        </div>
        <DebtTiles />
        <Budget month={month} />
        <Tokens t={data.tokens} />
        <Plans plans={plans?.plans ?? []} />
        <Subscriptions subs={data.subscriptions} />
        <Income key={`i${month}`} month={month} />
        <Expenses key={month} month={month} />
        <Section title="Últimos 6 meses">
          <table className="w-full text-sm [&_td]:px-4 [&_td]:py-1.5 [&_th]:px-4">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Mes</th><th className="text-right">Cobrado</th><th className="text-right">Fijo</th><th className="text-right">Flotante</th><th className="text-right">de ello tokens</th><th className="text-right">Margen</th><th className="text-right">NIS</th><th className="text-right">Renta</th><th className="text-right" title="Dinero real (sin tokens) menos NIS y renta estimados">Neto de impuestos</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {data.history.map(h => (
                <tr key={h.month} className={h.month === month ? 'bg-slate-50 font-medium' : ''}>
                  <td>{monthLabel(h.month)}</td>
                  <td className="text-right">{gyd(h.income)}</td>
                  <td className="text-right">{gyd(h.fixed)}</td>
                  <td className="text-right">{gyd(h.variable)}</td>
                  <td className="text-right text-slate-500">{gyd(h.tokens_gyd)}</td>
                  <td className={`text-right ${h.margin < 0 ? 'text-red-600' : ''}`}>{gyd(h.margin)}</td>
                  <td className="text-right text-slate-500">{gyd(h.nis)}</td>
                  <td className="text-right text-slate-500">{gyd(h.income_tax)}</td>
                  <td className={`text-right ${h.net_real < 0 ? 'text-red-600' : ''}`}>{h.net_real == null ? '—' : gyd(h.net_real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </>
  );
}
