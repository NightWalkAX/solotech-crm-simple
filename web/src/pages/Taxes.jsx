import { useState } from 'react';
import { CheckCircle2, Trash2, PiggyBank, Settings2, ChevronDown, ChevronRight } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date, todayISO } from '../lib/format.js';
import { PageHeader, Section, Modal } from '../components/ui.jsx';
import { Tile } from './Finance.jsx';

const gyd = n => money(Math.round(n ?? 0));
const KIND = { nis: 'NIS', income_advance: 'Adelanto renta', income_balance: 'Saldo renta', penalty: 'Recargo/multa' };
const STATUS = {
  paid: ['Pagado', 'bg-emerald-50 text-emerald-700'],
  overdue: ['Vencido', 'bg-red-50 text-red-700'],
  soon: ['Pronto', 'bg-amber-50 text-amber-700'],
  upcoming: ['Pendiente', 'bg-slate-100 text-slate-700'],
  running: ['En curso', 'bg-sky-50 text-sky-700'],
  none: ['Sin monto', 'bg-slate-50 text-slate-400'],
};
const monthLabel = m => {
  const s = new Date(`${m}-15T00:00:00Z`).toLocaleDateString('es', { month: 'long', timeZone: 'UTC' });
  return s[0].toUpperCase() + s.slice(1);
};

function PayForm({ item, onDone }) {
  const pay = useMutate(body => api.post('/tax-payments', body));
  const [f, setF] = useState({
    kind: item?.kind ?? 'nis', period: item?.period ?? todayISO().slice(0, 7), amount_gyd: item ? Math.max(0, item.amount - item.paid) || '' : '',
    paid_on: todayISO(), reference: '', channel: '', from_reserve: true, notes: '',
  });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const hint = { nis: 'YYYY-MM (mes que cubre)', income_advance: 'YYYY-Qn', income_balance: 'YYYY (año declarado)', penalty: 'YYYY' }[f.kind];
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); pay.mutate({ ...f, amount_gyd: Number(f.amount_gyd) }, { onSuccess: onDone }); }}>
      <div><label className="label">Impuesto</label>
        <select className="input" value={f.kind} onChange={set('kind')} disabled={!!item}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <div><label className="label">Periodo</label><input className="input" required value={f.period} onChange={set('period')} placeholder={hint} disabled={!!item} /></div>
      <div><label className="label">Monto (GYD)</label><input className="input" type="number" min="1" step="1" required value={f.amount_gyd} onChange={set('amount_gyd')} /></div>
      <div><label className="label">Fecha de pago</label><input className="input" type="date" value={f.paid_on} onChange={set('paid_on')} /></div>
      <div><label className="label">Referencia</label><input className="input" value={f.reference} onChange={set('reference')} placeholder="N.º de recibo / transacción" /></div>
      <div><label className="label">Medio</label><input className="input" value={f.channel} onChange={set('channel')} placeholder="Banco, portal GRA, GTT…" /></div>
      <label className="col-span-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={f.from_reserve} onChange={e => setF({ ...f, from_reserve: e.target.checked })} /> Pagado desde la cuenta de reserva de impuestos
      </label>
      <div className="col-span-3"><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div className="col-span-3 flex items-center justify-end gap-3">
        {pay.error && <span className="text-sm text-red-600">{pay.error.message}</span>}
        <button className="btn-primary" disabled={pay.isPending}>Registrar pago</button>
      </div>
    </form>
  );
}

