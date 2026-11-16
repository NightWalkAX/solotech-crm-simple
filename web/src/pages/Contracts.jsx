import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Plus, FileText, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';
import { date } from '../lib/format.js';
import { PageHeader, Modal } from '../components/ui.jsx';

const KIND = { contract: 'Contrato', agreement: 'Acuerdo', sow: 'Scope of Work' };
const ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png,.docx';
const today = () => new Date().toLocaleDateString('en-CA');

function ContractForm({ contract, clientId, onDone }) {
  const { data: clients = [] } = useApi('/clients');
  const save = useMutate(async ({ body, file }) => {
    const k = contract ? await api.patch(`/contracts/${contract.id}`, body) : await api.post('/contracts', body);
    if (file) await api.upload(`/contracts/${k.id}/file`, file);
  });
  const [f, setF] = useState({
    title: contract?.title ?? '', kind: contract?.kind ?? 'contract', client_id: contract?.client_id ?? clientId ?? '',
    counterparty: contract?.counterparty ?? '', signed_on: contract?.signed_on ?? today(), ends_on: contract?.ends_on ?? '', notes: contract?.notes ?? '',
  });
  const [file, setFile] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = e => {
    e.preventDefault();
    save.mutate({ body: { ...f, client_id: f.client_id ? Number(f.client_id) : null, ends_on: f.ends_on || null, signed_on: f.signed_on || null }, file }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-4 gap-3">
      <div className="col-span-3"><label className="label">Título</label><input className="input" required autoFocus value={f.title} onChange={set('title')} placeholder="Ej. Website development agreement" /></div>
      <div><label className="label">Tipo</label>
        <select className="input" value={f.kind} onChange={set('kind')}><option value="contract">Contrato</option><option value="agreement">Acuerdo</option><option value="sow">Scope of Work</option></select>
      </div>
      <div className="col-span-2"><label className="label">Cliente</label>
        <select className="input" value={f.client_id} onChange={set('client_id')}>
          <option value="">— (no es cliente)</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className="label">Otra parte</label><input className="input" value={f.counterparty} onChange={set('counterparty')} placeholder="Proveedor, socio…" /></div>
      <div className="col-span-2"><label className="label">Firmado el</label><input className="input" type="date" value={f.signed_on} onChange={set('signed_on')} /></div>
      <div className="col-span-2"><label className="label">Vence</label><input className="input" type="date" value={f.ends_on} onChange={set('ends_on')} /></div>
      <div className="col-span-4"><label className="label">Notas</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
      <div className="col-span-4">
        <label className="label">Archivo firmado (PDF, JPG, PNG o DOCX){contract?.file_name ? ` · actual: ${contract.file_name}` : ''}</label>
        <input className="input" type="file" accept={ACCEPT} onChange={e => setFile(e.target.files[0] ?? null)} />
      </div>
      <div className="col-span-4 flex items-center justify-between">
        <span className="text-sm text-red-600">{save.error?.message}</span>
        <button className="btn-primary" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  );
}

function FileLink({ k }) {
  const upload = useMutate(file => api.upload(`/contracts/${k.id}/file`, file));
  if (k.file_path) return (
    <a className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline" href={`/api/contracts/${k.id}/file`} target="_blank" rel="noreferrer" title={k.file_name}>
      <FileText size={12} /> Ver
    </a>
  );
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1 text-xs ${upload.error ? 'text-red-600' : 'text-slate-400 hover:text-ink'}`} title={upload.error?.message ?? 'Subir archivo firmado'}>
      <Paperclip size={12} /> {upload.isPending ? 'Subiendo…' : upload.error ? 'Error' : 'Subir'}
      <input type="file" accept={ACCEPT} className="hidden" disabled={upload.isPending}
        onChange={ev => { const file = ev.target.files[0]; ev.target.value = ''; file && upload.mutate(file); }} />
    </label>
  );
}

export function ContractTable({ contracts, showClient = true }) {
  const [edit, setEdit] = useState(null);
  const del = useMutate(id => api.del(`/contracts/${id}`));
  if (!contracts.length) return <p className="px-4 py-3 text-sm text-slate-400">Sin contratos ni acuerdos.</p>;
  return (
    <>
      <table className="w-full text-sm [&_td]:px-3 [&_th]:px-3">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr><th className="px-4 py-2">Título</th>{showClient && <th>Parte</th>}<th>Firmado</th><th>Vence</th><th>Archivo</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contracts.map(k => {
            const expired = k.ends_on && k.ends_on < today();
            return (
              <tr key={k.id} className="group">
                <td className="px-4 py-2"><b>{k.title}</b><div className="text-xs text-slate-500">{KIND[k.kind] ?? k.kind}{k.notes ? ` · ${k.notes}` : ''}</div></td>
                {showClient && <td>{k.client_id ? <Link className="hover:text-brand" to={`/clients/${k.client_id}`}>{k.company}</Link> : k.counterparty}
                  {k.client_id && k.counterparty && <div className="text-xs text-slate-500">{k.counterparty}</div>}</td>}
                <td className="whitespace-nowrap">{k.signed_on ? date(k.signed_on) : k.kind === 'sow' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Pendiente firma cliente</span> : ''}</td>
                <td className={`whitespace-nowrap ${expired ? 'text-red-600' : ''}`}>{k.ends_on ? date(k.ends_on) : '—'}</td>
                <td><FileLink k={k} /></td>
                <td className="whitespace-nowrap pr-3 text-right">
                  <button className="invisible text-slate-400 hover:text-ink group-hover:visible" title="Editar" onClick={() => setEdit(k)}><Pencil size={13} /></button>
                  <button className="invisible ml-2 text-slate-400 hover:text-red-600 group-hover:visible" title="Eliminar"
                    onClick={() => confirm(`¿Eliminar "${k.title}"?`) && del.mutate(k.id)}><Trash2 size={13} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {edit && <Modal title={`Editar ${edit.title}`} onClose={() => setEdit(null)}><ContractForm contract={edit} onDone={() => setEdit(null)} /></Modal>}
    </>
  );
}

export function NewContractButton({ clientId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={14} /> Subir contrato</button>
      {open && <Modal title="Nuevo contrato / acuerdo" onClose={() => setOpen(false)}><ContractForm clientId={clientId} onDone={() => setOpen(false)} /></Modal>}
    </>
  );
}

export default function Contracts() {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const { data: all = [] } = useApi('/contracts');
  const term = q.trim().toLowerCase();
  const rows = all.filter(k => (!kind || k.kind === kind)
    && (!term || [k.title, k.company, k.counterparty, k.notes].some(v => v?.toLowerCase().includes(term))));
  return (
    <>
      <PageHeader title="Contratos y Acuerdos">
        <input className="input w-56" placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input w-36" value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">Todos</option><option value="contract">Contratos</option><option value="agreement">Acuerdos</option><option value="sow">Scope of Work</option>
        </select>
        <NewContractButton />
      </PageHeader>
      <div className="p-6"><div className="card"><ContractTable contracts={rows} /></div></div>
    </>
  );
}
