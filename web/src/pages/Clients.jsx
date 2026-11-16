import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { money, ago } from '../lib/format.js';
import { PageHeader, TempBadge, Modal } from '../components/ui.jsx';
import ClientForm from '../components/ClientForm.jsx';

export default function Clients() {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const { data: meta } = useApi('/meta');
  const { data: clients = [] } = useApi(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`, { placeholderData: p => p });
  const create = useMutate(body => api.post('/clients', body));
  const stageLabel = k => meta?.stages.find(s => s.key === k)?.label ?? k;
  return (
    <>
      <PageHeader title="Clientes y prospectos">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input className="input w-64 pl-8" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Nuevo</button>
      </PageHeader>
      <div className="p-6">
        <table className="card w-full overflow-hidden text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Empresa</th><th>Etapa</th><th>Temp.</th><th>Contacto</th><th>Último contacto</th><th>Tareas</th><th className="pr-4 text-right">Saldo / Estimado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.map(c => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/clients/${c.id}`)}>
                <td className="px-4 py-2.5">
                  <Link to={`/clients/${c.id}`} className="font-medium text-ink">{c.company}</Link>
                  <div className="text-xs text-slate-500">{c.sector || c.website_url}</div>
                </td>
                <td>{stageLabel(c.stage)}</td>
                <td><TempBadge temp={c.temp} manual={!!c.temperature} reason={c.lead_reason} /></td>
                <td className="text-xs text-slate-600">{c.contact_name}<div>{c.whatsapp || c.phone}</div></td>
                <td className="text-slate-600">{ago(c.last_contact_at)}</td>
                <td>{c.open_actions || ''}</td>
                <td className="pr-4 text-right">
                  {c.balance > 0 ? <span className="text-red-600">{money(c.balance)}</span> : c.est_price ? <span className="text-slate-500">{money(c.est_price, c.est_currency)}</span> : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && (
        <Modal title="Nuevo cliente / prospecto" onClose={() => setCreating(false)}>
          <ClientForm submitting={create.isPending} submitLabel="Crear"
            onSubmit={body => create.mutate(body, { onSuccess: c => { setCreating(false); nav(`/clients/${c.id}`); } })} />
        </Modal>
      )}
    </>
  );
}
