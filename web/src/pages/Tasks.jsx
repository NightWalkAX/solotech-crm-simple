import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Archive, Sparkles, RefreshCw, Brush, Undo2, ThumbsUp, ArrowRight, List } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { PageHeader } from '../components/ui.jsx';
import { ContextButton } from '../components/ActionItems.jsx';

// Tasks: open action_items on a size × age map, for exploring and cleaning without seeing everything at once.
// Size = action_items.effort (quick | medium | big | null), rough on purpose: no minutes or hours anywhere.
// Age = days since created_at. One cell open at a time; "Limpiar" walks them one by one, oldest first.

export const EFFORT = [
  { key: 'quick', label: 'Rápidas', short: 'Rápida', hint: 'un momento: responder, llamar, confirmar' },
  { key: 'medium', label: 'Un rato', short: 'Un rato', hint: 'una sentada tranquila' },
  { key: 'big', label: 'Bloque grande', short: 'Grande', hint: 'una sesión larga o varias' },
  { key: 'none', label: 'Sin estimar', hint: 'aún sin tamaño' },
];
const AGE = [
  { key: 'new', label: 'Nuevas', max: 3 },
  { key: 'week', label: 'Esta semana', max: 7 },
  { key: 'weeks', label: 'Unas semanas', max: 30 },
  { key: 'old', label: 'Viejas', max: Infinity },
];

const utc = ts => Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
const daysOld = a => Math.max(0, Math.floor((Date.now() - utc(a.created_at)) / 86400e3));
const ageKey = a => AGE.find(g => daysOld(a) <= g.max).key;
const effortKey = a => a.effort || 'none';
const agoText = d => (d === 0 ? 'de hoy' : d === 1 ? 'de ayer' : d < 7 ? 'de hace unos días' : d < 14 ? 'de hace una semana'
  : d < 30 ? 'de hace unas semanas' : d < 60 ? 'de hace un mes' : 'de hace meses');
const reviewedRecently = a => a.reviewed_at && Date.now() - utc(a.reviewed_at) < 7 * 86400e3;

// Softer = fewer. No red, no alarm colours: the amount only changes how warm the tile looks.
const tone = n => (n === 0 ? 'bg-transparent text-slate-300' : n <= 2 ? 'bg-amber/10 text-ink' : n <= 6 ? 'bg-amber/25 text-ink' : 'bg-amber/45 text-ink');

// Last cleanup action, undoable for a few seconds (the chat can also undo it: every PATCH is audited).
function useUndo() {
  const [last, setLast] = useState(null);
  useEffect(() => { if (!last) return undefined; const t = setTimeout(() => setLast(null), 8000); return () => clearTimeout(t); }, [last]);
  const apply = useMutate(({ a, patch }) => api.patch(`/actions/${a.id}`, patch));
  const run = (a, patch, label) => apply.mutate({ a, patch }, {
    onSuccess: () => setLast({ a, label, back: Object.fromEntries(Object.keys(patch).map(k => [k, a[k] ?? null])) }),
  });
  const undo = () => { apply.mutate({ a: last.a, patch: last.back }); setLast(null); };
  return { run, last, undo };
}

function SizePills({ a, run }) {
  return (
    <div className="flex gap-1">
      {EFFORT.slice(0, 3).map(e => (
        <button key={e.key} title={e.hint}
          className={`rounded-full px-2.5 py-0.5 text-xs ${a.effort === e.key ? 'bg-ink text-white' : 'text-slate-400 ring-1 ring-slate-200 hover:text-ink'}`}
          onClick={() => a.effort !== e.key && run(a, { effort: e.key }, `Ahora es "${e.short}"`)}>{e.short}</button>
      ))}
    </div>
  );
}

