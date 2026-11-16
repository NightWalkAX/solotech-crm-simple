import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Mail, UserPlus, Link2, Upload, EyeOff } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { ago, phone } from '../lib/format.js';
import { PageHeader } from '../components/ui.jsx';
import { SOURCES } from '../components/ClientForm.jsx';
import Conversation from '../components/Conversation.jsx';
import WhatsAppImport from '../components/WhatsAppImport.jsx';

function fmt(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es', { timeZone: 'America/Guyana', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const label = t => t.company || phone(t.thread_key);

function AssignExisting({ thread, onDone }) {
  const [q, setQ] = useState('');
  const { data: clients = [] } = useApi(`/clients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  const assign = useMutate(client_id => api.post('/messages/assign', { thread_key: thread.thread_key, client_id }));
  return (
    <div>
      <input className="input mb-2" autoFocus placeholder="Buscar cliente por nombre, contacto, teléfono…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200">
        {!clients.length && <p className="p-3 text-sm text-slate-500">Ningún cliente coincide.</p>}
        {clients.slice(0, 30).map(c => (
          <button key={c.id} disabled={assign.isPending}
            onClick={() => confirm(`¿Asignar esta conversación a ${c.company}?`) && assign.mutate(c.id, { onSuccess: onDone })}
            className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50">
            <span className="truncate">{c.company}{c.contact_name ? <span className="text-slate-500"> · {c.contact_name}</span> : null}</span>
            <span className="shrink-0 text-xs text-slate-400">{phone(c.whatsapp || c.phone) || ''}</span>
          </button>
        ))}
      </div>
      {assign.error && <p className="mt-2 text-sm text-red-600">{assign.error.message}</p>}
    </div>
  );
}

function CreateClient({ thread, onDone }) {
  const isEmail = thread.channels?.includes('email') && /@/.test(thread.thread_key);
  const [form, setForm] = useState({ company: '', contact_name: '', source: 'facebook_ads' });
  const create = useMutate(async () => {
    const contact = isEmail ? { email: thread.thread_key } : { whatsapp: phone(thread.thread_key) };
    const client = await api.post('/clients', { ...form, company: form.company.trim(), contact_name: form.contact_name.trim() || null, ...contact });
    await api.post('/messages/assign', { thread_key: thread.thread_key, client_id: client.id });
    return client;
  });
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-2">
      <div>
        <label className="label">Empresa / nombre</label>
        <input className="input" autoFocus value={form.company} onChange={set('company')} placeholder="Ej. Malali Quarry" />
      </div>
      <div>
        <label className="label">Contacto (opcional)</label>
        <input className="input" value={form.contact_name} onChange={set('contact_name')} />
      </div>
      <div>
        <label className="label">Origen</label>
        <select className="input" value={form.source} onChange={set('source')}>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">{isEmail ? 'Correo' : 'WhatsApp'}: <b>{isEmail ? thread.thread_key : phone(thread.thread_key)}</b> se guarda en la ficha.</p>
      <button className="btn-primary" disabled={!form.company.trim() || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: onDone })}>
        <UserPlus size={14} /> {create.isPending ? 'Creando…' : 'Crear cliente y asignar'}
      </button>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
    </div>
  );
}

function Unmatched({ thread, onAssigned }) {
  const { data: messages = [] } = useApi(`/messages?thread_key=${encodeURIComponent(thread.thread_key)}`);
  const [mode, setMode] = useState('existing');
  const ignore = useMutate(() => api.post('/messages/ignore', { thread_key: thread.thread_key }));
  const box = useRef(null);
  const unread = messages.some(m => m.direction === 'in' && !m.read_at);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);
  useEffect(() => { if (unread) api.post('/messages/read', { thread_key: thread.thread_key }); }, [unread, thread.thread_key]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <aside className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">¿De quién es este número?</h3>
        <div className="mb-3 flex gap-1">
          {[['existing', 'Cliente existente', Link2], ['new', 'Cliente nuevo', UserPlus]].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mode === k ? 'bg-ink text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={14} /> {l}
            </button>
          ))}
        </div>
        {mode === 'existing' ? <AssignExisting thread={thread} onDone={onAssigned} /> : <CreateClient thread={thread} onDone={c => onAssigned(c)} />}
      </aside>
      <section className="card overflow-hidden">
        <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm">
          {thread.channels?.includes('email') ? <Mail size={14} /> : <MessageCircle size={14} />}
          <b>{phone(thread.thread_key)}</b>
          <span className="text-slate-500">· sin cliente asignado</span>
          <button className="btn-ghost ml-auto text-xs" disabled={ignore.isPending}
            onClick={() => confirm('¿Ignorar este chat? Desaparece de la Bandeja y no se guardan sus mensajes nuevos. Puedes deshacerlo en Integraciones.') && ignore.mutate()}>
            <EyeOff size={13} /> Ignorar chat
          </button>
        </header>
        <div ref={box} className="max-h-[560px] space-y-2 overflow-y-auto bg-[#f4f1ec] px-4 py-3">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === 'out' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                {m.subject && <div className="mb-1 text-xs font-semibold">{m.subject}</div>}
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 text-right text-[10px] text-slate-500">{fmt(m.sent_at)}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Asigna o crea el cliente para responder desde aquí y usar las respuestas sugeridas.</p>
      </section>
    </div>
  );
}

function ThreadRow({ t, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${active ? 'bg-slate-100' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex min-w-0 items-center gap-1.5 text-sm ${t.unread ? 'font-semibold text-ink' : 'text-slate-800'}`}>
          {t.channels?.includes('email') && !t.channels.includes('whatsapp') ? <Mail size={13} className="shrink-0 text-slate-400" /> : <MessageCircle size={13} className="shrink-0 text-slate-400" />}
          <span className="truncate">{label(t)}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-400">{ago(t.last_at)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-slate-500">{t.last_direction === 'out' ? 'Tú: ' : ''}{t.last_body}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-slate-400">{t.total}</span>
          {t.unread > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{t.unread}</span>}
        </span>
      </div>
    </button>
  );
}

