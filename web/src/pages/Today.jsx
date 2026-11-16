import { Link } from 'react-router-dom';
import { useApi } from '../lib/api.js';
import { money, date, ago } from '../lib/format.js';
import { PageHeader, Section, TempBadge } from '../components/ui.jsx';
import { ActionRow, ActionForm } from '../components/ActionItems.jsx';
import { InvoicePlanButton, ExternalRows } from '../components/RecurringPlans.jsx';

function ClientRow({ c, hint }) {
  return (
    <Link to={`/clients/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">{c.company}</div>
        <div className="text-xs text-slate-500">{hint}</div>
      </div>
      <TempBadge temp={c.temp} manual={!!c.temperature} reason={c.lead_reason} />
    </Link>
  );
}

export default function Today() {
  const { data: t } = useApi('/today');
  const { data: clients } = useApi('/clients');
  if (!t) return null;
  return (
    <>
      <PageHeader title={`Hoy · ${date(t.today)}`} />
      <div className="grid gap-4 p-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Section title="Vencidas" count={t.overdue.length} empty="Nada vencido.">
            {t.overdue.map(a => <ActionRow key={a.id} a={a} />)}
          </Section>
          <Section title="Para hoy" count={t.due_today.length} empty="Nada para hoy.">
            {t.due_today.map(a => <ActionRow key={a.id} a={a} />)}
          </Section>
          <Section title="Próximos 7 días" count={t.upcoming.length}>
            {t.upcoming.map(a => <ActionRow key={a.id} a={a} />)}
          </Section>
          <Section title="Sin fecha">
            {t.undated.map(a => <ActionRow key={a.id} a={a} />)}
            <ActionForm clients={clients} />
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Calientes" count={t.hot.length} empty="Ningún lead caliente ahora.">
            {t.hot.map(c => <ClientRow key={c.id} c={c} hint={`Último contacto ${ago(c.last_contact_at)}`} />)}
          </Section>
          <Section title="Seguimiento: pregunta sin respuesta (3+ días)" count={t.follow_up.length} empty="Nadie esperando seguimiento.">
            {t.follow_up.map(c => <ClientRow key={c.id} c={c} hint={`Pregunta enviada ${ago(c.last_contact_at)} · probar DM en Facebook o llamada`} />)}
          </Section>
          <Section title="Leads enganchados que se enfriaron" count={t.quiet_hot.length} empty="Todos los leads activos están al día.">
            {t.quiet_hot.map(c => <ClientRow key={c.id} c={c} hint={`Sin contacto ${ago(c.last_contact_at)}`} />)}
          </Section>
          <Section title="Deudas vencidas o por vencer (7 días)" count={t.debts_due?.length ?? 0} empty="Ninguna deuda vence esta semana.">
            {t.debts_due?.map(d => (
              <Link key={d.id} to="/debts" className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                <span><b>{d.direction === 'payable' ? 'Debo' : 'Me deben'}</b> · {d.company || d.counterparty} · {d.description}
                  <span className={`ml-2 text-xs ${d.due_date < t.today ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{date(d.due_date)}</span></span>
                <span className={`font-medium ${d.direction === 'payable' ? 'text-red-600' : 'text-emerald-700'}`}>{money(d.balance, d.currency)}</span>
              </Link>
            ))}
          </Section>
          <Section title="Cobros recurrentes (7 días)" count={t.plans_due?.length ?? 0} empty="Ningún plan por facturar esta semana.">
            {t.plans_due?.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <Link to={`/clients/${p.client_id}`} className="min-w-0 flex-1 hover:text-brand"><b>{p.company}</b> · {p.name}
                  <span className={`ml-2 text-xs ${p.next_due < t.today ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{date(p.next_due)}</span></Link>
                <span className="font-medium text-emerald-700">{money(p.amount, p.currency)}</span>
                <InvoicePlanButton plan={p} />
              </div>
            ))}
          </Section>
          <Section title="Por cobrar" count={t.unpaid.length + (t.external_unpaid?.length ?? 0)} empty="No hay facturas pendientes.">
            {t.unpaid.map(d => (
              <Link key={d.id} to={`/clients/${d.client_id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                <span><b>{d.number}</b> · {d.company}</span>
                <span className="font-medium text-red-600">{money(d.total - d.paid, d.currency)}</span>
              </Link>
            ))}
            <ExternalRows rows={t.external_unpaid ?? []} />
          </Section>
        </div>
      </div>
    </>
  );
}
