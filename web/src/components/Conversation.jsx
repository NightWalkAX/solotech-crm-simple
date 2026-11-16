import { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, MessageCircle, Mail, Upload, Send, Inbox } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { waLink } from '../lib/format.js';
import WhatsAppImport from './WhatsAppImport.jsx';

function fmt(ts) {
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es', { timeZone: 'America/Guyana', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Suggestions({ clientId, channel, onUse }) {
  const { data } = useApi(`/suggestions?client_id=${clientId}&channel=${channel}`);
  const [instructions, setInstructions] = useState('');
  const gen = useMutate(body => api.post('/suggestions', body));
  const s = gen.isPending ? null : data?.suggestion;
  const run = force => gen.mutate({ client_id: clientId, channel, force, instructions: instructions.trim() || undefined }, { onSuccess: () => setInstructions('') });
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles size={14} className="text-amber" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Respuestas sugeridas</span>
        {s && <span className="text-xs text-slate-400">guardadas · no se vuelven a generar</span>}
      </div>
      {gen.isPending && <p className="py-3 text-sm text-slate-500">Pensando 3 respuestas… (unos 15 s)</p>}
      {gen.error && <p className="text-sm text-red-600">{gen.error.message}</p>}
      {s && (
        <div className="grid gap-2 2xl:grid-cols-3">
          {s.options.map((o, i) => (
            <div key={i} className={`card flex flex-col p-3 ${s.used_index === i ? 'ring-2 ring-emerald-300' : ''}`}>
              <div className="mb-1 text-xs font-semibold text-slate-500">{o.label}</div>
              {o.subject && <div className="mb-1 text-xs text-slate-600">Asunto: {o.subject}</div>}
              <p className="flex-1 whitespace-pre-wrap text-sm text-slate-800">{o.text}</p>
              <button className="btn-ghost mt-2 self-end text-xs" onClick={() => { onUse(o); api.post(`/suggestions/${s.id}/used`, { index: i }); }}>Usar esta</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input className="input flex-1" placeholder="Indicación opcional: “menciona que puedo pasar el martes”, “más corto”…" value={instructions} onChange={e => setInstructions(e.target.value)} />
        {!s && !gen.isPending && <button className="btn-primary" onClick={() => run(false)}><Sparkles size={14} /> Sugerir respuestas</button>}
        {s && <button className="btn-ghost" disabled={gen.isPending} onClick={() => run(true)}><RefreshCw size={14} /> {instructions.trim() ? 'Generar con indicación' : 'Regenerar'}</button>}
      </div>
    </div>
  );
}

export default function Conversation({ client }) {
  const [channel, setChannel] = useState(client.whatsapp || !client.email ? 'whatsapp' : 'email');
  const { data: messages = [] } = useApi(`/messages?client_id=${client.id}&channel=${channel}`);
  const [draft, setDraft] = useState({ text: '', subject: '' });
  const [importing, setImporting] = useState(false);
  const log = useMutate(body => api.post('/messages', body));
  const { data: graph } = useApi('/integrations/graph');
  const mailLive = channel === 'email' && graph?.connected;
  const wa = null; // WhatChimp hidden for now: WhatsApp goes through "Abrir en WhatsApp"
  const { data: win } = useApi(channel === 'whatsapp' && wa?.connected ? `/integrations/whatsapp/window?client_id=${client.id}` : null);
  const waLive = channel === 'whatsapp' && wa?.connected && win?.open;
  const sendWa = useMutate(body => api.post('/integrations/whatsapp/send', body));
  const waBackfill = useMutate(() => api.post('/integrations/whatsapp/backfill', { phone: client.whatsapp || client.phone }));
  const sendMail = useMutate(body => api.post('/integrations/graph/send', body));
  const backfill = useMutate(() => api.post('/integrations/graph/backfill', { address: client.email }));
  const replyTo = [...messages].reverse().find(m => m.direction === 'in' && m.source === 'graph');
  const bottom = useRef(null);
  const unread = messages.some(m => m.direction === 'in' && !m.read_at);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  useEffect(() => { if (unread) api.post('/messages/read', { client_id: client.id }); }, [unread, client.id]);

  const record = direction => log.mutate(
    { client_id: client.id, channel, direction, body: draft.text, subject: channel === 'email' ? draft.subject : undefined },
    { onSuccess: () => setDraft({ text: '', subject: '' }) },
  );
  const sendExternal = () => {
    if (waLive) {
      sendWa.mutate({ client_id: client.id, text: draft.text }, { onSuccess: () => setDraft({ text: '', subject: '' }) });
      return;
    }
    if (mailLive) {
      sendMail.mutate({ client_id: client.id, subject: draft.subject, text: draft.text }, { onSuccess: () => setDraft({ text: '', subject: '' }) });
      return;
    }
    if (channel === 'whatsapp') {
      const url = waLink(client.whatsapp || client.phone);
      if (url) window.open(`${url}?text=${encodeURIComponent(draft.text)}`, '_blank');
    } else {
      window.open(`mailto:${client.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.text)}`);
    }
    record('out');
  };
  const canSend = channel === 'whatsapp' ? !!(client.whatsapp || client.phone) : !!client.email;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <div className="flex gap-1">
          {[['whatsapp', 'WhatsApp', MessageCircle], ['email', 'Correo', Mail]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setChannel(k)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${channel === k ? 'bg-ink text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {channel === 'whatsapp' && (
          <div className="flex items-center gap-1">
            {wa?.connected && (client.whatsapp || client.phone) && (
              <button className="btn-ghost text-xs" disabled={waBackfill.isPending} onClick={() => waBackfill.mutate()}>
                {waBackfill.isPending ? 'Buscando…' : waBackfill.data ? `${waBackfill.data.added} mensajes nuevos` : 'Traer historial'}
              </button>
            )}
            <button className="btn-ghost text-xs" onClick={() => setImporting(true)}><Upload size={13} /> Importar chat exportado</button>
          </div>
        )}
        {mailLive && client.email && (
          <button className="btn-ghost text-xs" disabled={backfill.isPending} onClick={() => backfill.mutate()}>
            {backfill.isPending ? 'Buscando…' : backfill.data ? `${backfill.data.added} correos nuevos` : 'Traer historial de correo'}
          </button>
        )}
      </header>
      <div className="max-h-[420px] space-y-2 overflow-y-auto bg-[#f4f1ec] px-4 py-3">
        {!messages.length && (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Inbox size={15} />
            Sin mensajes todavía. {channel === 'whatsapp' ? 'Importa el chat exportado o registra los mensajes abajo.' : 'Cuando conectemos tu correo M365 aparecerán aquí solos.'}
          </p>
        )}
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === 'out' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
              {m.subject && <div className="mb-1 text-xs font-semibold">{m.subject}</div>}
              <div className="whitespace-pre-wrap">{m.body}</div>
              <div className="mt-1 text-right text-[10px] text-slate-500">{fmt(m.sent_at)}{m.status === 'sent_manual' ? ' · enviado a mano' : ''}</div>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <Suggestions clientId={client.id} channel={channel} onUse={o => setDraft({ text: o.text, subject: o.subject || draft.subject })} />
      <div className="space-y-2 border-t border-slate-100 px-4 py-3">
        {channel === 'email' && (mailLive && replyTo
          ? <p className="text-xs text-slate-500">Respondiendo en el hilo: <b>{replyTo.subject}</b></p>
          : <input className="input" placeholder="Asunto" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} />)}
        {sendMail.error && <p className="text-sm text-red-600">{sendMail.error.message}</p>}
        {sendWa.error && <p className="text-sm text-red-600">{sendWa.error.message}</p>}
        {channel === 'whatsapp' && wa?.connected && win && (
          <p className={`text-xs ${win.open ? 'text-emerald-700' : 'text-amber-700'}`}>
            {win.open
              ? 'Ventana de 24 h abierta: puedes responder directo desde aquí.'
              : 'Fuera de la ventana de 24 h (el cliente no te ha escrito hoy): WhatsApp solo permite plantillas aprobadas. Usa “Abrir en WhatsApp” para escribir desde tu teléfono.'}
          </p>
        )}
        <textarea className="input" rows={3} placeholder="Escribe o usa una sugerencia…" value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} />
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost text-xs" disabled={!draft.text.trim() || log.isPending} onClick={() => record('in')} title="Pegaste un mensaje que te mandó el cliente">
            Registrar como recibido
          </button>
          <button className="btn-ghost text-xs" disabled={!draft.text.trim() || log.isPending} onClick={() => record('out')}>Registrar como enviado</button>
          <button className="btn-primary" disabled={!draft.text.trim() || !canSend || sendMail.isPending || sendWa.isPending}
            onClick={() => (mailLive ? confirm(`¿Enviar este correo a ${client.email}?`) : waLive ? confirm(`¿Enviar por WhatsApp a ${client.whatsapp || client.phone}?`) : true) && sendExternal()}
            title={canSend ? '' : `Este cliente no tiene ${channel === 'whatsapp' ? 'número' : 'correo'}`}>
            <Send size={14} /> {channel === 'whatsapp' ? (waLive ? (sendWa.isPending ? 'Enviando…' : 'Enviar por WhatsApp') : 'Abrir en WhatsApp') : mailLive ? (sendMail.isPending ? 'Enviando…' : 'Enviar correo') : 'Abrir en correo'}
          </button>
        </div>
      </div>
      {importing && <WhatsAppImport clientId={client.id} onClose={() => setImporting(false)} />}
    </section>
  );
}
