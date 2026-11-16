import { useState } from 'react';
import { useApi } from '../lib/api.js';

const FIELDS = [
  ['company', 'Empresa', 'text', true],
  ['contact_name', 'Contacto'],
  ['whatsapp', 'WhatsApp'],
  ['phone', 'Teléfono'],
  ['email', 'Correo', 'email'],
  ['address', 'Dirección'],
  ['website_url', 'Página web', 'url'],
  ['facebook_url', 'Facebook', 'url'],
  ['sector', 'Sector'],
];

export const SOURCES = {
  referral: 'Referido', facebook_ads: 'Facebook / Instagram', website_form: 'Formulario web',
  event: 'Evento / networking', walk_in: 'Llegó directo', other: 'Otro',
};

export default function ClientForm({ initial = {}, onSubmit, submitting, submitLabel = 'Guardar' }) {
  const { data: meta } = useApi('/meta');
  const { data: clients = [] } = useApi('/clients');
  const [f, setF] = useState({
    stage: 'evaluated', source: 'referral', ...initial,
    pain_points_text: (initial.pain_points || []).join('\n'),
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const submit = e => {
    e.preventDefault();
    const { pain_points_text, temperature_auto, temp, last_contact_at, last_in_at, open_actions, next_due, balance, ...rest } = f;
    onSubmit({
      ...rest,
      referrer_id: rest.referrer_id ? Number(rest.referrer_id) : null,
      temperature: rest.temperature || null,
      pain_points: pain_points_text.split('\n').map(s => s.trim()).filter(Boolean),
    });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      {FIELDS.map(([k, label, type = 'text', required]) => (
        <div key={k}>
          <label className="label">{label}</label>
          <input className="input" type={type} required={required} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />
        </div>
      ))}
      <div>
        <label className="label">Etapa</label>
        <select className="input" value={f.stage} onChange={e => set('stage', e.target.value)}>
          {meta?.stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Temperatura</label>
        <select className="input" value={f.temperature ?? ''} onChange={e => set('temperature', e.target.value)}>
          <option value="">Automática</option>
          <option value="hot">Caliente</option>
          <option value="warm">Tibio</option>
          <option value="cold">Frío</option>
          <option value="fixed">Cliente fijo</option>
        </select>
      </div>
      <div>
        <label className="label">Origen</label>
        <select className="input" value={f.source ?? ''} onChange={e => set('source', e.target.value)}>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Referido por</label>
        <select className="input" value={f.referrer_id ?? ''} onChange={e => set('referrer_id', e.target.value)}>
          <option value="">—</option>
          {clients.filter(c => c.id !== f.id).map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
      </div>
      <div className="col-span-2">
        <label className="label">Caracterización</label>
        <textarea className="input" rows={2} value={f.characterization ?? ''} onChange={e => set('characterization', e.target.value)} />
      </div>
      <div className="col-span-2">
        <label className="label">Pain points (uno por línea)</label>
        <textarea className="input" rows={4} value={f.pain_points_text} onChange={e => set('pain_points_text', e.target.value)} />
      </div>
      <div className="col-span-2">
        <label className="label">Notas</label>
        <textarea className="input" rows={2} value={f.notes ?? ''} onChange={e => set('notes', e.target.value)} />
      </div>
      <div className="col-span-2 flex justify-end">
        <button className="btn-primary" disabled={submitting}>{submitLabel}</button>
      </div>
    </form>
  );
}