export default function Inbox() {
  const { data: threads = [] } = useApi('/inbox');
  const [key, setKey] = useState(null);
  const [importing, setImporting] = useState(false);
  const unmatched = threads.filter(t => !t.client_id);
  const matched = threads.filter(t => t.client_id);
  const current = threads.find(t => t.key === key) ?? unmatched[0] ?? matched[0];
  const { data: client } = useApi(current?.client_id ? `/clients/${current.client_id}` : null);
  const groups = [['Sin asignar', unmatched], ['Clientes', matched]].filter(([, list]) => list.length);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Bandeja">
        <button className="btn-ghost" onClick={() => setImporting(true)}><Upload size={14} /> Importar chat de WhatsApp</button>
      </PageHeader>
      {importing && <WhatsAppImport onClose={() => setImporting(false)} />}
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          {!threads.length && <p className="p-4 text-sm text-slate-500">Todavía no hay conversaciones. Importa un chat de WhatsApp desde la ficha de un cliente.</p>}
          {groups.map(([title, list]) => (
            <div key={title}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{title}</span><span>{list.length}</span>
              </div>
              {list.map(t => <ThreadRow key={t.key} t={t} active={current?.key === t.key} onClick={() => setKey(t.key)} />)}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {current && client && (
            <>
              <Link to={`/clients/${client.id}`} className="mb-2 inline-block text-sm text-brand hover:underline">Ver ficha de {client.company} →</Link>
              <Conversation key={client.id} client={client} />
            </>
          )}
          {current && !current.client_id && (
            <Unmatched key={current.key} thread={current} onAssigned={c => setKey(c?.id ? `c${c.id}` : null)} />
          )}
        </div>
      </div>
    </div>
  );
}
