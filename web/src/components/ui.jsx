import { Flame, Snowflake, Sun, BadgeCheck, Handshake } from 'lucide-react';

const TEMP = {
  hot: { label: 'Caliente', cls: 'bg-red-50 text-red-700 ring-red-200', icon: Flame },
  warm: { label: 'Tibio', cls: 'bg-amber-50 text-amber-700 ring-amber-200', icon: Sun },
  cold: { label: 'Frío', cls: 'bg-sky-50 text-sky-700 ring-sky-200', icon: Snowflake },
  client: { label: 'Cliente', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', icon: BadgeCheck },
  fixed: { label: 'Cliente fijo', cls: 'bg-violet-50 text-violet-700 ring-violet-200', icon: Handshake },
};

export function TempBadge({ temp, manual, reason }) {
  const t = TEMP[temp] ?? TEMP.cold;
  const Icon = t.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${t.cls}`} title={manual ? 'Fijada a mano' : reason ? `Automática: ${reason}` : 'Automática'}>
      <Icon size={12} /> {t.label}{manual ? ' •' : ''}
    </span>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Section({ title, count, children, empty = 'Nada aquí.' }) {
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {count != null && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{count}</span>}
      </header>
      <div className="divide-y divide-slate-100">{count === 0 ? <p className="px-4 py-3 text-sm text-slate-400">{empty}</p> : children}</div>
    </section>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6" onMouseDown={onClose}>
      <div className="card w-full max-w-2xl shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
