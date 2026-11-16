// Conversations (WhatsApp / email): matching to clients, inbox threads, WhatsApp chat-export import.
import crypto from 'node:crypto';
import { db, insertRow, updateRow, changed } from './db.js';
import { notify, plain } from './push.js';

export const digits = s => String(s ?? '').replace(/\D/g, '');

/** Guyana numbers are 7 local digits (+592 XXX XXXX); compare on the last 7 so "+592 555 0123" == "5550123". */
export function matchClient({ channel, thread_key }) {
  if (channel === 'email') {
    return db.prepare('SELECT id FROM clients WHERE lower(email) = lower(?)').pluck().get(thread_key) ?? null;
  }
  const tail = digits(thread_key).slice(-7);
  if (tail.length < 7) return null;
  const rows = db.prepare('SELECT id, whatsapp, phone FROM clients WHERE whatsapp IS NOT NULL OR phone IS NOT NULL').all();
  return rows.find(r => digits(r.whatsapp).slice(-7) === tail || digits(r.phone).slice(-7) === tail)?.id ?? null;
}

export function threadKeyFor(client, channel) {
  return channel === 'email' ? (client.email || '').toLowerCase() : digits(client.whatsapp || client.phone);
}

const isIgnored = thread_key => !!db.prepare('SELECT 1 FROM ignored_threads WHERE thread_key = ?').get(thread_key);

/** Insert one message; duplicates (same external_id, or a manual/synced twin within 15 min) and ignored chats are skipped. Returns the row or null. */
export function addMessage(m, actor = 'system') {
  if (m.external_id && db.prepare('SELECT 1 FROM messages WHERE external_id = ?').get(m.external_id)) return null;
  if (!m.client_id && isIgnored(m.thread_key)) return null;
  const client_id = m.client_id ?? matchClient(m);
  // Same text logged by hand ("Abrir en WhatsApp" + record) and picked up by a sync: keep one row, the synced one.
  const manual = m.source === 'manual';
  const twin = db.prepare(`SELECT * FROM messages WHERE channel = ? AND direction = ? AND trim(body) = trim(?)
    AND (client_id = ? OR thread_key = ?) AND (source = 'manual') != ?
    AND abs(strftime('%s', sent_at) - strftime('%s', ?)) <= 900 LIMIT 1`)
    .get(m.channel, m.direction, m.body ?? '', client_id, m.thread_key ?? '', manual ? 1 : 0, m.sent_at);
  if (twin && manual) return null;
  if (twin) {
    const { external_id, source, status, sent_at, sender, read_at } = m;
    updateRow('messages', twin.id, { external_id, source, status, sent_at, sender, read_at }, actor);
    return null;
  }
  const row = insertRow('messages', { ...m, client_id }, actor);
  // Push only for fresh, unread messages from the live syncs (not backfills, exports or pasted chats).
  const fresh = Date.now() - new Date(row.sent_at.replace(' ', 'T') + 'Z').getTime() < 30 * 60e3;
  if (row.direction === 'in' && !row.read_at && fresh && ['whatsapp_api', 'graph'].includes(row.source)) {
    const company = client_id ? db.prepare('SELECT company FROM clients WHERE id = ?').pluck().get(client_id) : null;
    notify('inbox', {
      title: `${row.channel === 'email' ? '📧' : '💬'} ${company || row.sender || row.thread_key}`,
      body: plain(row.subject ? `${row.subject} — ${row.body}` : row.body),
      url: client_id ? `/clients/${client_id}` : '/inbox',
      tag: `msg-${client_id || row.thread_key}`,
    });
  }
  return row;
}

export function listThreads() {
  // One row per client conversation, plus unmatched threads by number/address.
  return db.prepare(`
    SELECT coalesce('c' || m.client_id, 't' || m.thread_key) AS key, m.client_id, m.thread_key, c.company,
      max(m.sent_at) AS last_at, count(*) AS total,
      sum(m.direction = 'in' AND m.read_at IS NULL) AS unread,
      (SELECT body FROM messages x WHERE coalesce('c' || x.client_id, 't' || x.thread_key) = coalesce('c' || m.client_id, 't' || m.thread_key) ORDER BY x.sent_at DESC, x.id DESC LIMIT 1) AS last_body,
      (SELECT direction FROM messages x WHERE coalesce('c' || x.client_id, 't' || x.thread_key) = coalesce('c' || m.client_id, 't' || m.thread_key) ORDER BY x.sent_at DESC, x.id DESC LIMIT 1) AS last_direction,
      group_concat(DISTINCT m.channel) AS channels
    FROM messages m LEFT JOIN clients c ON c.id = m.client_id
    WHERE m.client_id IS NOT NULL OR m.thread_key NOT IN (SELECT thread_key FROM ignored_threads)
    GROUP BY key ORDER BY last_at DESC`).all();
}

/** Hide an unassigned chat and stop storing it. Its messages stay, so "dejar de ignorar" brings it back. */
export function ignoreThread(thread_key, actor = 'ui') {
  if (!thread_key) throw new Error('thread_key required');
  if (isIgnored(thread_key)) return null;
  const last = db.prepare("SELECT channel, sender FROM messages WHERE thread_key = ? ORDER BY direction = 'in' DESC, sent_at DESC LIMIT 1").get(thread_key);
  return insertRow('ignored_threads', { thread_key, channel: last?.channel, label: last?.sender }, actor);
}

export const listIgnored = () => db.prepare('SELECT * FROM ignored_threads ORDER BY created_at DESC').all();

