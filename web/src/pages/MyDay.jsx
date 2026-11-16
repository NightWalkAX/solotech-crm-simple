import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Moon, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { todayISO } from '../lib/format.js';
import { ContextButton } from '../components/ActionItems.jsx';

// Mi Día: a calm view of today's tasks. One task in focus, at most two "después", the rest hidden on purpose.
// Data = open action_items due today or overdue (oldest first). "Mañana" moves due_date to tomorrow (audited, undoable).

const tomorrowISO = () => new Date(Date.parse(todayISO()) + 86400e3).toISOString().slice(0, 10);

// "Otra primero" with incremental jumps: the n-th skip of the same task moves it n places down (clamped to the end).
// Order + per-task skip counts live in localStorage for today only, so a refetch or reload keeps them; new tasks go last.
const SKIP_KEY = 'myday.skips';
function loadSkips() {
  try {
    const s = JSON.parse(localStorage.getItem(SKIP_KEY));
    if (s?.day === todayISO()) return s;
  } catch { /* ignore */ }
  return { day: todayISO(), order: [], counts: {} };
}
function orderQueue(pending, order) {
  const byId = new Map(pending.map(a => [a.id, a]));
  const known = order.filter(id => byId.has(id));
  const fresh = pending.filter(a => !known.includes(a.id)).map(a => a.id);
  return [...known, ...fresh].map(id => byId.get(id));
}
const doneToday = a => a.done_at && new Date(Date.parse(a.done_at) - 4 * 3600e3).toISOString().slice(0, 10) === todayISO();

function dayHint() {
  const wd = new Date(Date.parse(todayISO())).getUTCDay();
  if (wd === 0 || wd === 6) return 'Fin de semana. Ve a tu ritmo.';
  return 'Una cosa a la vez. Empieza por la de arriba.';
}

function FocusCard({ a, onSkip, canSkip }) {
  const done = useMutate(() => api.patch(`/actions/${a.id}`, { status: 'done' }));
  const later = useMutate(() => api.patch(`/actions/${a.id}`, { due_date: tomorrowISO() }));
  return (
    <div className="rounded-2xl bg-white px-8 py-10 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Ahora</div>
      <div className="text-2xl font-medium leading-snug text-ink">{a.title}</div>
      {(a.company || a.notes) && (
        <div className="mt-3 space-y-1 text-sm text-slate-500">
          {a.company && <Link to={`/clients/${a.client_id}`} className="hover:text-ink">{a.company}</Link>}
          {a.notes && <p className="line-clamp-3 whitespace-pre-line">{a.notes}</p>}
        </div>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button className="flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-ink/90"
          disabled={done.isPending} onClick={() => done.mutate()}><Check size={16} /> Hecho</button>
        <button className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-100"
          disabled={later.isPending} onClick={() => later.mutate()}><Moon size={15} /> Mañana</button>
        <ContextButton a={a} label="Contexto" className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-100" />
        {canSkip && <button className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-500 hover:bg-slate-100"
          onClick={onSkip}><ArrowRight size={15} /> Otra primero</button>}
      </div>
    </div>
  );
}

export default function MyDay() {
  const { data: t } = useApi('/today');
  const { data: done = [] } = useApi('/actions?status=done');
  const [skips, setSkips] = useState(loadSkips);
  const [showRest, setShowRest] = useState(false);
  if (!t) return null;

  const pending = [...t.overdue, ...t.due_today];
  const queue = orderQueue(pending, skips.day === todayISO() ? skips.order : []);
  const [focus, ...others] = queue;

  const skipFocus = () => {
    const base = skips.day === todayISO() ? skips : { day: todayISO(), order: [], counts: {} };
    const n = (base.counts[focus.id] || 0) + 1;
    const ids = queue.map(a => a.id).slice(1);
    ids.splice(Math.min(n, ids.length), 0, focus.id);
    const nextSkips = { day: base.day, order: ids, counts: { ...base.counts, [focus.id]: n } };
    localStorage.setItem(SKIP_KEY, JSON.stringify(nextSkips));
    setSkips(nextSkips);
  };
  const next = others.slice(0, 2);
  const rest = others.slice(2);
  const finished = done.filter(doneToday);

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-xl px-6 py-14">
        <h1 className="text-xl font-semibold text-ink">Mi día</h1>
        <p className="mt-1 text-sm text-slate-500">{dayHint()}</p>

        <div className="mt-10">
          {focus
            ? <FocusCard key={focus.id} a={focus} canSkip={queue.length > 1} onSkip={skipFocus} />
            : (
              <div className="rounded-2xl bg-white px-8 py-12 text-center shadow-sm ring-1 ring-slate-200">
                <Sparkles className="mx-auto text-amber" size={28} />
                <div className="mt-3 text-lg font-medium text-ink">Nada pendiente para hoy.</div>
                <p className="mt-1 text-sm text-slate-500">Descansa o avanza algo que te guste.</p>
              </div>
            )}
        </div>

        {next.length > 0 && (
          <div className="mt-10">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Después</div>
            {next.map(a => <div key={a.id} className="py-1.5 text-sm text-slate-500">{a.title}</div>)}
          </div>
        )}

        {rest.length > 0 && (
          <div className="mt-6">
            <button className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600" onClick={() => setShowRest(s => !s)}>
              {showRest ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {showRest ? 'Ocultar' : `${rest.length} más pueden esperar`}
            </button>
            {showRest && rest.map(a => <div key={a.id} className="py-1 text-xs text-slate-400">{a.title}</div>)}
          </div>
        )}

        {finished.length > 0 && (
          <div className="mt-14 border-t border-slate-200 pt-6">
            <div className="text-sm text-emerald-700">
              <Check size={14} className="mr-1 inline" />
              {finished.length === 1 ? 'Ya hiciste 1 cosa hoy.' : `Ya hiciste ${finished.length} cosas hoy.`}
            </div>
            {finished.map(a => <div key={a.id} className="mt-1 text-xs text-slate-400 line-through">{a.title}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
