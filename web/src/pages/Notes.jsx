import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { date } from '../lib/format.js';
import { PageHeader, Modal } from '../components/ui.jsx';

export const NOTE_KIND = {
  idea: ['Idea', 'bg-amber-50 text-amber-700'],
  info: ['Información', 'bg-sky-50 text-sky-700'],
  methodology: ['Metodología', 'bg-violet-50 text-violet-700'],
  reference: ['Referencia', 'bg-slate-100 text-slate-600'],
};

function NoteForm({ note, clientId, onDone }) {
  const { data: clients = [] } = useApi('/clients');
  const save = useMutate(body => (note ? api.patch(`/notes/${note.id}`, body) : api.post('/notes', body)));
  const [f, setF] = useState({
    kind: note?.kind ?? (clientId ? 'methodology' : 'idea'), title: note?.title ?? '', body: note?.body ?? '',
    client_id: note?.client_id ?? clientId ?? '', tags: note?.tags ?? '',
  });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = e => {
    e.preventDefault();
    save.mutate({ ...f, client_id: f.client_id ? Number(f.client_id) : null, tags: f.tags.trim() || null }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-4 gap-3">
      <div className="col-span-3"><label className="label">Título</label><input className="input" required autoFocus value={f.title} onChange={set('title')} /></div>
      <div><label className="label">Tipo</label>
        <select className="input" value={f.kind} onChange={set('kind')}>
          {Object.entries(NOTE_KIND).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className="label">Cliente</label>
        <select className="input" value={f.client_id} onChange={set('client_id')}>
          <option value="">— (general)</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className="label">Etiquetas</label><input className="input" value={f.tags} onChange={set('tags')} placeholder="precios, marketing…" /></div>
      <div className="col-span-4"><label className="label">Contenido</label><textarea className="input min-h-40" value={f.body} onChange={set('body')} /></div>
      <div className="col-span-4 flex items-center justify-between">
        <span className="text-sm text-red-600">{save.error?.message}</span>
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

export function NoteList({ notes, showClient = true }) {
  const [edit, setEdit] = useState(null);
  const del = useMutate(id => api.del(`/notes/${id}`));
  if (!notes.length) return <p className="px-4 py-3 text-sm text-slate-400">Sin notas.</p>;
  return (
    <>
      <div className="divide-y divide-slate-100">
        {notes.map(n => {
          const [label, cls] = NOTE_KIND[n.kind] ?? [n.kind, 'bg-slate-100 text-slate-600'];
          return (
            <article key={n.id} className="group px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
                <b className="text-ink">{n.title}</b>
                {showClient && n.client_id && <Link className="text-xs text-slate-500 hover:text-brand" to={`/clients/${n.client_id}`}>{n.company}</Link>}
                <span className="ml-auto text-xs text-slate-400">{date(n.updated_at)}</span>
                <button className="invisible text-slate-400 hover:text-ink group-hover:visible" title="Editar" onClick={() => setEdit(n)}><Pencil size={13} /></button>
                <button className="invisible text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                  onClick={() => confirm(`¿Eliminar "${n.title}"?`) && del.mutate(n.id)}><Trash2 size={13} /></button>
              </div>
              {n.body && <p className="mt-1.5 whitespace-pre-wrap text-slate-700">{n.body}</p>}
              {n.tags && <div className="mt-1.5 text-xs text-slate-400">{n.tags.split(',').map(t => `#${t.trim()}`).join(' ')}</div>}
            </article>
          );
        })}
      </div>
      {edit && <Modal title={`Editar ${edit.title}`} onClose={() => setEdit(null)}><NoteForm note={edit} onDone={() => setEdit(null)} /></Modal>}
    </>
  );
}

export function NewNoteButton({ clientId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={14} /> Nueva nota</button>
      {open && <Modal title="Nueva nota" onClose={() => setOpen(false)}><NoteForm clientId={clientId} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}

export default function Notes() {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const p = new URLSearchParams();
  if (kind) p.set('kind', kind);
  if (q.trim()) p.set('q', q.trim());
  const { data: notes = [] } = useApi(`/notes?${p}`, { placeholderData: prev => prev });
  return (
    <>
      <PageHeader title="Notas">
        <input className="input w-56" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input w-40" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(NOTE_KIND).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <NewNoteButton />
      </PageHeader>
      <div className="p-6"><div className="card"><NoteList notes={notes} /></div></div>
    </>
  );
}
