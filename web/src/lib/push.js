// PWA: service worker registration + Web Push subscription of this browser (server/push.js, web/public/sw.js).
import { api } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[sw]', e));
}

const toKey = b64 => {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission (must come from a click) and register this browser with the server. */
export async function enablePush(publicKey) {
  if (!pushSupported()) throw new Error('Este navegador no soporta notificaciones push');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado en el navegador');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with other VAPID keys can't receive our pushes: replace it.
  if (sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey || []))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  return api.post('/push/subscribe', sub.toJSON());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
