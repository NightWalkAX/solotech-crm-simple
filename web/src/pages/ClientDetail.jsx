import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Globe, MonitorSmartphone, MessageCircle, Mail, Phone, MapPin, Share2, Pencil, Trash2 } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, date, ago, waLink } from '../lib/format.js';
import { PageHeader, Section, TempBadge, Modal } from '../components/ui.jsx';
import { ActionRow, ActionForm } from '../components/ActionItems.jsx';
import ClientForm, { SOURCES } from '../components/ClientForm.jsx';
import Conversation from '../components/Conversation.jsx';
import { DocumentTable, NewDocumentButton, ExternalInvoiceTable } from './Documents.jsx';
import { ContractTable, NewContractButton } from './Contracts.jsx';
import { DebtTable, NewDebtButton } from './Debts.jsx';
import { NoteList, NewNoteButton } from './Notes.jsx';
import { PlanTable, NewPlanButton, ExternalPending } from '../components/RecurringPlans.jsx';

const CHANNELS = { whatsapp: 'WhatsApp', email: 'Correo', call: 'Llamada', meeting: 'Reunión', note: 'Nota', system: 'Sistema' };

function LinkChip({ href, icon: Icon, children }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-200">
      <Icon size={14} /> {children}
    </a>
  );
}

function Timeline({ clientId }) {
  const { data: items = [] } = useApi(`/clients/${clientId}/interactions`);
  const [f, setF] = useState({ channel: 'whatsapp', direction: 'out', summary: '', body: '' });
  const add = useMutate(body => api.post('/interactions', body));
  const remove = useMutate(id => api.del(`/interactions/${id}`));
  const submit = e => {
    e.preventDefault();
    if (!f.summary.trim()) return;
    add.mutate({ ...f, client_id: clientId, direction: ['whatsapp', 'email', 'call'].includes(f.channel) ? f.direction : null },
      { onSuccess: () => setF(s => ({ ...s, summary: '', body: '' })) });
  };
  return (
    <Section title="Interacciones">
      <form onSubmit={submit} className="space-y-2 px-4 py-3">
        <div className="flex gap-2">
          <select className="input w-32" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>
            {Object.entries(CHANNELS).filter(([k]) => k !== 'system').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {['whatsapp', 'email', 'call'].includes(f.channel) && (
            <select className="input w-32" value={f.direction} onChange={e => setF({ ...f, direction: e.target.value })}>
              <option value="out">Yo → ellos</option>
              <option value="in">Ellos → yo</option>
            </select>
          )}
          <input className="input flex-1" placeholder="Resumen…" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} />
        </div>
        <textarea className="input" rows={2} placeholder="Detalle o mensaje pegado (opcional)" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
        <div className="flex justify-end"><button className="btn-primary" disabled={add.isPending}>Registrar</button></div>
      </form>
      {items.map(i => (
        <div key={i.id} className="group flex gap-3 px-4 py-2.5">
          <div className="w-24 shrink-0 text-xs text-slate-500">{date(i.occurred_at)}<div>{CHANNELS[i.channel] ?? i.channel}{i.direction === 'in' ? ' ←' : i.direction === 'out' ? ' →' : ''}</div></div>
          <div className="min-w-0 flex-1">
            <div className={`text-sm ${i.channel === 'system' ? 'text-slate-500' : 'text-slate-800'}`}>{i.summary}</div>
            {i.body && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{i.body}</div>}
          </div>
          <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" onClick={() => remove.mutate(i.id)}><Trash2 size={14} /></button>
        </div>
      ))}
    </Section>
  );
}