function MoveForm({ kind, onDone }) {
  const add = useMutate(body => api.post('/owner-moves', body));
  const [f, setF] = useState({ amount_gyd: '', moved_on: todayISO(), notes: '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); add.mutate({ kind, ...f, amount_gyd: Number(f.amount_gyd) }, { onSuccess: onDone }); }}>
      <div><label className="label">Monto (GYD)</label><input className="input" type="number" min="1" step="1" required autoFocus value={f.amount_gyd} onChange={set('amount_gyd')} /></div>
      <div><label className="label">Fecha</label><input className="input" type="date" value={f.moved_on} onChange={set('moved_on')} /></div>
      <div><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div className="col-span-3 flex items-center justify-end gap-3">
        {add.error && <span className="text-sm text-red-600">{add.error.message}</span>}
        <button className="btn-primary" disabled={add.isPending}>Guardar</button>
      </div>
    </form>
  );
}

const FIELDS = [
  ['business_start', 'Inicio del negocio (GRA)', 'date'], ['nis_start', 'NIS desde (mes)', 'month'],
  ['nis_rate', 'NIS %'], ['nis_cap_monthly', 'Tope NIS por mes (GYD)'],
  ['allowance_min', 'Deducción mínima anual (GYD)'], ['allowance_fraction', 'Deducción % del ingreso'],
  ['band_limit', 'Tramo 1 hasta (GYD)'], ['band1_rate', 'Tramo 1 %'], ['band2_rate', 'Tramo 2 %'],
  ['reserve_pct', 'Reserva sugerida % de cada cobro'],
];

function Config({ cfg, year }) {
  const save = useMutate(body => api.put('/taxes/config', body));
  const [f, setF] = useState({ ...cfg, advance: cfg.advance_override?.[year] ?? '' });
  return (
    <form className="grid grid-cols-4 gap-3 px-4 py-3" onSubmit={e => {
      e.preventDefault();
      const { advance, ...rest } = f;
      save.mutate({ ...rest, advance_override: { ...cfg.advance_override, [year]: advance === '' ? null : Number(advance) } });
    }}>
      {FIELDS.map(([k, label, type]) => (
        <div key={k}><label className="label">{label}</label>
          <input className="input" type={type ?? 'number'} step="any" value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} />
        </div>
      ))}
      <div><label className="label">Adelanto trimestral {year} fijado por GRA</label>
        <input className="input" type="number" step="1" min="0" value={f.advance} placeholder="auto" onChange={e => setF({ ...f, advance: e.target.value })} />
      </div>
      <div className="col-span-4 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">Las reglas cambian con cada presupuesto nacional. Vacío en el adelanto = impuesto estimado del año anterior ÷ 4.</span>
        {save.error && <span className="text-sm text-red-600">{save.error.message}</span>}
        <button className="btn-primary" disabled={save.isPending}>Guardar reglas</button>
      </div>
    </form>
  );
}

