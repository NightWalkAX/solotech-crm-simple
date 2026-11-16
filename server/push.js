// PWA push notifications (Web Push + VAPID). Used from both processes: API (subscribe/test) and chat worker
// (finished chat turns, Programados outputs, new client messages in the Bandeja). Never throws to callers.
import webpush from 'web-push';
import { db, getSetting, setSetting, changed } from './db.js';

// Which events notify; toggled in Integraciones (settings.push).
const EVENTS = { chat: true, jobs: true, inbox: true };
export const pushConfig = () => ({ ...EVENTS, ...getSetting('push', {}) });

/** VAPID keys are created once and kept in settings; INSERT OR IGNORE so both processes end up with the same pair. */
function vapid() {
  let v = getSetting('push_vapid');
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('push_vapid', JSON.stringify(k));
    v = getSetting('push_vapid');
  }
  return v;
}

export function status() {
  return {
    ...pushConfig(),
    public_key: vapid().publicKey,
    devices: db.prepare('SELECT id, endpoint, user_agent, created_at, last_ok_at, last_error FROM push_subscriptions ORDER BY id').all(),
  };
}

export function configure(patch) {
  const next = { ...pushConfig() };
  for (const k of Object.keys(EVENTS)) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  setSetting('push', next);
  return status();
}

export function subscribe(sub, userAgent) {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('suscripción inválida');
  db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, last_error = NULL`)
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent || null);
  changed('push_subscriptions');
  return status();
}

export function unsubscribe({ endpoint, id }) {
  if (id) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(id);
  else db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  changed('push_subscriptions');
  return status();
}

/**
 * Send to every subscribed device. `event` (chat | jobs | inbox) is checked against the toggles; null = always (test).
 * payload: { title, body, url, tag } — url is the CRM path opened on click.
 */
export async function notify(event, { title, body = '', url = '/', tag } = {}) {
  try {
    if (event && !pushConfig()[event]) return 0;
    const subs = db.prepare('SELECT * FROM push_subscriptions').all();
    if (!subs.length) return 0;
    const { publicKey, privateKey } = vapid();
    const data = JSON.stringify({ title, body: body.length > 300 ? body.slice(0, 297) + '…' : body, url, tag });
    let sent = 0;
    await Promise.all(subs.map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, {
          vapidDetails: { subject: 'mailto:crm@localhost', publicKey, privateKey },
          TTL: 24 * 3600,
          urgency: 'high',
        });
        db.prepare("UPDATE push_subscriptions SET last_ok_at = datetime('now'), last_error = NULL WHERE id = ?").run(s.id);
        sent++;
      } catch (e) {
        // 404/410 = the browser dropped the subscription (uninstalled, permission revoked).
        if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else db.prepare('UPDATE push_subscriptions SET last_error = ? WHERE id = ?').run(String(e.body || e.message).slice(0, 300), s.id);
      }
    }));
    changed('push_subscriptions');
    return sent;
  } catch (e) {
    console.error('[push]', e.message);
    return 0;
  }
}

/** Markdown/WhatsApp formatting → plain one-paragraph text for a notification body. */
export const plain = t => String(t || '').replace(/[*_`#>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
