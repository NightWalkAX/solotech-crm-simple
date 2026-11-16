import { useState } from 'react';
import { AlarmClock, Sunrise, Bot, Play, Pause, X, Trash2, ChevronDown, ChevronRight, Save, MessageCircle, Monitor } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, useApi, useMutate } from '../lib/api.js';
import { PageHeader } from '../components/ui.jsx';

const KIND = {
  reminder: ['Recordatorio', AlarmClock, 'bg-amber-50 text-amber-700'],
  briefing: ['Briefing', Sunrise, 'bg-violet-50 text-violet-700'],
  task: ['Tarea', Bot, 'bg-slate-100 text-slate-600'],
};
const STATUS = {
  done: ['ok', 'text-emerald-700'], error: ['error', 'text-red-600'], missed: ['no corrió', 'text-amber-700'], running: ['corriendo…', 'text-sky-700'],
};
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const hm = (h, m) => { const n = Number(h); return `${n % 12 || 12}:${String(m).padStart(2, '0')} ${n < 12 ? 'am' : 'pm'}`; };
/** "2026-10-04 07:00" (Guyana) → "sáb 4 oct, 7:00 am" */
function when(local) {
  if (!local) return '—';
  const [d, t] = local.split(' ');
  const date = new Date(`${d}T12:00:00Z`);
  const [h, m] = t.split(':');
  return `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${date.toLocaleString('es', { month: 'short', timeZone: 'UTC' })}, ${hm(h, m)}`;
}
/** Common cron shapes in words; anything else shown raw. */
function cronText(cron) {
  const [m, h, dom, mon, dow] = cron.split(/\s+/);
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h) || dom !== '*' || mon !== '*') return `cron ${cron}`;
  const at = `a las ${hm(h, m)}`;
  if (dow === '*') return `Todos los días ${at}`;
  const days = dow.split(',').map(p => p.includes('-') ? p.split('-').map(n => DAYS[n % 7]).join('–') : DAYS[p % 7]).join(', ');
  return `${days[0].toUpperCase()}${days.slice(1)} ${at}`;
}