function TaskCard({ a, run }) {
  return (
    <div className="group rounded-xl bg-white px-5 py-4 ring-1 ring-slate-200">
      <div className="text-[15px] leading-snug text-ink">{a.title}</div>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-400">
        {a.company && <Link to={`/clients/${a.client_id}`} className="hover:text-ink">{a.company}</Link>}
        <span>{agoText(daysOld(a))}</span>
      </div>
      {a.notes && <p className="mt-2 line-clamp-2 whitespace-pre-line text-sm text-slate-500">{a.notes}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SizePills a={a} run={run} />
        <span className="flex-1" />
        <ContextButton a={a} label="Contexto" className="flex items-center gap-1 rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100" />
        <button className="flex items-center gap-1 rounded-full px-3 py-1 text-xs text-slate-500 hover:bg-slate-100"
          onClick={() => run(a, { status: 'dropped' }, 'Marcada como "ya no aplica"')}><Archive size={13} /> Ya no aplica</button>
        <button className="flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs text-white hover:bg-ink/90"
          onClick={() => run(a, { status: 'done' }, 'Hecha')}><Check size={13} /> Hecha</button>
      </div>
    </div>
  );
}

// One task at a time, oldest first; tasks marked "sigue en pie" in the last 7 days are left out.
function Cleanup({ tasks, run, onClose }) {
  const [ids] = useState(() => tasks.filter(a => !reviewedRecently(a)).sort((x, y) => utc(x.created_at) - utc(y.created_at)).map(a => a.id));
  const [i, setI] = useState(0);
  const byId = new Map(tasks.map(a => [a.id, a]));
  const a = byId.get(ids[i]);
  useEffect(() => { if (i < ids.length && !a) setI(n => n + 1); }, [a, i, ids.length]);
  const next = () => setI(n => n + 1);
  const act = (patch, label) => { run(a, patch, label); next(); };
  const left = ids.slice(i).filter(id => byId.has(id)).length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white px-8 py-9 shadow-xl" onMouseDown={e => e.stopPropagation()}>
        {a ? (
          <>
            <div className="mb-3 flex justify-between text-xs text-slate-400">
              <span>{agoText(daysOld(a))}</span>
              <span>{left === 1 ? 'la última' : `quedan ${left}`}</span>
            </div>
            <div className="text-xl font-medium leading-snug text-ink">{a.title}</div>
            {a.company && <div className="mt-1 text-sm text-slate-500">{a.company}</div>}
            {a.notes && <p className="mt-3 line-clamp-4 whitespace-pre-line text-sm text-slate-500">{a.notes}</p>}
            <div className="mt-5"><div className="mb-1.5 text-xs text-slate-400">¿De qué tamaño es?</div><SizePills a={a} run={run} /></div>
            <div className="mt-7 grid grid-cols-2 gap-2">
              <button className="flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm text-white hover:bg-ink/90"
                onClick={() => act({ status: 'done' }, 'Hecha')}><Check size={15} /> Ya la hice</button>
              <button className="flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                onClick={() => act({ status: 'dropped' }, 'Marcada como "ya no aplica"')}><Archive size={15} /> Ya no aplica</button>
              <button className="flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                onClick={() => act({ reviewed_at: new Date().toISOString() }, 'Sigue en pie')}><ThumbsUp size={15} /> Sigue en pie</button>
              <button className="flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-50"
                onClick={next}><ArrowRight size={15} /> No sé, después</button>
            </div>
            <div className="mt-6 text-center"><button className="text-xs text-slate-400 hover:text-ink" onClick={onClose}>Terminar por ahora</button></div>
          </>
        ) : (
          <div className="py-4 text-center">
            <Sparkles className="mx-auto text-amber" size={28} />
            <div className="mt-3 text-lg font-medium text-ink">Listo, repaso terminado.</div>
            <p className="mt-1 text-sm text-slate-500">Lo que queda sigue en pie.</p>
            <button className="mt-6 rounded-full bg-ink px-5 py-2 text-sm text-white" onClick={onClose}>Cerrar</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Tasks() {
  const { data: all = [] } = useApi('/actions?status=open');
  const [sel, setSel] = useState(null); // { effort, age }; either may be 'any'
  const [showAll, setShowAll] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const { run, last, undo } = useUndo();
  const estimate = useMutate(() => api.post('/actions/estimate'));
  useEffect(() => { setShowAll(false); }, [sel]);

  const tasks = all;
  const count = (e, g) => tasks.filter(a => (e === 'any' || effortKey(a) === e) && (g === 'any' || ageKey(a) === g)).length;
  const rows = EFFORT.filter(e => e.key !== 'none' || count('none', 'any') > 0);
  const selected = sel ? tasks.filter(a => (sel.effort === 'any' || effortKey(a) === sel.effort) && (sel.age === 'any' || ageKey(a) === sel.age))
    .sort((x, y) => utc(x.created_at) - utc(y.created_at)) : [];
  const visible = showAll ? selected : selected.slice(0, 5);
  // Starting point: the oldest quick ones clear fastest.
  const suggestion = [...AGE].reverse().map(g => ({ effort: 'quick', age: g.key })).find(s => count(s.effort, s.age) > 0);
  const unsized = count('none', 'any');
  const isSel = (e, g) => sel?.effort === e && sel?.age === g;
  const pick = (e, g) => setSel(isSel(e, g) ? null : { effort: e, age: g });
  const selLabel = sel && [sel.effort !== 'any' && EFFORT.find(e => e.key === sel.effort).label, sel.age !== 'any' && AGE.find(g => g.key === sel.age).label.toLowerCase()].filter(Boolean).join(' · ');

  return (
    <div className="min-h-full bg-slate-50">
      <PageHeader title="Tasks">
        <button className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-1.5 text-xs text-white hover:bg-ink/90" disabled={!tasks.length}
          onClick={() => setCleaning(true)}><Brush size={13} /> Limpiar{sel ? ' esta selección' : ''}</button>
        <Link to="/actions" title="Lista completa (hechas, nuevas, fechas)" className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"><List size={16} /></Link>
      </PageHeader>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="mb-4 text-sm text-slate-500">Elige un cuadro para ver solo esas tareas. Lo demás puede esperar.</p>
        <div className="grid grid-cols-[9.5rem_repeat(4,1fr)] gap-1.5 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div />
          {AGE.map(g => (
            <button key={g.key} className={`rounded-md py-1 text-xs ${isSel('any', g.key) ? 'bg-slate-100 text-ink' : 'text-slate-400 hover:text-ink'}`}
              onClick={() => pick('any', g.key)}>{g.label}</button>
          ))}
          {rows.map(e => (
            <div key={e.key} className="contents">
              <button className={`rounded-md px-2 py-2 text-left ${isSel(e.key, 'any') ? 'bg-slate-100' : 'hover:bg-slate-50'}`} onClick={() => pick(e.key, 'any')}>
                <div className="text-sm text-ink">{e.label}</div>
                <div className="text-[11px] leading-tight text-slate-400">{e.hint}</div>
              </button>
              {AGE.map(g => {
                const n = count(e.key, g.key);
                return (
                  <button key={g.key} disabled={!n} onClick={() => pick(e.key, g.key)}
                    className={`rounded-xl text-lg font-medium transition ${tone(n)} ${isSel(e.key, g.key) ? 'ring-2 ring-ink' : n ? 'hover:ring-1 hover:ring-slate-300' : ''}`}>
                    {n || '·'}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {unsized > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span>{unsized === 1 ? 'Una tarea sin tamaño.' : `${unsized} tareas sin tamaño.`}</span>
            <button className="flex items-center gap-1 rounded-full px-2.5 py-1 text-slate-600 ring-1 ring-slate-200 hover:bg-white disabled:opacity-60"
              disabled={estimate.isPending} onClick={() => estimate.mutate()}>
              {estimate.isPending ? <><RefreshCw size={12} className="animate-spin" /> Estimando…</> : <><Sparkles size={12} /> Estimar con IA</>}
            </button>
            {estimate.error && <span>No se pudo: {estimate.error.message}</span>}
          </div>
        )}

        <div className="mt-8">
          {!sel && (tasks.length ? (
            <div className="rounded-2xl bg-white px-6 py-6 text-sm text-slate-600 ring-1 ring-slate-200">
              {suggestion ? (
                <>¿No sabes por dónde empezar? Las <b className="text-ink">rápidas más viejas</b> se despachan solas.
                  <button className="ml-2 inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline" onClick={() => setSel(suggestion)}>
                    Verlas <ArrowRight size={13} /></button></>
              ) : 'Elige un cuadro de arriba para empezar.'}
            </div>
          ) : (
            <div className="rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-slate-200">
              <Sparkles className="mx-auto text-amber" size={26} />
              <div className="mt-2 text-ink">No hay tareas abiertas aquí.</div>
            </div>
          ))}
          {sel && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-ink">{selLabel}</div>
                <button className="text-xs text-slate-400 hover:text-ink" onClick={() => setSel(null)}>Cerrar</button>
              </div>
              <div className="space-y-2">{visible.map(a => <TaskCard key={a.id} a={a} run={run} />)}</div>
              {!selected.length && <p className="text-sm text-slate-400">Ya no queda nada en este cuadro.</p>}
              {selected.length > visible.length && (
                <button className="mt-3 text-xs text-slate-400 hover:text-ink" onClick={() => setShowAll(true)}>
                  {selected.length - visible.length} más en este cuadro
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {last && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-5 py-2.5 text-sm text-white shadow-lg">
          {last.label}
          <button className="flex items-center gap-1 text-amber hover:underline" onClick={undo}><Undo2 size={14} /> Deshacer</button>
        </div>
      )}
      {cleaning && <Cleanup tasks={selected.length ? selected : tasks} run={run} onClose={() => setCleaning(false)} />}
    </div>
  );
}
