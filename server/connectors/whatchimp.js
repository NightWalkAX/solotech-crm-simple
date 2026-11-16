// WhatsApp Business via WhatChimp (BSP). No public webhook yet (domain pending), so we poll:
// most-recent subscribers → their last messages. Runs in the chat worker (not file-watched).
// Unlike email, every chat is stored: the business number only receives business conversations
// (new leads from FB ads land in the Inbox as unassigned threads).
import fs from 'node:fs';
import path from 'node:path';
import { db, DB_PATH, getSetting, setSetting, changed } from '../db.js';
import { addMessage, digits } from '../messages.js';
import { owner } from '../owner.js';

const API = 'https://app.whatchimp.com/api/v1';
const SECRET_FILE = path.join(path.dirname(DB_PATH), 'whatchimp.json'); // { api_token } — chmod 600, outside git
const POLL_MS = 60e3;
const SUBSCRIBERS_PER_POLL = 15;
const state = { syncing: false, lastError: null };

const config = () => getSetting('whatchimp', {});
function token() {
  try { return JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8')).api_token; } catch { return null; }
}

// Network drops ("fetch failed": DNS, reset, timeout) are retried with backoff; API errors are not.
async function post(url, init, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30e3) });
    } catch (e) {
      if (i >= tries) throw new Error(`sin conexión con WhatChimp (${e.cause?.code || e.message})`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

export async function call(endpoint, params = {}) {
  const body = new URLSearchParams({ apiToken: token(), phone_number_id: config().phone_number_id, ...params });
  const res = await post(`${API}/${endpoint}`, { method: 'POST', body, headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({ status: '0', message: `WhatChimp ${res.status}` }));
  if (String(data.status) !== '1' && data.status !== true) {
    if (/no record/i.test(data.message)) return { ...data, message: [] };
    throw new Error(data.message || 'WhatChimp error');
  }
  return data;
}

export function status() {
  const c = config();
  return {
    has_token: !!token(),
    phone_number_id: c.phone_number_id ?? null,
    connected: !!(token() && c.phone_number_id && c.verified_at),
    last_sync: c.last_sync ?? null,
    syncing: state.syncing,
    last_error: state.lastError,
  };
}

/** api_token (optional once saved: kept in data/whatchimp.json, 0600, never in the DB) + phone_number_id, verified live. */
export async function configure({ phone_number_id, api_token }) {
  if (api_token?.trim()) {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, JSON.stringify({ api_token: api_token.trim() }), { mode: 0o600 });
  }
  if (!token()) throw new Error('Falta el API token de WhatChimp');
  setSetting('whatchimp', { ...config(), phone_number_id: String(phone_number_id).trim(), verified_at: null });
  await call('whatsapp/subscriber/list', { limit: 1, offset: 1 }); // throws if the id is wrong
  setSetting('whatchimp', { ...config(), verified_at: new Date().toISOString() });
  sync().catch(() => {});
  return status();
}

// message_content is the raw WhatsApp Cloud payload (JSON string) for both directions.
function textOf(raw) {
  let m = raw;
  try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return String(raw ?? ''); }
  if (!m || typeof m !== 'object') return String(m ?? '');
  const t = m.type;
  if (m.text?.body) return m.text.body;
  if (t === 'interactive') {
    const i = m.interactive || {};
    return i.body?.text || i.button_reply?.title || i.list_reply?.title || '[mensaje interactivo]';
  }
  if (t === 'button') return m.button?.text || '[botón]';
  if (t === 'template') return `[plantilla: ${m.template?.name ?? ''}]`;
  if (['image', 'video', 'document', 'audio', 'sticker'].includes(t)) {
    const label = { image: 'imagen', video: 'video', document: 'documento', audio: 'audio', sticker: 'sticker' }[t];
    return `[${label}]${m[t]?.caption ? ' ' + m[t].caption : ''}`;
  }
  if (t === 'location') return '[ubicación]';
  if (t === 'reaction') return `[reacción ${m.reaction?.emoji ?? ''}]`;
  return m.body || m.message || `[${t || 'mensaje'}]`;
}

// Inbound rows hold the full Meta webhook ({object, entry[].changes[].value}); outbound rows hold the send payload.
function unwrap(msg) {
  let c = msg.message_content;
  try { c = typeof c === 'string' ? JSON.parse(c) : c; } catch { return { text: String(c ?? '') }; }
  if (c?.object === 'whatsapp_business_account') {
    const value = c.entry?.[0]?.changes?.[0]?.value ?? {};
    const echo = value.message_echoes?.[0] || value.smb_message_echoes?.[0]; // sent from the phone app (coexistence)
    const m = value.messages?.[0] || echo;
    if (!m) return { skip: true };                                      // status-only callbacks
    if (m.type === 'unsupported' || m.errors?.length) return { skip: true }; // "This message is unavailable" (131060)
    return { text: textOf(m), id: m.id, ts: m.timestamp, outgoing: !!echo, name: value.contacts?.[0]?.profile?.name };
  }
  return { text: textOf(c) };
}

function store(msg, sub) {
  const u = unwrap(msg);
  if (u.skip || !u.text) return null;
  const inbound = u.outgoing ? false
    : !['bot', 'agent', 'admin', 'business'].includes(String(msg.sender).toLowerCase()) && !msg.agent_name;
  const phone = digits(sub.chat_id);
  const sent_at = u.ts
    ? new Date(Number(u.ts) * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : String(msg.conversation_time).slice(0, 19); // WhatChimp times are UTC
  return addMessage({
    channel: 'whatsapp',
    direction: inbound ? 'in' : 'out',
    external_id: `wa:${u.id || msg.wa_message_id || 'wc' + msg.id}`,
    thread_key: phone,
    sender: inbound ? u.name || [sub.first_name, sub.last_name].filter(Boolean).join(' ') || `+${phone}` : msg.agent_name || owner().short,
    body: u.text,
    sent_at,
    status: inbound ? 'received' : msg.message_status || 'sent',
    source: 'whatsapp_api',
    read_at: inbound ? null : new Date().toISOString(),
  }, 'system');
}

async function syncSubscriber(sub, limit = 50) {
  const conv = await call('whatsapp/get/conversation', { phone_number: digits(sub.chat_id), limit, offset: 1 });
  let added = 0;
  for (const msg of conv.message || []) if (store(msg, sub)) added++;
  return added;
}

export async function sync() {
  if (!status().connected || state.syncing) return { skipped: true };
  state.syncing = true;
  let added = 0;
  try {
    const { message: subs = [] } = await call('whatsapp/subscriber/list', { limit: SUBSCRIBERS_PER_POLL, offset: 1, orderBy: 1 });
    // The owner's own number is a prompt line (wa-prompts.js), not an Inbox conversation.
    const lines = ['wa_prompts'].map(k => getSetting(k, {})).filter(l => l.enabled && l.phone).map(l => digits(l.phone).slice(-7));
    for (const sub of subs) if (!lines.includes(digits(sub.chat_id).slice(-7))) added += await syncSubscriber(sub);
    setSetting('whatchimp', { ...config(), last_sync: new Date().toISOString() });
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
  } finally {
    state.syncing = false;
    changed('settings');
  }
  return { added };
}

/** Full history with one number (up to 10 pages of 50). */
export async function backfill(phone) {
  const number = digits(phone);
  const { message: found = [] } = await call('whatsapp/subscriber/get', { phone_number: number });
  const sub = found[0] ?? { chat_id: number };
  let added = 0;
  for (let offset = 1; offset <= 10; offset++) {
    const conv = await call('whatsapp/get/conversation', { phone_number: number, limit: 50, offset });
    const page = conv.message || [];
    for (const msg of page) if (store(msg, sub)) added++;
    if (page.length < 50) break;
  }
  return { added };
}

/** Last inbound message time for the 24-hour customer-service window. */
export function windowInfo(client_id) {
  const last = db.prepare("SELECT max(sent_at) FROM messages WHERE client_id = ? AND channel = 'whatsapp' AND direction = 'in'").pluck().get(client_id);
  const open = !!last && Date.now() - Date.parse(last.replace(' ', 'T') + 'Z') < 24 * 3600e3;
  return { last_inbound_at: last, open };
}

export async function send({ client_id, text }) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  const phone = digits(client?.whatsapp || client?.phone);
  if (phone.length < 10) throw new Error('El número del cliente debe incluir el código de país (ej. +592…)');
  const r = await call('whatsapp/send', { phone_number: phone, message: text });
  addMessage({
    client_id, channel: 'whatsapp', direction: 'out', external_id: `wa:${r.wa_message_id}`, thread_key: phone,
    sender: owner().short, body: text, sent_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    status: 'sent', source: 'whatsapp_api', read_at: new Date().toISOString(),
  }, 'system');
  return { ok: true, wa_message_id: r.wa_message_id };
}

/** Plain session text to any number (no CRM message row); used for the owner's own prompt line. */
export async function sendTo(phone, text) {
  return call('whatsapp/send', { phone_number: digits(phone), message: text });
}

// Meta rejects uploads typed application/octet-stream (#100), so every file needs its real type.
const MIME = {
  '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain', '.csv': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

/** Upload a local file (Upload Media API) and send it as a document/image/audio. */
export async function sendFileTo(phone, file, { name = path.basename(file), caption } = {}) {
  const form = new FormData();
  form.set('phone_number_id', config().phone_number_id);
  form.set('media_file', new Blob([fs.readFileSync(file)], { type: MIME[path.extname(name || file).toLowerCase()] || 'application/pdf' }), name);
  const res = await post(`${API}/whatsapp/upload/media`, { method: 'POST', body: form, headers: { accept: 'application/json', authorization: `Bearer ${token()}` } });
  const up = await res.json().catch(() => ({ status: '0', message: `WhatChimp upload ${res.status}` }));
  if (String(up.status) !== '1') throw new Error(up.message || 'WhatChimp upload error');
  return call('whatsapp/send/file', {
    phone_number: digits(phone), media_id: up.media_id, media_type: up.media_type,
    ...(up.media_type === 'document' ? { media_name: up.media_name || name } : {}),
    ...(caption ? { media_caption_text: caption } : {}),
  });
}

export function startPolling() {
  setInterval(() => sync().catch(() => {}), POLL_MS).unref();
  setTimeout(() => sync().catch(() => {}), 8000).unref();
}
