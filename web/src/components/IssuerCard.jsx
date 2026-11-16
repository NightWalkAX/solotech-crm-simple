import { useEffect, useRef, useState } from 'react';
import { PenLine, Upload, Eraser } from 'lucide-react';
import { api, useApi, useMutate } from '../lib/api.js';

// Emisor y firma: issuer data printed on every PDF + the owner's signature (settings.issuer, PUT /api/issuer).
const FIELDS = [
  ['name', 'Empresa'], ['tin', 'TIN'], ['address', 'Dirección'], ['phone', 'Teléfono'], ['email', 'Correo'],
  ['signer_name', 'Firmante (nombre)'], ['signer_title', 'Cargo'], ['footer', 'Pie de página'],
];

/** Light pixels → transparent, then crop to the ink so a photo of a signature on paper prints clean. */
function cleanSignature(img) {
  const c = document.createElement('canvas');
  const scale = Math.min(1, 800 / img.width);
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    if (d.data[i + 3] < 30 || lum > 170) { d.data[i + 3] = 0; continue; }
    d.data[i + 3] = Math.min(255, Math.round((170 - lum) * 3 + 60));
    const p = i / 4, x = p % c.width, y = Math.floor(p / c.width);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;
  g.putImageData(d, 0, 0);
  const pad = 6, out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext('2d').drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function DrawPad({ onDone }) {
  const ref = useRef(null);
  const last = useRef(null);
  useEffect(() => {
    const g = ref.current.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 200);
    g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0b1626';
  }, []);
  const pos = e => {
    const r = ref.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (600 / r.width), (e.clientY - r.top) * (200 / r.height)];
  };
  const move = e => {
    if (!last.current) return;
    const g = ref.current.getContext('2d'), p = pos(e);
    g.beginPath(); g.moveTo(...last.current); g.lineTo(...p); g.stroke();
    last.current = p;
  };
  const clear = () => { const g = ref.current.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 200); };
  return (
    <div className="space-y-2">
      <canvas ref={ref} width={600} height={200} className="w-full touch-none rounded-lg border border-slate-300 bg-white"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); last.current = pos(e); }}
        onPointerMove={move} onPointerUp={() => { last.current = null; }} />
      <div className="flex gap-2">
        <button className="btn-primary text-xs" onClick={() => onDone(cleanSignature(ref.current))}>Usar esta firma</button>
        <button className="btn-ghost text-xs" onClick={clear}><Eraser size={13} /> Borrar</button>
        <button className="btn-ghost text-xs" onClick={() => onDone(undefined)}>Cancelar</button>
      </div>
    </div>
  );
}

export default function IssuerCard() {
  const { data: issuer } = useApi('/issuer');
  const [form, setForm] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const [err, setErr] = useState('');
  const save = useMutate(body => api.put('/issuer', body));
  if (!issuer) return null;
  const f = form ?? issuer;
  const set = patch => setForm({ ...f, ...patch });

  const upload = file => {
    if (!file) return;
    setErr('');
    const img = new Image();
    img.onload = () => { const s = cleanSignature(img); s ? set({ signature: s }) : setErr('No encontré trazo en la imagen.'); URL.revokeObjectURL(img.src); };
    img.onerror = () => setErr('No pude leer esa imagen.');
    img.src = URL.createObjectURL(file);
  };

  return (
    <section className="card p-5 lg:col-span-2">
      <div className="mb-3 flex items-center gap-2">
        <PenLine size={18} className="text-brand" />
        <h2 className="font-semibold text-ink">Emisor y firma de documentos</h2>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${issuer.signature ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {issuer.signature ? 'Firma guardada' : 'Sin firma'}
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Estos datos salen en cotizaciones, facturas y recibos. Con firma guardada, las cotizaciones llevan tu lado del bloque
        de firma ya completo y las facturas/recibos una “Authorised signature”. Los PDF ya generados no cambian.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <div key={k}><label className="label">{label}</label>
            <input className="input" value={f[k] ?? ''} onChange={e => set({ [k]: e.target.value })} /></div>
        ))}
      </div>

      <div className="mt-4">
        <label className="label">Firma</label>
        {drawing ? <DrawPad onDone={s => { setDrawing(false); if (s) set({ signature: s }); else if (s === null) setErr('La firma está vacía.'); }} /> : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-20 w-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white">
              {f.signature ? <img src={f.signature} alt="Firma" className="max-h-16 max-w-60" /> : <span className="text-xs text-slate-400">Sin firma</span>}
            </div>
            <label className="btn-ghost cursor-pointer text-xs"><Upload size={13} /> Subir foto/imagen
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} /></label>
            <button className="btn-ghost text-xs" onClick={() => { setErr(''); setDrawing(true); }}><PenLine size={13} /> Dibujar</button>
            {f.signature && <button className="btn-ghost text-xs text-red-600" onClick={() => set({ signature: '' })}>Quitar</button>}
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">Firma en papel blanco con bolígrafo oscuro y súbela; el fondo se quita solo.</p>
        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.sign_all !== false} onChange={e => set({ sign_all: e.target.checked })} />
        Firmar también facturas y recibos
      </label>

      {form && (
        <div className="mt-4 flex gap-2">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(form, { onSuccess: () => setForm(null) })}>Guardar</button>
          <button className="btn-ghost" onClick={() => setForm(null)}>Descartar</button>
        </div>
      )}
      {save.error && <p className="mt-1 text-xs text-red-600">{save.error.message}</p>}
    </section>
  );
}
