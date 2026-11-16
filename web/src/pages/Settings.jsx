import { useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, EyeOff, Mic, Bell } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { ago, phone } from '../lib/format.js';
import { PageHeader } from '../components/ui.jsx';
import { pushSupported, currentSubscription, enablePush, disablePush } from '../lib/push.js';
import IssuerCard from '../components/IssuerCard.jsx';

function WhatsAppCard() {
  const { data: w } = useApi('/integrations/whatsapp');
  const [pid, setPid] = useState('');
  const [tok, setTok] = useState('');
  const save = useMutate(body => api.post('/integrations/whatsapp/config', body));
  const sync = useMutate(() => api.post('/integrations/whatsapp/sync'));
  if (!w) return null;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <MessageCircle size={18} className="text-emerald-600" />
        <h2 className="font-semibold text-ink">WhatsApp · WhatChimp</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${w.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {w.connected ? 'Conectado' : 'No conectado'}
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-600">Revisa los chats nuevos cada minuto. Los números desconocidos llegan a la Bandeja como “sin asignar”.</p>
      {w.connected ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Última revisión: <b>{w.syncing ? 'revisando…' : ago(w.last_sync)}</b> · Phone number ID <code>{w.phone_number_id}</code></p>
          {w.last_error && <p className="text-red-600">{w.last_error}</p>}
          <button className="btn-primary" disabled={sync.isPending || w.syncing} onClick={() => sync.mutate()}><RefreshCw size={14} /> Revisar ahora</button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="label">API token {w.has_token && <span className="font-normal text-slate-500">(ya guardado; déjalo vacío para conservarlo)</span>}</label>
          <input className="input font-mono text-xs" type="password" autoComplete="off" value={tok} onChange={e => setTok(e.target.value)} />
          <label className="label">Phone number ID</label>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" placeholder="ej. 1234567890123456" value={pid} onChange={e => setPid(e.target.value)} />
            <button className="btn-primary" disabled={!pid.trim() || (!w.has_token && !tok.trim()) || save.isPending} onClick={() => save.mutate({ phone_number_id: pid, api_token: tok }, { onSuccess: () => setTok('') })}>Verificar</button>
          </div>
          {save.error && <p className="text-sm text-red-600">{save.error.message}</p>}
          <p className="text-xs text-slate-500">Ambos están en WhatChimp: el API token en la configuración de la API y el Phone number ID en la cuenta de WhatsApp (o en Meta WhatsApp Manager → Números de teléfono).</p>
        </div>
      )}
    </section>
  );
}

