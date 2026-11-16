import { Link } from 'react-router-dom';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, ago } from '../lib/format.js';
import { PageHeader, TempBadge } from '../components/ui.jsx';

export default function Pipeline() {
  const { data: meta } = useApi('/meta');
  const { data: clients = [] } = useApi('/clients');
  const [over, setOver] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const move = useMutate(({ id, stage }) => api.patch(`/clients/${id}`, { stage }));
  if (!meta) return null;
  const stages = meta.stages.filter(s => showClosed || !['lost', 'discarded'].includes(s.key));
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Pipeline">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Mostrar perdidos/descartados
        </label>
      </PageHeader>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {stages.map(s => {
          const cards = clients.filter(c => c.stage === s.key);
          return (
            <div key={s.key}
              className={`flex w-64 shrink-0 flex-col rounded-lg bg-slate-100 ${over === s.key ? 'ring-2 ring-brand' : ''}`}
              onDragOver={e => { e.preventDefault(); setOver(s.key); }}
              onDragLeave={() => setOver(null)}
              onDrop={e => {
                e.preventDefault();
                setOver(null);
                const id = Number(e.dataTransfer.getData('text/plain'));
                const c = clients.find(x => x.id === id);
                if (c && c.stage !== s.key) move.mutate({ id, stage: s.key });
              }}>
              <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {s.label} <span className="rounded-full bg-white px-2 text-slate-500">{cards.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                {cards.map(c => (
                  <div key={c.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', String(c.id))}
                    className="card cursor-grab p-3 shadow-sm active:cursor-grabbing">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/clients/${c.id}`} className="text-sm font-medium text-ink hover:text-brand">{c.company}</Link>
                      {c.demo_url && <a href={c.demo_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-brand" title="Demo"><ExternalLink size={14} /></a>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <TempBadge temp={c.temp} manual={!!c.temperature} reason={c.lead_reason} />
                      {c.verdict && <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{c.verdict} {c.site_score}</span>}
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-slate-500">
                      <span>{c.est_price ? money(c.est_price, c.est_currency) : ''}</span>
                      <span>{ago(c.last_contact_at)}</span>
                    </div>
                    {c.open_actions > 0 && <div className="mt-1 text-xs text-amber-700">{c.open_actions} tarea(s) abierta(s)</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