export default function Taxes() {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)));
  const { data } = useApi(`/taxes?year=${year}`);
  const [pay, setPay] = useState(null); // null | {} | calendar item
  const [move, setMove] = useState(null); // reserve_in | reserve_out
  const [showCfg, setShowCfg] = useState(false);
  const delPay = useMutate(id => api.del(`/tax-payments/${id}`));
  const delMove = useMutate(id => api.del(`/owner-moves/${id}`));
  if (!data) return <PageHeader title="Impuestos" />;
  const { totals: t, reserve: r } = data;
  const years = Array.from({ length: Number(todayISO().slice(0, 4)) - data.first_year + 1 }, (_, i) => data.first_year + i);
  return (
    <>
      <PageHeader title="Impuestos">
        <button className="btn-ghost text-xs" onClick={() => setPay({})}><CheckCircle2 size={12} /> Registrar pago</button>
        <select className="input w-28" value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y}>{y}</option>)}</select>
      </PageHeader>
      <div className="space-y-5 p-6">
        <p className="rounded-md bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Estimación con las reglas de abajo, no asesoría fiscal: confírmala con GRA o un contador. Solo cuenta dinero real (recibos, otros ingresos y gastos); los tokens de Claude no restan.
        </p>
        <div className="grid grid-cols-6 gap-3">
          <Tile label="Utilidad del año" value={gyd(t.profit)} sub={`cobrado ${gyd(t.income)} · gastos ${gyd(t.expenses)}`} />
          <Tile label="NIS estimado" value={gyd(t.nis)} sub={`${data.config.nis_rate}% desde ${data.config.nis_start}`} />
          <Tile label="Renta estimada" value={gyd(t.income_tax)} sub={`gravable ${gyd(t.taxable)} · deducción ${gyd(t.allowance)}`} />
          <Tile label="Neto después de impuestos" value={gyd(t.net)} tone={t.net < 0 ? 'text-red-600' : 'text-emerald-700'} sub={`${year} hasta hoy`} />
          <Tile label="Cuenta de reserva" value={gyd(r.balance)} sub={`debes hoy ${gyd(r.owed.total)}${r.gap > 0 ? ` · faltan ${gyd(r.gap)}` : ''}`} tone={r.gap > 0 ? 'text-red-600' : 'text-ink'} />
          <Tile label={`Reserva sugerida (${data.config.reserve_pct}%)`} value={gyd(r.suggested_ytd)} sub="de lo cobrado este año" tone="text-amber-700" />
        </div>

        <Section title={`Calendario ${year}`} count={data.calendar.length} empty="Sin vencimientos.">
          <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:px-3">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Vence</th><th>Concepto</th><th className="text-right">Monto</th><th className="text-right">Pagado</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.calendar.map(i => {
                const [label, cls] = STATUS[i.status];
                return (
                  <tr key={`${i.kind}${i.period}`}>
                    <td className="whitespace-nowrap">{date(i.due)}</td>
                    <td>{i.label}{(i.estimate || i.status === 'running') && <span className="text-xs text-slate-500"> · estimado, cambia hasta cerrar el {i.kind === 'nis' ? 'mes' : 'año'}</span>}</td>
                    <td className="text-right tabular-nums">{gyd(i.amount)}</td>
                    <td className="text-right tabular-nums text-slate-500">{i.paid ? gyd(i.paid) : ''}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>{label}</span></td>
                    <td className="text-right">{i.status !== 'paid' && <button className="btn-ghost text-xs" onClick={() => setPay(i)}><CheckCircle2 size={12} /> Pagar</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section title="Mes a mes" count={data.months.length} empty="Sin meses desde el inicio del negocio.">
          <table className="w-full text-sm [&_td]:px-4 [&_td]:py-1.5 [&_th]:px-4">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Mes</th><th className="text-right">Cobrado</th><th className="text-right">Gastos</th><th className="text-right">Utilidad</th><th className="text-right">NIS</th><th className="text-right">Renta</th><th className="text-right">Neto</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {data.months.map(m => (
                <tr key={m.month} className={m.running ? 'text-slate-500' : ''}>
                  <td>{monthLabel(m.month)}{m.running && ' (en curso)'}</td>
                  <td className="text-right">{gyd(m.income)}</td>
                  <td className="text-right">{gyd(m.expenses)}</td>
                  <td className="text-right">{gyd(m.profit)}</td>
                  <td className="text-right">{gyd(m.nis)}</td>
                  <td className="text-right">{gyd(m.income_tax)}</td>
                  <td className={`text-right font-medium ${m.net < 0 ? 'text-red-600' : ''}`}>{gyd(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <div className="grid grid-cols-2 gap-5">
          <Section title="Pagos hechos" count={data.payments.length} empty="Todavía no hay pagos registrados.">
            {data.payments.map(p => (
              <div key={p.id} className="group flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <b>{KIND[p.kind]} {p.period}</b> · {date(p.paid_on)}
                  <div className="text-xs text-slate-500">{[p.channel, p.reference, p.from_reserve ? 'desde la reserva' : null, p.notes].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="flex items-center gap-2 tabular-nums">{gyd(p.amount_gyd)}
                  <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                    onClick={() => confirm('¿Eliminar este pago?') && delPay.mutate(p.id)}><Trash2 size={12} /></button>
                </span>
              </div>
            ))}
          </Section>
          <section className="card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Cuenta de reserva de impuestos</h2>
              <span className="flex gap-1">
                <button className="btn-ghost text-xs" onClick={() => setMove('reserve_in')}><PiggyBank size={12} /> Apartar</button>
                <button className="btn-ghost text-xs" onClick={() => setMove('reserve_out')}>Retirar</button>
              </span>
            </header>
            <div className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
              <div><div className="text-xs text-slate-500">Apartado</div><b className="tabular-nums">{gyd(r.deposits - r.withdrawals)}</b></div>
              <div><div className="text-xs text-slate-500">Pagado desde aquí</div><b className="tabular-nums">{gyd(r.paid_from_reserve)}</b></div>
              <div><div className="text-xs text-slate-500">Debes hoy</div><b className="tabular-nums">{gyd(r.owed.total)}</b><div className="text-xs text-slate-500">NIS {gyd(r.owed.nis)} · renta {gyd(r.owed.income)}</div></div>
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {data.moves.map(m => (
                <div key={m.id} className="group flex items-center justify-between px-4 py-1.5 text-sm">
                  <span>{date(m.moved_on)} · {m.kind === 'reserve_in' ? 'Apartado' : 'Retiro'}{m.notes && <span className="text-xs text-slate-500"> · {m.notes}</span>}</span>
                  <span className={`flex items-center gap-2 tabular-nums ${m.kind === 'reserve_out' ? 'text-red-600' : ''}`}>{m.kind === 'reserve_out' ? '−' : ''}{gyd(m.amount_gyd)}
                    <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                      onClick={() => confirm('¿Eliminar este movimiento?') && delMove.mutate(m.id)}><Trash2 size={12} /></button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card">
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ink" onClick={() => setShowCfg(s => !s)}>
            {showCfg ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Settings2 size={14} /> Reglas y porcentajes
          </button>
          {showCfg && <Config key={`${year}${JSON.stringify(data.config)}`} cfg={data.config} year={year} />}
        </section>
      </div>
      {pay && <Modal title={pay.label ? `Pago: ${pay.label}` : 'Registrar pago de impuestos'} onClose={() => setPay(null)}><PayForm item={pay.label ? pay : null} onDone={() => setPay(null)} /></Modal>}
      {move && <Modal title={move === 'reserve_in' ? 'Apartar para impuestos' : 'Retirar de la reserva'} onClose={() => setMove(null)}><MoveForm kind={move} onDone={() => setMove(null)} /></Modal>}
    </>
  );
}
