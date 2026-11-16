import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Plus, Send, Square, Wrench, Undo2, Loader2, Hammer, Database, History, Trash2 } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';

// edit (default): Sonnet 5.5, CRM data + web search. build: Opus 5.5 with code and files (changes the CRM itself).
const MODES = { build: { label: 'Build', Icon: Hammer, title: 'Build · Opus 5.5: puede cambiar el código del CRM y archivos' }, edit: { label: 'Edit', Icon: Database, title: 'Edit · Sonnet 5.5: solo datos del CRM' } };

function ToolList({ tools }) {
  const [open, setOpen] = useState(false);
  if (!tools?.length) return null;
  return (
    <div className="mt-1.5 text-xs text-slate-500">
      <button className="flex items-center gap-1 hover:text-slate-700" onClick={() => setOpen(o => !o)}>
        <Wrench size={11} /> {tools.length} herramienta{tools.length > 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2">
          {tools.map((t, i) => <li key={i} className="truncate"><b>{t.name}</b> {t.hint}</li>)}
        </ul>
      )}
    </div>
  );
}

// [▶ Escuchar](/api/tts/…mp3) from crm_send_audio renders as an inline player.
const MD_COMPONENTS = {
  a: ({ href, children, ...props }) => (/^\/api\/tts\/audio-[\w-]+\.mp3$/.test(href || '')
    ? <audio controls preload="none" src={href} className="my-1 h-9 w-full max-w-xs" />
    : <a href={href} {...props}>{children}</a>),
};

const fmtTok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0));
const fmtUsd = n => `$${(n ?? 0).toFixed(n >= 1 ? 2 : 3)}`;

/** ↑ input · ↓ output · cache read/write · USD, for one turn or a whole chat. */
function Usage({ u, label }) {
  if (u?.cost_usd == null && u?.output_tokens == null) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] tabular-nums text-slate-400"
      title={`Entrada ${u.input_tokens ?? 0} · Salida ${u.output_tokens ?? 0} · Cache leído ${u.cache_read_tokens ?? 0} · Cache escrito ${u.cache_write_tokens ?? 0}`}>
      {label && <span className="font-medium text-slate-500">{label}</span>}
      <span>↑ {fmtTok(u.input_tokens)}</span>
      <span>↓ {fmtTok(u.output_tokens)}</span>
      <span>cache {fmtTok(u.cache_read_tokens)} leído / {fmtTok(u.cache_write_tokens)} escrito</span>
      {u.cost_usd != null && <span className="font-medium text-slate-600">{fmtUsd(u.cost_usd)}{u.cost_gyd ? ` · G$${Math.round(u.cost_gyd).toLocaleString('en-US')}` : ''}</span>}
    </div>
  );
}

function Message({ m }) {
  const undo = useMutate(() => api.post(`/chat-messages/${m.id}/undo`));
  const [undone, setUndone] = useState(false);
  if (m.role === 'user') {
    return <div className="ml-8 whitespace-pre-wrap rounded-lg bg-ink px-3 py-2 text-sm text-white">{m.text}</div>;
  }
  return (
    <div className="mr-4">
      <div className="prose-chat text-sm text-slate-800"><Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{m.text || (m.pending ? '' : '…')}</Markdown></div>
      {m.pending && <Loader2 size={14} className="mt-1 animate-spin text-slate-400" />}
      <ToolList tools={m.tools} />
      <Usage u={m} />
      {m.audit_ids?.length > 0 && m.id && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          {m.audit_ids.length} cambio{m.audit_ids.length > 1 ? 's' : ''} en el CRM
          {undone || undo.isSuccess
            ? <span className="text-emerald-700">deshecho</span>
            : <button className="flex items-center gap-1 text-brand hover:underline" disabled={undo.isPending}
                onClick={() => confirm('¿Deshacer todos los cambios de esta respuesta?') && undo.mutate(undefined, { onSuccess: () => setUndone(true) })}>
                <Undo2 size={11} /> Deshacer
              </button>}
        </div>
      )}
    </div>
  );
}

