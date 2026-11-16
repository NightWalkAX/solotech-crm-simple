import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Pencil, Trash2, HandCoins, ChevronDown, ChevronRight } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date, todayISO } from '../lib/format.js';
import { PageHeader, Modal } from '../components/ui.jsx';

export const DIRECTION = { receivable: 'Me deben', payable: 'Yo debo' };
const amount = (a, cur) => money(Math.round(a * 100) / 100, cur);

function DebtForm({ debt, clientId, direction = 'payable', onDone }) {
  const { data: clients = [] } = useApi('/clients');
  const save = useMutate(body => (debt ? api.patch(`/debts/${debt.id}`, body) : api.post('/debts', body)));
  const [f, setF] = useState({
    direction: debt?.direction ?? direction, client_id: debt?.client_id ?? clientId ?? '', counterparty: debt?.counterparty ?? '',
    description: debt?.description ?? '', amount: debt?.amount ?? '', currency: debt?.currency ?? 'GYD',
    started_on: debt?.started_on ?? todayISO(), due_date: debt?.due_date ?? '', notes: debt?.notes ?? '',
  });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = e => {
    e.preventDefault();
    save.mutate({ ...f, client_id: f.client_id ? Number(f.client_id) : null, amount: Number(f.amount), due_date: f.due_date || null }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-4 gap-3">
      <div className="col-span-4 flex gap-2">
        {Object.entries(DIRECTION).map(([k, label]) => (
          <button type="button" key={k} onClick={() => setF({ ...f, direction: k })}
            className={`btn flex-1 justify-center ring-1 ${f.direction === k ? (k === 'payable' ? 'bg-red-50 text-red-700 ring-red-300' : 'bg-emerald-50 text-emerald-700 ring-emerald-300') : 'text-slate-500 ring-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="col-span-4"><label className="label">Concepto</label><input className="input" required autoFocus value={f.description} onChange={set('description')} placeholder="Ej. Préstamo personal" /></div>
      <div className="col-span-2"><label className="label">Cliente</label>
        <select className="input" value={f.client_id} onChange={set('client_id')}>
          <option value="">— (no es cliente)</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className="label">{f.direction === 'payable' ? 'A quién' : 'Quién'}</label><input className="input" value={f.counterparty} onChange={set('counterparty')} placeholder="Persona, banco…" /></div>
      <div className="col-span-2"><label className="label">Monto original</label><input className="input" type="number" min="0" step="any" required value={f.amount} onChange={set('amount')} /></div>
      <div className="col-span-2"><label className="label">Moneda</label>
        <select className="input" value={f.currency} onChange={set('currency')}><option>GYD</option><option>USD</option></select>
      </div>
      <div className="col-span-2"><label className="label">Desde</label><input className="input" type="date" value={f.started_on} onChange={set('started_on')} /></div>
      <div className="col-span-2"><label className="label">Vence</label><input className="input" type="date" value={f.due_date} onChange={set('due_date')} /></div>
      <div className="col-span-4"><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div className="col-span-4 flex items-center justify-between">
        <span className="text-sm text-red-600">{save.error?.message}</span>
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

function PaymentForm({ debt, onDone }) {
  const pay = useMutate(body => api.post(`/debts/${debt.id}/payments`, body));
  const [f, setF] = useState({ amount: debt.balance, paid_on: todayISO(), notes: '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = e => {
    e.preventDefault();
    pay.mutate({ ...f, amount: Number(f.amount) }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-4 gap-3">
      <p className="col-span-4 text-sm text-slate-600">Saldo pendiente: <b>{amount(debt.balance, debt.currency)}</b></p>
      <div className="col-span-2"><label className="label">Abono ({debt.currency})</label><input className="input" type="number" min="0" step="any" max={debt.balance} required autoFocus value={f.amount} onChange={set('amount')} /></div>
      <div className="col-span-2"><label className="label">Fecha</label><input className="input" type="date" required value={f.paid_on} onChange={set('paid_on')} /></div>
      <div className="col-span-4"><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} placeholder="Efectivo, transferencia…" /></div>
      <div className="col-span-4 flex items-center justify-between">
        <span className="text-sm text-red-600">{pay.error?.message}</span>
        <button className="btn-primary" disabled={pay.isPending}>{pay.isPending ? 'Guardando…' : 'Registrar abono'}</button>
      </div>
    </form>
  );
}

function DebtRow({ d, showClient, onEdit, onPay }) {
  const [open, setOpen] = useState(false);
  const del = useMutate(() => api.del(`/debts/${d.id}`));
  const delPay = useMutate(id => api.del(`/debt-payments/${id}`));
  const overdue = !d.settled && d.due_date && d.due_date < todayISO();
  const pct = Math.min(100, Math.round((d.paid / d.amount) * 100));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className={`group ${d.settled ? 'text-slate-400' : ''}`}>
        <td className="px-4 py-2">
          <button className="flex items-start gap-1 text-left" onClick={() => setOpen(o => !o)} disabled={!d.payments.length}>
            <Chevron size={14} className={`mt-0.5 ${d.payments.length ? 'text-slate-400' : 'invisible'}`} />
            <span><b>{d.description}</b>{d.notes && <div className="text-xs text-slate-500">{d.notes}</div>}</span>
          </button>
        </td>
        {showClient && <td>{d.client_id ? <Link className="hover:text-brand" to={`/clients/${d.client_id}`}>{d.company}</Link> : d.counterparty}
          {d.client_id && d.counterparty && <div className="text-xs text-slate-500">{d.counterparty}</div>}</td>}
        <td className="text-right tabular-nums">{amount(d.amount, d.currency)}</td>
        <td className="text-right tabular-nums">{amount(d.paid, d.currency)}
          <div className="ml-auto mt-1 h-1 w-20 rounded bg-slate-100"><div className="h-1 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div>
        </td>
        <td className={`text-right font-semibold tabular-nums ${d.settled ? '' : d.direction === 'payable' ? 'text-red-600' : 'text-emerald-700'}`}>
          {d.settled ? 'Saldada' : amount(d.balance, d.currency)}
        </td>
        <td className={`whitespace-nowrap ${overdue ? 'font-semibold text-red-600' : ''}`}>{d.due_date ? date(d.due_date) : '—'}</td>
        <td className="whitespace-nowrap pr-3 text-right">
          {!d.settled && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => onPay(d)}><HandCoins size={13} /> Abonar</button>}
          <button className="invisible ml-1 text-slate-400 hover:text-ink group-hover:visible" title="Editar" onClick={() => onEdit(d)}><Pencil size={13} /></button>
          <button className="invisible ml-2 text-slate-400 hover:text-red-600 group-hover:visible" title={d.payments.length ? 'Elimina primero los abonos' : 'Eliminar'}
            disabled={d.payments.length > 0} onClick={() => confirm(`¿Eliminar "${d.description}"?`) && del.mutate()}><Trash2 size={13} /></button>
        </td>
      </tr>
      {open && d.payments.map(p => (
        <tr key={p.id} className="group/p bg-slate-50 text-xs text-slate-600">
          <td className="py-1.5 pl-10">Abono {p.notes ? `· ${p.notes}` : ''}</td>
          {showClient && <td />}
          <td />
          <td className="text-right tabular-nums">{amount(p.amount, d.currency)}</td>
          <td />
          <td>{date(p.paid_on)}</td>
          <td className="pr-3 text-right">
            <button className="invisible text-slate-400 hover:text-red-600 group-hover/p:visible" title="Eliminar abono"
              onClick={() => confirm('¿Eliminar este abono?') && delPay.mutate(p.id)}><Trash2 size={12} /></button>
          </td>
        </tr>
      ))}
    </>
  );
}

export function DebtTable({ debts, showClient = true }) {
  const [edit, setEdit] = useState(null);
  const [pay, setPay] = useState(null);
  if (!debts.length) return <p className="px-4 py-3 text-sm text-slate-400">Sin deudas.</p>;
  return (
    <>
      <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2">Concepto</th>{showClient && <th>Parte</th>}<th className="text-right">Monto</th><th className="text-right">Abonado</th><th className="text-right">Saldo</th><th>Vence</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {debts.map(d => <DebtRow key={d.id} d={d} showClient={showClient} onEdit={setEdit} onPay={setPay} />)}
        </tbody>
      </table>
      {edit && <Modal title={`Editar ${edit.description}`} onClose={() => setEdit(null)}><DebtForm debt={edit} onDone={() => setEdit(null)} /></Modal>}
      {pay && <Modal title={`Abono · ${pay.description}`} onClose={() => setPay(null)}><PaymentForm debt={pay} onDone={() => setPay(null)} /></Modal>}
    </>
  );
}

export function NewDebtButton({ clientId, direction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={14} /> Nueva deuda</button>
      {open && <Modal title="Nueva deuda" onClose={() => setOpen(false)}><DebtForm clientId={clientId} direction={direction} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}

/** Two tiles with the open balances (GYD), used on Finanzas. */
export function DebtTiles() {
  const { data } = useApi('/debts');
  if (!data) return null;
  const { receivable, payable } = data.totals;
  return (
    <div className="grid grid-cols-2 gap-3">
      {[['receivable', receivable, 'text-emerald-700'], ['payable', payable, 'text-red-600']].map(([k, v, tone]) => (
        <Link key={k} to="/debts" className="card px-4 py-3 hover:border-slate-300">
          <div className="text-xs uppercase tracking-wide text-slate-500">{DIRECTION[k]}</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{money(v)}</div>
          <div className="mt-0.5 text-xs text-slate-500">deudas abiertas · no cuenta como ingreso ni gasto</div>
        </Link>
      ))}
    </div>
  );
}

export default function Debts() {
  const [showSettled, setShowSettled] = useState(false);
  const { data } = useApi('/debts');
  const debts = (data?.debts ?? []).filter(d => showSettled || !d.settled);
  return (
    <>
      <PageHeader title="Deudas">
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" className="accent-ink" checked={showSettled} onChange={e => setShowSettled(e.target.checked)} /> Ver saldadas
        </label>
        <NewDebtButton />
      </PageHeader>
      <div className="space-y-5 p-6">
        <DebtTiles />
        {['payable', 'receivable'].map(k => {
          const rows = debts.filter(d => d.direction === k);
          return (
            <section key={k} className="card">
              <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-ink">{DIRECTION[k]}</h2>
                <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{rows.length}</span>
              </header>
              <DebtTable debts={rows} />
            </section>
          );
        })}
      </div>
    </>
  );
}
