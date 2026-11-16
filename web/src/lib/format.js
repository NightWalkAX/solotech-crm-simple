export function money(amount, currency = 'GYD') {
  if (amount == null) return '—';
  const n = Number(amount).toLocaleString('en-US');
  return currency === 'GYD' ? `G$${n}` : `${currency === 'USD' ? 'US$' : currency + ' '}${n}`;
}

export function date(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}

export function ago(ts) {
  if (!ts) return 'nunca';
  const t = new Date(ts.length <= 10 ? ts + 'T00:00:00Z' : ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  const days = Math.floor((Date.now() - t) / 86400e3);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  return date(ts);
}

export function waLink(num) {
  const digits = (num || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

export function todayISO() {
  return new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
}

/** "5925550123" → "+592 555 0123", "15557506003" → "+1 555 750 6003"; anything else is returned as is. */
export function phone(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (/^592\d{7}$/.test(d)) return `+592 ${d.slice(3, 6)} ${d.slice(6)}`;
  if (/^1\d{10}$/.test(d)) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^\d{7}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return d.length >= 7 && !/@/.test(num) ? `+${d}` : num;
}