/** All sessions: open one, delete one or several. Deleting hides the chat; its token cost stays in Finanzas. */
function Sessions({ currentId, onOpen, onDeleted }) {
  const { data: chats = [] } = useApi('/chats?all=1');
  const [sel, setSel] = useState(new Set());
  const remove = useMutate(ids => api.post('/chats/delete', { ids }));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = chats.length > 0 && sel.size === chats.length;

  function del(ids) {
    const busy = chats.filter(c => ids.includes(c.id) && c.running).length;
    const msg = `¿Eliminar ${ids.length === 1 ? 'esta sesión' : `${ids.length} sesiones`}?`
      + (busy ? `\n${busy === 1 ? 'Una está trabajando y se detendrá' : `${busy} están trabajando y se detendrán`}.` : '')
      + '\nEl costo de tokens se mantiene en Finanzas.';
    if (!confirm(msg)) return;
    remove.mutate(ids, { onSuccess: () => { setSel(new Set()); if (ids.includes(currentId)) onDeleted(); } });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 flex items-center gap-2 border-b bg-white px-3 py-2 text-xs text-slate-500">
        <input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(chats.map(c => c.id)))} />
        <span className="flex-1">{sel.size ? `${sel.size} seleccionada${sel.size > 1 ? 's' : ''}` : `${chats.length} sesiones`}</span>
        {sel.size > 0 && (
          <button className="flex items-center gap-1 text-red-600 hover:underline" disabled={remove.isPending} onClick={() => del([...sel])}>
            <Trash2 size={12} /> Eliminar
          </button>
        )}
      </div>
      {remove.error && <p className="px-3 py-2 text-xs text-red-600">⚠️ {remove.error.message}</p>}
      {!chats.length && <p className="px-4 py-6 text-sm text-slate-500">No hay sesiones.</p>}
      <ul className="divide-y divide-slate-100">
        {chats.map(c => (
          <li key={c.id} className={`group flex items-start gap-2 px-3 py-2 hover:bg-slate-50 ${c.id === currentId ? 'bg-slate-50' : ''}`}>
            <input type="checkbox" className="mt-1" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
            <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(c.id)}>
              <div className="truncate text-sm text-slate-800">
                {c.running && <span className="text-emerald-600">● </span>}
                {c.company && <span className="text-slate-500">[{c.company}] </span>}{c.title}
              </div>
              <div className="text-[11px] tabular-nums text-slate-400">
                {c.updated_at?.slice(0, 16)} · {c.message_count} mensajes{c.cost_usd != null ? ` · ${fmtUsd(c.cost_usd)}` : ''}
              </div>
            </button>
            <button className="p-1 text-slate-400 opacity-0 hover:text-red-600 group-hover:opacity-100" title="Eliminar" onClick={() => del([c.id])}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChatPanel({ onClose }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const clientId = Number(loc.pathname.match(/^\/clients\/(\d+)/)?.[1]) || null;
  const { data: client } = useApi(clientId ? `/clients/${clientId}` : null);
  const { data: chats = [] } = useApi('/chats');
  const [chatId, setChatId] = useState(null);
  const [managing, setManaging] = useState(false);
  const { data: saved = [] } = useApi(chatId ? `/chats/${chatId}/messages` : null);
  const [live, setLive] = useState(null); // turn in progress: { chatId, afterId, user, assistant }
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(() => localStorage.getItem('chat-mode') || 'edit');
  useEffect(() => { localStorage.setItem('chat-mode', mode); }, [mode]);
  const bottom = useRef(null);
  const following = useRef(null); // chat id whose stream we're reading
  const current = chats.find(c => c.id === chatId);
  const running = current?.running;
  const busy = !!live?.assistant.pending || running;

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [saved.length, live?.assistant.text, live?.assistant.tools.length]);

  // Turns run on the server in the background; this only watches one. If the stream drops (CRM restarted),
  // it reconnects and gets a snapshot of what Claude has written so far.
  async function follow(id) {
    if (following.current === id) return;
    following.current = id;
    const update = fn => setLive(l => (l?.chatId === id ? { ...l, assistant: fn(l.assistant) } : l));
    while (following.current === id) {
      let finished = false;
      try {
        const res = await fetch(`/api/chats/${id}/stream`);
        if (!res.ok || !res.body) throw new Error(res.statusText);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done || following.current !== id) break;
          buf += value;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines.filter(Boolean)) {
            const ev = JSON.parse(line);
            if (ev.type === 'snapshot') update(a => ({ ...a, text: ev.text, tools: ev.tools }));
            else if (ev.type === 'text') update(a => ({ ...a, text: a.text + ev.delta }));
            else if (ev.type === 'tool') update(a => ({ ...a, tools: [...a.tools, { name: ev.name, hint: ev.hint }] }));
            else if (ev.type === 'done' || ev.type === 'error') finished = true;
          }
        }
      } catch { /* worker restarting: retry below */ }
      if (finished) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    if (following.current !== id) return;
    following.current = null;
    await qc.invalidateQueries();
    setLive(l => (l?.chatId === id ? null : l));
  }

  // Reattach to a chat that is still working (page reloaded, chat picked from the list, CRM restarted).
  useEffect(() => {
    if (chatId && running && following.current !== chatId) {
      setLive({ chatId, afterId: Infinity, user: null, assistant: { role: 'assistant', text: '', tools: [], pending: true } });
      follow(chatId);
    }
  }, [chatId, running]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectChat(id) {
    following.current = null;
    setLive(null);
    setChatId(id);
    setManaging(false);
  }

  // ?chat=ID (notification click): open that chat, then drop the param.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get('chat'));
    if (!id) return;
    selectChat(id);
    params.delete('chat');
    setParams(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(e) {
    e?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    // Messages saved after this id belong to the live turn (SSE refetches them mid-turn); hide them until it ends.
    const afterId = chatId ? Math.max(0, ...saved.map(m => m.id)) : 0;
    const assistant = { role: 'assistant', text: '', tools: [], pending: true };
    setLive({ chatId, afterId, user: { role: 'user', text: message }, assistant });
    try {
      const { chat_id } = await api.post('/chat', { chat_id: chatId, message, mode, client_id: chatId ? undefined : clientId });
      following.current = null;
      setLive(l => ({ ...l, chatId: chat_id }));
      setChatId(chat_id);
      follow(chat_id);
    } catch (err) {
      setLive(l => ({ ...l, assistant: { ...assistant, text: `⚠️ ${err.message}`, pending: false } }));
    }
  }

  const stop = () => chatId && api.post(`/chats/${chatId}/stop`);
  const messages = live ? [...saved.filter(m => m.id <= live.afterId), ...(live.user ? [live.user] : []), live.assistant] : saved;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <select className="input flex-1 text-xs" value={chatId ?? ''} onChange={e => selectChat(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Nueva conversación</option>
          {chats.map(c => <option key={c.id} value={c.id}>{c.running ? '● ' : ''}{c.company ? `[${c.company}] ` : ''}{c.title}</option>)}
        </select>
        <button className={`btn-ghost px-2 ${managing ? 'text-brand' : ''}`} title="Sesiones" onClick={() => setManaging(m => !m)}><History size={15} /></button>
        <button className="btn-ghost px-2" title="Nueva" onClick={() => selectChat(null)}><Plus size={15} /></button>
        <button className="btn-ghost px-2" onClick={onClose}><X size={15} /></button>
      </header>
      {managing && <Sessions currentId={chatId} onOpen={selectChat} onDeleted={() => selectChat(null)} />}
      <div className={`flex-1 space-y-4 overflow-y-auto px-4 py-4 ${managing ? 'hidden' : ''}`}>
        {!messages.length && (
          <div className="space-y-2 pt-6 text-sm text-slate-500">
            <p className="font-medium text-slate-700">Pídeme lo que necesites del CRM.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>"¿Qué tengo pendiente esta semana?"</li>
              <li>"Registra que Eddie respondió por WhatsApp y súbelo a Respondió"</li>
              <li>"Cotiza a Acme G$120,000 por el servicio de este mes"</li>
              <li>"¿Cuánto entró y cuánto gasté este mes?"</li>
              <li>"Recuérdame el viernes a las 9 am llamar a María"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => <Message key={m.id ?? `live-${i}`} m={m} />)}
        {saved.filter(m => m.cost_usd != null).length > 1 && (
          <div className="border-t border-dashed border-slate-200 pt-1">
            <Usage label="Total chat" u={saved.reduce((t, m) => {
              for (const k of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'cost_gyd']) t[k] = (t[k] || 0) + (m[k] || 0);
              return t;
            }, {})} />
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className={`border-t p-3 ${managing ? 'hidden' : ''}`}>
        {clientId && !chatId && client && (
          <div className="mb-2 text-xs text-slate-500">Contexto: <b className="text-slate-700">{client.company}</b></div>
        )}
        <div className="flex items-end gap-2">
          <textarea className="input max-h-40 min-h-[40px] flex-1 resize-none" rows={2} placeholder="Escríbele a Claude…" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
          <div className="flex flex-col items-stretch gap-1.5">
            <div className="flex rounded-md border border-slate-200 p-0.5 text-[11px]">
              {Object.entries(MODES).map(([k, { label, Icon, title }]) => (
                <button key={k} type="button" title={title} onClick={() => setMode(k)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 disabled:opacity-40 ${mode === k ? 'bg-ink text-white' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>
            {busy
              ? <button type="button" className="btn-ghost justify-center text-red-600" onClick={stop} title="Detener"><Square size={15} /></button>
              : <button className="btn-primary justify-center" disabled={!input.trim()}><Send size={15} /></button>}
          </div>
        </div>
      </form>
    </aside>
  );
}
