import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Plug, Inbox as InboxIcon, CalendarCheck, Columns3, Users, ListTodo, FileText, MessageSquare, Wallet, FileSignature, Scale, Lightbulb, AlarmClock, Landmark, Sunrise } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLiveUpdates } from './lib/live.js';
import Today from './pages/Today.jsx';
import MyDay from './pages/MyDay.jsx';
import Pipeline from './pages/Pipeline.jsx';
import Clients from './pages/Clients.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import Actions from './pages/Actions.jsx';
import Tasks from './pages/Tasks.jsx';
import Documents from './pages/Documents.jsx';
import Inbox from './pages/Inbox.jsx';
import Settings from './pages/Settings.jsx';
import Finance from './pages/Finance.jsx';
import Contracts from './pages/Contracts.jsx';
import Debts from './pages/Debts.jsx';
import Taxes from './pages/Taxes.jsx';
import Notes from './pages/Notes.jsx';
import Jobs from './pages/Jobs.jsx';
import { useApi } from './lib/api.js';
import ChatPanel from './components/ChatPanel.jsx';

const NAV = [
  { to: '/', label: 'Hoy', icon: CalendarCheck, end: true },
  { to: '/mi-dia', label: 'Mi Día', icon: Sunrise },
  { to: '/inbox', label: 'Bandeja', icon: InboxIcon, badge: true },
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/documents', label: 'Documentos', icon: FileText },
  { to: '/contracts', label: 'Contratos y Acuerdos', icon: FileSignature },
  { to: '/finance', label: 'Finanzas', icon: Wallet },
  { to: '/taxes', label: 'Impuestos', icon: Landmark },
  { to: '/debts', label: 'Deudas', icon: Scale },
  { to: '/notes', label: 'Notas', icon: Lightbulb },
  { to: '/jobs', label: 'Programados', icon: AlarmClock },
  { to: '/settings', label: 'Integraciones', icon: Plug },
];

export default function App() {
  const online = useLiveUpdates();
  const [chatOpen, setChatOpen] = useState(true);
  const { data: threads = [] } = useApi('/inbox');
  const unread = threads.reduce((n, t) => n + (t.unread || 0), 0);
  const loc = useLocation();
  const navigate = useNavigate();
  const { data: meta } = useApi('/meta');
  const brand = meta?.issuer?.name || 'Mi negocio';
  useEffect(() => { document.title = `${brand} · CRM`; }, [brand]);
  // Notification clicks (web/public/sw.js) navigate this window in place; ?chat=ID opens that chat in the panel.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMsg = e => e.data?.type === 'navigate' && navigate(e.data.url);
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [navigate]);
  useEffect(() => { if (new URLSearchParams(loc.search).has('chat')) setChatOpen(true); }, [loc.search]);
  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col bg-ink text-slate-300">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/favicon.png" className="h-7 w-7" alt="" />
          <div className="min-w-0 truncate font-semibold text-white" title={brand}>{brand} <span className="text-amber">CRM</span></div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5'}`}>
              <Icon size={16} /> {label}
              {badge && unread > 0 && <span className="ml-auto rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between px-4 py-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {online ? 'En vivo' : 'Sin conexión'}
          </span>
          <button className="flex items-center gap-1 hover:text-white" onClick={() => setChatOpen(o => !o)}>
            <MessageSquare size={14} /> Chat
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/mi-dia" element={<MyDay />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/debts" element={<Debts />} />
        </Routes>
      </main>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </div>
  );
}
