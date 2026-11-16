import { useState } from 'react';
import { Upload } from 'lucide-react';
import { api, useMutate } from '../lib/api.js';
import { phone as fmtPhone } from '../lib/format.js';
import { unzip } from '../lib/unzip.js';
import { Modal } from './ui.jsx';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Read a .txt or the .zip WhatsApp produces; returns the chat text, a number guess and a day/month hint. */
async function readExport(file) {
  let text = '', md = '';
  if (/\.zip$/i.test(file.name)) {
    const entries = (await unzip(file)).filter(e => !e.name.startsWith('__MACOSX'));
    const txt = entries.find(e => /\.txt$/i.test(e.name));
    if (!txt) throw new Error('El .zip no trae el chat en .txt');
    text = new TextDecoder().decode(await txt.read());
    const mdEntry = entries.find(e => /\.md$/i.test(e.name));
    if (mdEntry) md = new TextDecoder().decode(await mdEntry.read());
  } else {
    text = await file.text();
  }
  // Number: "+592 555 0123.zip", "WhatsApp Chat with +592 555 0123.txt" or the chat.md title.
  const candidates = [md.match(/^# .*?:\s*(.+)$/m)?.[1], file.name.replace(/\.(zip|txt)$/i, '').replace(/^WhatsApp Chat (with|con) /i, '')];
  const number = candidates.map(c => (c || '').trim()).find(c => /^\+?[\d\s()-]{7,}$/.test(c)) || '';
  // chat.md has "## October 3, 2026" headings: compare with the first "[10/3/26" stamp to know the order.
  let dayFirst;
  const heading = md.match(/^## (\w+) (\d{1,2}), \d{4}$/m);
  const stamp = text.match(/^\[?(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}/m);
  if (heading && stamp) {
    const month = MONTHS.indexOf(heading[1].toLowerCase()) + 1;
    if (month && Number(stamp[1]) === month && Number(stamp[2]) === Number(heading[2])) dayFirst = false;
    else if (month && Number(stamp[2]) === month) dayFirst = true;
  }
  return { text, number, dayFirst };
}

/** Import a WhatsApp "Export chat" (.zip or .txt) into a client's conversation, or by number from the Inbox. */
export default function WhatsAppImport({ clientId, onClose }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [number, setNumber] = useState('');
  const [preview, setPreview] = useState(null);
  const [me, setMe] = useState('');
  const [dayFirst, setDayFirst] = useState(true);
  const imp = useMutate(body => api.post('/messages/import/whatsapp', body));

  const refresh = async (f, opts) => {
    const p = await api.post('/messages/import/whatsapp/preview', { text: f.text, phone: clientId ? undefined : opts.number, dayFirst: opts.dayFirst });
    setPreview(p);
    setDayFirst(p.dayFirst);
    return p;
  };
  const load = async raw => {
    setError(null); setPreview(null); imp.reset();
    try {
      const f = await readExport(raw);
      setFile(f);
      setNumber(f.number);
      const p = await refresh(f, { number: f.number, dayFirst: f.dayFirst ?? true });
      setMe(p.senders.find(s => /^(you|tú|yo)$|jose|solo ?tech/i.test(s.name))?.name ?? '');
    } catch (e) { setError(e.message); }
  };
  const canImport = file && preview?.senders.length && me && (clientId || number.replace(/\D/g, '').length >= 7);

  return (
    <Modal title="Importar chat exportado de WhatsApp" onClose={onClose}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>En el teléfono abre el chat → ⋮ → Más → <b>Exportar chat</b> → <b>Sin archivos</b>.</li>
        <li>Pasa el .zip (o el .txt) a la PC y súbelo aquí. Importar dos veces no duplica.</li>
      </ol>
      <input type="file" accept=".zip,.txt" className="text-sm" onChange={e => e.target.files[0] && load(e.target.files[0])} />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {file && preview && (
        <div className="mt-4 space-y-3">
          {!clientId && (
            <div>
              <label className="label">Número del chat</label>
              <input className="input" placeholder="+592 555 0123" value={number} onChange={e => setNumber(e.target.value)}
                onBlur={() => refresh(file, { number, dayFirst })} />
              <p className="mt-1 text-xs text-slate-500">
                {preview.client ? <>Se asigna a <b>{preview.client.company}</b>.</> : number ? 'Ningún cliente tiene este número: quedará en Sin asignar.' : 'No pude leer el número del nombre del archivo; escríbelo.'}
              </p>
            </div>
          )}
          {!preview.senders.length ? (
            <p className="text-sm text-amber-700">Este chat no trae mensajes, solo avisos del sistema (cifrado, mensajes temporales…). Si el chat tenía mensajes temporales activados, WhatsApp ya los borró y no salen en la exportación.</p>
          ) : (
            <>
              <div>
                <label className="label">¿Cuál de estos eres tú?</label>
                <select className="input" value={me} onChange={e => setMe(e.target.value)}>
                  <option value="">—</option>
                  {preview.senders.map(s => <option key={s.name} value={s.name}>{s.name} ({s.count} mensajes)</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={dayFirst} onChange={e => { setDayFirst(e.target.checked); refresh(file, { number, dayFirst: e.target.checked }); }} />
                Fechas en formato día/mes (desmarca si tu teléfono usa mes/día)
              </label>
            </>
          )}
          {imp.error && <p className="text-sm text-red-600">{imp.error.message}</p>}
          {imp.data ? <p className="text-sm text-emerald-700">Listo: {imp.data.added} mensajes nuevos{!clientId && !imp.data.client_id ? ` en Sin asignar (${fmtPhone(number)})` : ''}.</p> : (
            <button className="btn-primary" disabled={!canImport || imp.isPending}
              onClick={() => imp.mutate({ text: file.text, client_id: clientId, phone: clientId ? undefined : number, me, dayFirst })}>
              <Upload size={14} /> {imp.isPending ? 'Importando…' : 'Importar'}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