export function threadMessages({ client_id, thread_key, channel }) {
  const where = client_id ? 'client_id = @client_id' : 'client_id IS NULL AND thread_key = @thread_key';
  return db.prepare(`SELECT * FROM messages WHERE ${where} ${channel ? 'AND channel = @channel' : ''} ORDER BY sent_at, id`)
    .all({ client_id, thread_key, channel });
}

export function markRead({ client_id, thread_key }) {
  const where = client_id ? 'client_id = @client_id' : 'client_id IS NULL AND thread_key = @thread_key';
  const n = db.prepare(`UPDATE messages SET read_at = datetime('now') WHERE ${where} AND direction = 'in' AND read_at IS NULL`).run({ client_id, thread_key }).changes;
  if (n) changed('messages');
  return n;
}

/** Attach an unmatched thread to a client (and remember the number/address on the client if missing). */
export function assignThread(thread_key, client_id, actor = 'ui') {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) throw new Error('client not found');
  const channel = db.prepare('SELECT channel FROM messages WHERE client_id IS NULL AND thread_key = ? LIMIT 1').pluck().get(thread_key);
  const n = db.prepare('UPDATE messages SET client_id = ? WHERE client_id IS NULL AND thread_key = ?').run(client_id, thread_key).changes;
  if (channel === 'email' && !client.email) updateRow('clients', client_id, { email: thread_key }, actor);
  if (channel === 'whatsapp' && !client.whatsapp) updateRow('clients', client_id, { whatsapp: '+' + digits(thread_key) }, actor);
  changed('messages');
  return n;
}

// ---- WhatsApp "Export chat" (.txt) ------------------------------------------------------------
// Android: "10/2/26, 7:29 PM - Name: text"   iOS: "[10/2/26, 7:29:24 PM] Name: text"   Desktop: "[10/2/26, 7:29:24 PM] - Name: text"
const STAMP = /^\[?(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s*)?/;
const SENDER = /^([^:]{1,60}):\s([\s\S]*)$/;
const clean = raw => raw.replace(/[‎‏‪-‮]/g, '').replace(/[  ]/g, ' ').trimEnd();

/** Day/month order: any part > 12 settles it; otherwise use the hint (chat.md headings) or the caller's default. */
export function detectDayFirst(text, fallback = true) {
  let dayFirst = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const m = clean(raw).match(STAMP);
    if (!m) continue;
    if (Number(m[1]) > 12) { dayFirst = true; break; }
    if (Number(m[2]) > 12) { dayFirst = false; break; }
  }
  return dayFirst ?? fallback;
}

export function parseWhatsAppExport(text, { dayFirst = true } = {}) {
  const out = [];
  let last = null; // message that continuation lines belong to (null after a system notice)
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = clean(raw);
    const m = line.match(STAMP);
    if (!m) {
      if (last && line) last.body += '\n' + line; // continuation of a multi-line message
      continue;
    }
    const sm = line.slice(m[0].length).match(SENDER);
    if (!sm) { last = null; continue; } // system notice: encryption, disappearing messages, joins…
    let [, a, b, y, h, min, sec = '00', ampm] = m;
    const [, sender, body] = sm;
    const [day, month] = dayFirst ? [a, b] : [b, a];
    let hour = Number(h);
    if (ampm) {
      const pm = /p/i.test(ampm);
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    const year = y.length === 2 ? `20${y}` : y;
    // Exports use the phone's local time (Guyana, UTC-4); store UTC.
    const local = Date.UTC(Number(year), Number(month) - 1, Number(day), hour, Number(min), Number(sec));
    const sent_at = new Date(local + 4 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
    last = { sender: sender.trim(), body: body.trim(), sent_at };
    out.push(last);
  }
  return out.filter(m => m.body && !/^<(Media omitted|Multimedia omitido)>$/i.test(m.body) && !/^(This message was deleted|Se eliminó este mensaje)\.?$/i.test(m.body));
}

export function exportSenders(text, opts) {
  const counts = {};
  for (const m of parseWhatsAppExport(text, opts)) counts[m.sender] = (counts[m.sender] || 0) + 1;
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** Import into a client's conversation, or (no client) into the thread of `phone` — matched to a client if one has that number. */
export function importWhatsAppExport({ text, client_id, phone, me, dayFirst = true }) {
  let thread_key, key;
  if (client_id) {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
    if (!client) throw new Error('client not found');
    thread_key = threadKeyFor(client, 'whatsapp') || `client-${client_id}`;
    key = client_id;
  } else {
    thread_key = digits(phone);
    if (thread_key.length < 7) throw new Error('Indica el número del chat (con código de país)');
    client_id = matchClient({ channel: 'whatsapp', thread_key });
    key = client_id ?? `wa${thread_key}`;
  }
  let added = 0;
  db.transaction(() => {
    for (const m of parseWhatsAppExport(text, { dayFirst })) {
      const external_id = 'wa-export:' + crypto.createHash('sha1').update(`${key}|${m.sent_at}|${m.sender}|${m.body}`).digest('hex');
      const row = addMessage({
        client_id, channel: 'whatsapp', thread_key, external_id, sender: m.sender, body: m.body, sent_at: m.sent_at,
        direction: m.sender === me ? 'out' : 'in', status: 'imported', source: 'export',
        read_at: new Date().toISOString(),
      }, 'import');
      if (row) added++;
    }
  })();
  return { added, client_id };
}