export default function ClientDetail() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const { data: c } = useApi(`/clients/${id}`);
  const { data: meta } = useApi('/meta');
  const { data: actions = [] } = useApi(`/actions?client_id=${id}`);
  const { data: docs = [] } = useApi(`/documents?client_id=${id}`);
  const { data: contracts = [] } = useApi(`/contracts?client_id=${id}`);
  const { data: debtData } = useApi(`/debts?client_id=${id}`);
  const { data: planData } = useApi(`/plans?client_id=${id}`);
  const { data: notes = [] } = useApi(`/notes?client_id=${id}`);
  const { data: clients = [] } = useApi('/clients');
  const [editing, setEditing] = useState(false);
  const save = useMutate(body => api.patch(`/clients/${id}`, body));
  const remove = useMutate(() => api.del(`/clients/${id}`));
  if (!c) return null;
  const referrer = clients.find(x => x.id === c.referrer_id);
  return (
    <>
      <PageHeader title={c.company}>
        <TempBadge temp={c.temp} manual={!!c.temperature} reason={c.lead_reason} />
        <select className="input w-44" value={c.stage} onChange={e => save.mutate({ stage: e.target.value })}>
          {meta?.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Editar</button>
        <button className="btn-ghost text-red-600" onClick={() => confirm(`¿Borrar ${c.company} y todo su historial?`) && remove.mutate(undefined, { onSuccess: () => nav('/clients') })}><Trash2 size={14} /></button>
      </PageHeader>
      <div className="grid gap-4 p-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <section className="card space-y-3 p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <LinkChip href={c.website_url} icon={Globe}>Página web</LinkChip>
              <LinkChip href={c.demo_url} icon={MonitorSmartphone}>Demo</LinkChip>
              <LinkChip href={waLink(c.whatsapp)} icon={MessageCircle}>WhatsApp</LinkChip>
              <LinkChip href={c.email && `mailto:${c.email}`} icon={Mail}>Correo</LinkChip>
              <LinkChip href={c.facebook_url} icon={Share2}>Facebook</LinkChip>
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
              <dt className="text-slate-500">Contacto</dt><dd>{c.contact_name || '—'}</dd>
              <dt className="text-slate-500">WhatsApp</dt><dd>{c.whatsapp || '—'}</dd>
              <dt className="text-slate-500"><Phone size={12} className="inline" /> Teléfono</dt><dd>{c.phone || '—'}</dd>
              <dt className="text-slate-500">Correo</dt><dd className="break-all">{c.email || '—'}</dd>
              <dt className="text-slate-500"><MapPin size={12} className="inline" /> Dirección</dt><dd>{c.address || '—'}</dd>
              <dt className="text-slate-500">Sector</dt><dd>{c.sector || '—'}</dd>
              <dt className="text-slate-500">Origen</dt><dd>{SOURCES[c.source] ?? c.source ?? '—'}{referrer ? ` · ${referrer.company}` : ''}</dd>
                            {c.est_price && <><dt className="text-slate-500">Estimado</dt><dd>{money(c.est_price, c.est_currency)}{c.est_monthly ? ` + ${c.est_monthly}` : ''}</dd></>}
              <dt className="text-slate-500">Saldo</dt><dd className={c.balance > 0 ? 'font-medium text-red-600' : ''}>{money(c.balance)}</dd>
              <dt className="text-slate-500">Último contacto</dt><dd>{ago(c.last_contact_at)}</dd>
            </dl>
            {c.lead_reason && (
              <div>
                <div className="label">Según la conversación: {{ hot: 'caliente', warm: 'tibio', cold: 'frío' }[c.lead_temp] ?? '—'}{c.lead_score != null ? ` · ${c.lead_score}/100` : ''}{c.temperature ? ' (la del encabezado está fijada a mano)' : ''}</div>
                <p className="text-slate-700">{c.lead_reason}</p>
                {c.lead_tip && <p className="mt-1 text-xs text-slate-500">Próximo mensaje: {c.lead_tip}</p>}
                <p className="mt-0.5 text-xs text-slate-400">Evaluada {ago(c.lead_scored_at)}{c.lead_error ? ' · último intento falló, se reintenta' : ''}</p>
              </div>
            )}
            {c.characterization && <div><div className="label">Caracterización</div><p className="text-slate-700">{c.characterization}</p></div>}
            {c.notes && <div><div className="label">Notas</div><p className="whitespace-pre-wrap text-slate-700">{c.notes}</p></div>}
          </section>
          <Section title="Pain points" count={c.pain_points.length} empty="Sin pain points registrados.">
            <ul className="list-disc space-y-1.5 py-3 pl-8 pr-4 text-sm text-slate-700">
              {c.pain_points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </Section>
        </div>
        <div className="space-y-4 xl:col-span-2">
          <Conversation key={c.id} client={c} />
          <Section title="Tareas y entregas">
            {actions.map(a => <ActionRow key={a.id} a={a} showClient={false} />)}
            <ActionForm clientId={id} />
          </Section>
          <section className="card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Notas y metodología</h2>
              <NewNoteButton clientId={id} />
            </header>
            <NoteList notes={notes} showClient={false} />
          </section>
          <section className="card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Cotizaciones, facturas y recibos</h2>
              <NewDocumentButton clientId={id} />
            </header>
            <DocumentTable docs={docs} showClient={false} />
            <ExternalInvoiceTable clientId={id} />
          </section>
          <section className="card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Ingresos recurrentes</h2>
              <NewPlanButton clientId={id} />
            </header>
            <PlanTable plans={planData?.plans ?? []} showClient={false} />
            <ExternalPending clientId={id} />
          </section>
          <section className="card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">Contratos y acuerdos</h2>
              <NewContractButton clientId={id} />
            </header>
            <ContractTable contracts={contracts} showClient={false} />
          </section>
          {debtData?.debts.length > 0 && (
            <section className="card">
              <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-ink">Deudas</h2>
                <NewDebtButton clientId={id} direction="receivable" />
              </header>
              <DebtTable debts={debtData.debts} showClient={false} />
            </section>
          )}
          <Timeline clientId={id} />
        </div>
      </div>
      {editing && (
        <Modal title={`Editar ${c.company}`} onClose={() => setEditing(false)}>
          <ClientForm initial={c} submitting={save.isPending} onSubmit={body => save.mutate(body, { onSuccess: () => setEditing(false) })} />
        </Modal>
      )}
    </>
  );
}