function Runs({ jobId }) {
  const { data: runs = [] } = useApi(`/jobs/${jobId}/runs`);
  if (!runs.length) return <p className="px-4 pb-3 text-sm text-slate-400">Todavía no ha corrido.</p>;
  return (
    <ul className="space-y-2 px-4 pb-4">
      {runs.map(r => {
        const [label, cls] = STATUS[r.status] ?? [r.status, 'text-slate-500'];
        return (
          <li key={r.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex gap-3 text-xs text-slate-500">
              <span>{when(r.started_local)}</span><span className={cls}>{label}</span>
              {r.error && <span className="text-red-600">{r.error}</span>}
            </div>
            {r.output && <div className="prose-chat mt-1 max-h-64 overflow-y-auto text-slate-700"><Markdown remarkPlugins={[remarkGfm]}>{r.output}</Markdown></div>}
          </li>
        );
      })}
    </ul>
  );
}

function JobRow({ j }) {
  const [open, setOpen] = useState(false);
  const patch = useMutate(body => api.patch(`/jobs/${j.id}`, body));
  const runNow = useMutate(() => api.post(`/scheduler/jobs/${j.id}/run`));
  const del = useMutate(() => api.del(`/jobs/${j.id}`));
  const [label, Icon, cls] = KIND[j.kind] ?? [j.kind, Bot, 'bg-slate-100'];
  const [lastLabel, lastCls] = STATUS[j.last_status] ?? [];
  const live = j.status === 'active' || j.status === 'paused';
  const err = patch.error || runNow.error || del.error;
  return (
    <article className="border-b border-slate-100 last:border-0">
      <div className="group flex items-start gap-3 px-4 py-3">
        <button className="mt-0.5 text-slate-400" onClick={() => setOpen(o => !o)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setOpen(o => !o)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}><Icon size={12} /> {label}</span>
            <span className="font-medium text-ink">{j.title}</span>
            {j.company && <span className="text-xs text-slate-500">[{j.company}]</span>}
            {j.status === 'paused' && <span className="rounded bg-slate-200 px-1.5 text-[11px] text-slate-600">pausado</span>}
            {j.status === 'cancelled' && <span className="rounded bg-slate-200 px-1.5 text-[11px] text-slate-600">cancelado</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span>{j.cron ? cronText(j.cron) : `Una vez: ${when(j.run_at_local)}`}</span>
            {j.status === 'active' && j.next_run_local && <span>Próxima: <b className="text-slate-700">{when(j.next_run_local)}</b></span>}
            {j.last_run_local && <span>Última: {when(j.last_run_local)} <span className={lastCls}>{lastLabel}</span></span>}
            <span className="inline-flex items-center gap-1">{j.deliver === 'whatsapp' ? <><MessageCircle size={11} /> WhatsApp</> : <><Monitor size={11} /> Solo CRM</>}</span>
          </div>
          {j.last_error && j.last_status !== 'done' && <div className="mt-0.5 text-xs text-red-600">{j.last_error}</div>}
          {err && <div className="mt-0.5 text-xs text-red-600">⚠️ {err.message}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-slate-500">
          <button className="btn-ghost px-1.5" title="Ejecutar ahora" disabled={runNow.isPending} onClick={() => runNow.mutate()}><Play size={14} /></button>
          {j.status === 'active' && <button className="btn-ghost px-1.5" title="Pausar" onClick={() => patch.mutate({ status: 'paused' })}><Pause size={14} /></button>}
          {j.status === 'paused' && <button className="btn-ghost px-1.5 text-emerald-700" title="Reanudar" onClick={() => patch.mutate({ status: 'active' })}>Reanudar</button>}
          {live && <button className="btn-ghost px-1.5" title="Cancelar" onClick={() => confirm(`¿Cancelar "${j.title}"?`) && patch.mutate({ status: 'cancelled' })}><X size={14} /></button>}
          {!live && <button className="btn-ghost px-1.5 hover:text-red-600" title="Eliminar" onClick={() => confirm('¿Eliminar este programado y su historial?') && del.mutate()}><Trash2 size={14} /></button>}
        </div>
      </div>
      {open && (
        <>
          {j.prompt && <p className="mx-4 mb-2 whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">{j.prompt}</p>}
          <Runs jobId={j.id} />
        </>
      )}
    </article>
  );
}

function Availability() {
  const { data: cfg } = useApi('/jobs/config');
  const [text, setText] = useState(null);
  const save = useMutate(availability => api.put('/jobs/config', { availability }));
  if (!cfg) return null;
  const value = text ?? cfg.availability;
  return (
    <section className="card space-y-2 p-5">
      <h2 className="font-semibold text-ink">Mi disponibilidad</h2>
      <p className="text-xs text-slate-500">Claude la usa en los briefings, al planificar y al proponer fechas (en todos los chats).</p>
      <textarea className="input text-sm" rows={6} value={value} onChange={e => setText(e.target.value)} />
      <div className="flex justify-end">
        <button className="btn-primary" disabled={text == null || save.isPending} onClick={() => save.mutate(text, { onSuccess: () => setText(null) })}>
          <Save size={14} /> Guardar
        </button>
      </div>
    </section>
  );
}

export default function Jobs() {
  const { data: jobs = [] } = useApi('/jobs');
  const current = jobs.filter(j => j.status === 'active' || j.status === 'paused');
  const past = jobs.filter(j => j.status === 'done' || j.status === 'cancelled');
  return (
    <>
      <PageHeader title="Programados" />
      <div className="grid max-w-6xl gap-4 p-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card">
            <div className="border-b px-4 py-3 text-sm font-semibold text-ink">Activos ({current.length})</div>
            {current.length ? current.map(j => <JobRow key={j.id} j={j} />) : (
              <div className="space-y-1 px-4 py-4 text-sm text-slate-500">
                <p>Nada programado. Pídeselo al chat, por ejemplo:</p>
                <ul className="list-disc pl-5">
                  <li>“Envíale un correo a Eddie el lunes a las 8 am diciendo…” (borrador → apruebas → se programa)</li>
                  <li>“Lanza una cacería de restaurantes en Linden el sábado a las 9”</li>
                  <li>“Recuérdame llamar a Malali el jueves a las 6 pm”</li>
                  <li>“Dame un briefing todos los días a las 7 am y a las 7 pm”</li>
                </ul>
              </div>
            )}
          </section>
          {past.length > 0 && (
            <section className="card">
              <div className="border-b px-4 py-3 text-sm font-semibold text-slate-600">Historial ({past.length})</div>
              {past.map(j => <JobRow key={j.id} j={j} />)}
            </section>
          )}
        </div>
        <div className="space-y-4">
          <Availability />
          <section className="card space-y-1 p-5 text-xs text-slate-500">
            <p>Horas en Guyana. Los resultados llegan a tu WhatsApp (línea de Integraciones) y quedan en el chat del CRM.</p>
            <p>WhatsApp solo deja enviarte texto libre dentro de las 24 h desde tu último mensaje a la línea; si no, queda en el CRM con el error.</p>
            <p>Si el CRM estaba apagado a la hora, los recurrentes se saltan si pasaron más de 3 h; los correos, si pasaron más de 12 h.</p>
          </section>
        </div>
      </div>
    </>
  );
}
