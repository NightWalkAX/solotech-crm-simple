// 5-field cron (minute hour day-of-month month day-of-week) evaluated in Guyana time (UTC-4, no DST).
// Supports *, n, a-b, lists and /step; day-of-week 0-7 (0 and 7 = Sunday). DB times are UTC 'YYYY-MM-DD HH:MM:SS'.
const OFFSET_MS = -4 * 3600e3;
const FIELDS = [['minute', 0, 59], ['hour', 0, 23], ['day', 1, 31], ['month', 1, 12], ['weekday', 0, 7]];

function field(expr, name, min, max) {
  const set = new Set();
  for (const part of expr.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`cron: "${part}" no válido en ${name}`);
    let lo, hi;
    if (m[1] === '*') [lo, hi] = [min, max];
    else if (m[1].includes('-')) [lo, hi] = m[1].split('-').map(Number);
    else { lo = Number(m[1]); hi = m[2] ? max : lo; } // "5/15" = from 5 every 15
    const step = Number(m[2] || 1);
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron: "${part}" fuera de rango en ${name} (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) set.add(name === 'weekday' && v === 7 ? 0 : v);
  }
  return set;
}

export function parseCron(cron) {
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron: deben ser 5 campos (minuto hora día mes día-semana)');
  const [minute, hour, day, month, weekday] = parts.map((p, i) => field(p, ...FIELDS[i]));
  return { minute, hour, day, month, weekday, anyDay: parts[2] === '*', anyWeekday: parts[4] === '*' };
}

export const toUtc = d => d.toISOString().replace('T', ' ').slice(0, 19);
export const fromUtc = s => new Date(s.replace(' ', 'T') + 'Z');

/** Guyana local 'YYYY-MM-DD HH:MM[:SS]' → UTC 'YYYY-MM-DD HH:MM:SS'. */
export function localToUtc(local) {
  const m = String(local).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error('Hora no válida: usa "YYYY-MM-DD HH:MM" (hora de Guyana)');
  const d = new Date(`${m[1]}T${m[2].padStart(2, '0')}:${m[3]}:${m[4] || '00'}Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Fecha no válida');
  return toUtc(new Date(d.getTime() - OFFSET_MS));
}

/** UTC → Guyana local 'YYYY-MM-DD HH:MM'. */
export const utcToLocal = s => s && toUtc(new Date(fromUtc(s).getTime() + OFFSET_MS)).slice(0, 16);

/** Next run strictly after `after` (Date, default now) as UTC string. */
export function nextRun(cron, after = new Date()) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  // Work on a Date whose UTC fields are Guyana wall-clock time.
  const t = new Date(after.getTime() + OFFSET_MS);
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const dayOk = () => {
    const dom = c.day.has(t.getUTCDate()), dow = c.weekday.has(t.getUTCDay());
    if (c.anyDay && c.anyWeekday) return true;
    if (c.anyDay) return dow;
    if (c.anyWeekday) return dom;
    return dom || dow; // classic cron: both restricted = either matches
  };
  for (let guard = 0; guard < 100_000; guard++) {
    if (!c.month.has(t.getUTCMonth() + 1)) { t.setUTCMonth(t.getUTCMonth() + 1, 1); t.setUTCHours(0, 0); continue; }
    if (!dayOk()) { t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0); continue; }
    if (!c.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0); continue; }
    if (!c.minute.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1); continue; }
    return toUtc(new Date(t.getTime() - OFFSET_MS));
  }
  throw new Error('cron: no hay próxima ejecución');
}
