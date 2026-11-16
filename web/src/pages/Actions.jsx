import { useState } from 'react';
import { useApi } from '../lib/api.js';
import { PageHeader, Section } from '../components/ui.jsx';
import { ActionRow, ActionForm } from '../components/ActionItems.jsx';

export default function Actions() {
  const [status, setStatus] = useState('open');
  const { data: actions = [] } = useApi(`/actions${status ? `?status=${status}` : ''}`);
  const { data: clients } = useApi('/clients');
  return (
    <>
      <PageHeader title="Tareas, seguimientos y entregas">
        <select className="input w-36" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="open">Abiertas</option><option value="done">Hechas</option><option value="dropped">Ya no aplican</option><option value="">Todas</option>
        </select>
      </PageHeader>
      <div className="p-6">
        <Section title="Lista" count={actions.length}>
          <ActionForm clients={clients} />
          {actions.map(a => <ActionRow key={a.id} a={a} />)}
        </Section>
      </div>
    </>
  );
}