const hhmm = ts => (ts ? new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Guyana' }) : '—');

const PROMPT_STATUS = {
  queued: ['En cola', 'bg-slate-100 text-slate-600'], transcribing: ['Transcribiendo', 'bg-amber-50 text-amber-700'],
  running: ['Trabajando', 'bg-amber-50 text-amber-700'], done: ['Respondido', 'bg-emerald-50 text-emerald-700'],
  error: ['Error', 'bg-red-50 text-red-700'], skipped: ['Omitido', 'bg-slate-100 text-slate-500'],
};

function WhatsAppPromptsCard() {
  const { data: p } = useApi('/integrations/whatsapp/prompts', { refetchInterval: 5000 });
  const [phoneDraft, setPhoneDraft] = useState(null);
  const save = useMutate(body => api.post('/integrations/whatsapp/prompts', body));
  if (!p) return null;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Mic size={18} className="text-emerald-600" />
        <h2 className="font-semibold text-ink">Prompts por WhatsApp</h2>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={p.enabled} disabled={save.isPending || !p.connected} onChange={e => save.mutate({ enabled: e.target.checked })} />
          {p.enabled ? 'Activo' : 'Apagado'}
        </label>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Lo que mandes desde tu número personal al número del negocio (texto o nota de voz) lo procesa Claude en segundo plano (no aparece en el panel de chat) y la respuesta vuelve por WhatsApp; los reportes llegan como PDF o Excel. Escribe “nuevo” para empezar otra conversación.
      </p>
      {!p.connected && <p className="mb-3 text-sm text-red-600">WhatsApp (WhatChimp) no está conectado.</p>}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="label">Tu número</label>
          <div className="flex gap-2">
            <input className="input font-mono text-xs" value={phoneDraft ?? phone(p.phone)} onChange={e => setPhoneDraft(e.target.value)} />
            {phoneDraft != null && <button className="btn-ghost text-xs" onClick={() => save.mutate({ phone: phoneDraft }, { onSuccess: () => setPhoneDraft(null) })}>Guardar</button>}
          </div>
        </div>
        <div>
          <label className="label">Modo por defecto</label>
          <select className="input" value={p.mode} onChange={e => save.mutate({ mode: e.target.value })}>
            <option value="edit">Edit · solo datos del CRM (Sonnet)</option>
            <option value="build">Build · todas las herramientas (Opus)</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Ahora: <b>{p.effective_mode === 'build' ? '🛠️ Build' : '✏️ Edit'}</b>
            {p.effective_mode !== p.mode && ' (cambiado desde WhatsApp)'} · desde tu WhatsApp: «modo build» (pide código) / «modo edit» / «¿en qué modo estoy?»
          </p>
        </div>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={p.echo_transcript} onChange={e => save.mutate({ echo_transcript: e.target.checked })} />
        Devolverme la transcripción de cada nota de voz
      </label>
      {save.error && <p className="mt-2 text-sm text-red-600">{save.error.message}</p>}
      {p.last_error && <p className="mt-2 text-sm text-red-600">{p.last_error}</p>}
      {p.transcriber_error && <p className="mt-2 text-sm text-red-600">Transcriptor: {p.transcriber_error}</p>}
      {p.enabled && (
        <p className="mt-3 text-xs text-slate-500">
          Revisa tu chat cada 5 s · última: {hhmm(p.last_poll)} · transcriptor: {{ off: 'en reposo', loading: 'cargando modelo…', ready: 'listo' }[p.transcriber]}
        </p>
      )}
      {!!p.recent.length && (
        <div className="mt-3">
          {p.recent.map(r => (
            <div key={r.id} className="flex items-center gap-2 border-t border-slate-100 py-1.5 text-sm">
              <span className="shrink-0 text-xs text-slate-400">{hhmm(r.received_at).slice(0, 5)}</span>
              <span className="min-w-0 flex-1 truncate" title={r.error || r.body}>{r.kind === 'audio' ? '🎙️ ' : ''}{r.body || (r.kind === 'audio' ? 'nota de voz' : '')}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${PROMPT_STATUS[r.status]?.[1]}`} title={r.error || ''}>{PROMPT_STATUS[r.status]?.[0]}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function IgnoredCard() {
  const { data: ignored = [] } = useApi('/ignored');
  const restore = useMutate(id => api.del(`/ignored/${id}`));
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <EyeOff size={18} className="text-slate-500" />
        <h2 className="font-semibold text-ink">Chats ignorados</h2>
        <span className="ml-auto text-xs text-slate-500">{ignored.length}</span>
      </div>
      <p className="mb-3 text-sm text-slate-600">No aparecen en la Bandeja y sus mensajes nuevos no se guardan.</p>
      {!ignored.length && <p className="text-sm text-slate-500">Ninguno. Usa “Ignorar chat” en un chat sin asignar.</p>}
      {ignored.map(t => (
        <div key={t.id} className="flex items-center justify-between gap-2 border-t border-slate-100 py-2 text-sm">
          <span className="min-w-0 truncate">
            {t.label && <b>{t.label} </b>}
            <span className="text-slate-500">{/@/.test(t.thread_key) ? t.thread_key : phone(t.thread_key)} · {ago(t.created_at)}</span>
          </span>
          <button className="btn-ghost shrink-0 text-xs" disabled={restore.isPending} onClick={() => restore.mutate(t.id)}>Dejar de ignorar</button>
        </div>
      ))}
    </section>
  );
}

const PUSH_EVENTS = [
  ['chat', 'Claude terminó una respuesta en el panel de chat'],
  ['jobs', 'Programados: recordatorios, briefings y tareas'],
  ['inbox', 'Mensaje nuevo de un cliente por WhatsApp'],
];

const device = ua => /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : 'Navegador';

function PushCard() {
  const { data: p } = useApi('/push');
  const [mine, setMine] = useState(null); // this browser's endpoint
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = useMutate(body => api.post('/push/config', body));
  const test = useMutate(() => api.post('/push/test'));
  const remove = useMutate(id => api.post('/push/unsubscribe', { id }));
  useEffect(() => { currentSubscription().then(s => setMine(s?.endpoint ?? null)); }, [p?.devices?.length]);
  if (!p) return null;
  const supported = pushSupported();
  const here = !!mine && p.devices.some(d => d.endpoint === mine) && Notification.permission === 'granted';
  async function toggle() {
    setBusy(true); setError(null);
    try {
      if (here) { await disablePush(); setMine(null); } else { await enablePush(p.public_key); setMine((await currentSubscription())?.endpoint ?? null); }
      save.reset();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Bell size={18} className="text-amber" />
        <h2 className="font-semibold text-ink">Notificaciones</h2>
        {supported && (
          <button className={`ml-auto shrink-0 text-xs ${here ? 'btn-ghost' : 'btn-primary'}`} disabled={busy} onClick={toggle}>
            {here ? 'Desactivar aquí' : 'Activar aquí'}
          </button>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-600">
        Avisos del sistema aunque el CRM esté cerrado o minimizado. Para tenerlo como app, instálalo desde el ícono de instalar en la barra de direcciones (Chrome/Edge).
      </p>
      {!supported && <p className="mb-3 text-sm text-red-600">Este navegador no soporta notificaciones push.</p>}
      {supported && Notification.permission === 'denied' && <p className="mb-3 text-sm text-red-600">El navegador tiene las notificaciones bloqueadas para este sitio: habilítalas en el candado de la barra de direcciones.</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="space-y-1.5">
        {PUSH_EVENTS.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={!!p[k]} disabled={save.isPending} onChange={e => save.mutate({ [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-slate-500">{p.devices.length} dispositivo{p.devices.length === 1 ? '' : 's'}</span>
        <button className="btn-ghost ml-auto text-xs" disabled={!p.devices.length || test.isPending} onClick={() => test.mutate()}>Enviar prueba</button>
      </div>
      {test.data && <p className="mt-1 text-xs text-slate-500">Enviada a {test.data.sent} dispositivo{test.data.sent === 1 ? '' : 's'}.</p>}
      {p.devices.map(d => (
        <div key={d.id} className="flex items-center gap-2 border-t border-slate-100 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate" title={d.last_error || d.user_agent}>
            {device(d.user_agent || '')}{d.endpoint === mine ? ' · este navegador' : ''}
            <span className="text-xs text-slate-500"> · desde {ago(d.created_at)}</span>
            {d.last_error && <span className="text-xs text-red-600"> · error</span>}
          </span>
          <button className="btn-ghost shrink-0 text-xs" disabled={remove.isPending} onClick={() => remove.mutate(d.id)}>Quitar</button>
        </div>
      ))}
    </section>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader title="Integraciones" />
      <div className="grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
        <IssuerCard />
        <WhatsAppCard />
        <WhatsAppPromptsCard />
        <PushCard />
        <IgnoredCard />
      </div>
    </>
  );
}
