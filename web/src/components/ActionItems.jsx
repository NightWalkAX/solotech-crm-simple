import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, Trash2, Truck, Bell, Compass, RefreshCw } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { Modal } from './ui.jsx';
import { date, todayISO } from '../lib/format.js';

const KIND_ICON = { delivery: Truck, followup: Bell };

export function ActionRow({ a, showClient = true }) {
  const toggle = useMutate(() => api.patch(`/actions/${a.id}`, { status: a.status === 'done' ? 'open' : 'done' }));
  const remove = useMutate(() => api.del(`/actions/${a.id}`));
  const overdue = a.status === 'open' && a.due_date && a.due_date < todayISO();
  const Icon = KIND_ICON[a.kind];
  return (
    <div className="group flex items-start gap-3 px-4 py-2.5">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-ink" checked={a.status === 'done'} onChange={() => toggle.mutate()} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${a.status !== 'open' ? 'text-slate-400 line-through' : 'text-slate-800'}`} title={a.status === 'dropped' ? 'Ya no aplica' : undefined}>
          {Icon && <Icon size={13} className="mr-1 inline text-slate-400" />}{a.title}
        </div>
        <div className="flex gap-2 text-xs text-slate-500">
          {showClient && a.client_id && <Link className="hover:text-brand" to={`/clients/${a.client_id}`}>{a.company}</Link>}
          {a.notes && <span className="truncate">{a.notes}</span>}
        </div>
      </div>
      <ContextButton a={a} className="invisible text-slate-400 hover:text-ink group-hover:visible" />
      {a.due_date && <span className={`whitespace-nowrap text-xs ${overdue ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{date(a.due_date)}</span>}
      <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" onClick={() => remove.mutate()}><Trash2 size={14} /></button>
    </div>
  );
}

export function ActionForm({ clientId, clients }) {
  const [form, setForm] = useState({ title: '', due_date: '', kind: 'task', effort: '', client_id: clientId ?? '' });
  const add = useMutate(body => api.post('/actions', body));
  const submit = e => {
    e.preventDefault();
    if (!form.title.trim()) return;
    add.mutate({ ...form, client_id: form.client_id ? Number(form.client_id) : null, due_date: form.due_date || null, effort: form.effort || null },
      { onSuccess: () => setForm(f => ({ ...f, title: '', due_date: '', effort: '' })) });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input className="input min-w-48 flex-1" placeholder="Nueva tarea…" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
      {clients && (
        <select className="input w-48" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
          <option value="">Sin cliente</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
      )}
      <select className="input w-32" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
        <option value="task">Tarea</option>
        <option value="followup">Seguimiento</option>
        <option value="delivery">Entrega</option>
      </select>
      <select className="input w-32" title="Tamaño aproximado" value={form.effort} onChange={e => setForm({ ...form, effort: e.target.value })}>
        <option value="">Tamaño…</option>
        <option value="quick">Rápida</option>
        <option value="medium">Un rato</option>
        <option value="big">Grande</option>
      </select>
      <input type="date" className="input w-40" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
      <button className="btn-primary" disabled={add.isPending}><Plus size={14} /> Agregar</button>
    </form>
  );
}

// "Contexto": Sonnet reads the task, its client, messages and the chat where it was created, and explains what to do
// (server/taskcontext.js). Generated on first open or when the task changed; cached afterwards.
function ContextModal({ a, onClose }) {
  const { data: ctx } = useApi(`/actions/${a.id}/context`);
  const explain = useMutate(() => api.post(`/actions/${a.id}/context`));
  const needed = ctx && !ctx.running && (!ctx.body || ctx.stale) && !ctx.error;
  useEffect(() => { if (needed && explain.isIdle) explain.mutate(); }, [needed]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = explain.isPending || ctx?.running;
  return (
    <Modal title={a.title} onClose={onClose}>
      {ctx?.body && (
        <div className={`text-sm leading-relaxed text-slate-700 [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_strong]:text-ink [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 ${busy ? 'opacity-50' : ''}`}>
          <ReactMarkdown>{ctx.body}</ReactMarkdown>
        </div>
      )}
      {busy && <p className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw size={14} className="animate-spin" /> Leyendo el contexto de la tarea…</p>}
      {(ctx?.error || explain.error) && !busy && <p className="text-sm text-slate-500">No se pudo generar: {explain.error?.message || ctx.error}</p>}
      {ctx?.body && !busy && (
        <button className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-ink" onClick={() => explain.mutate()}>
          <RefreshCw size={12} /> Volver a explicar
        </button>
      )}
    </Modal>
  );
}

export function ContextButton({ a, className, label }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} title="¿De qué va esta tarea?" onClick={() => setOpen(true)}>
        <Compass size={label ? 15 : 14} />{label && ` ${label}`}
      </button>
      {open && <ContextModal a={a} onClose={() => setOpen(false)} />}
    </>
  );
}
