// Service worker: makes the CRM installable and shows push notifications (server/push.js).
// No offline cache on purpose: the CRM is live data served by Vite with HMR, a cache would only show stale screens.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data?.json() ?? {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Solo Tech CRM', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

// Click: reuse an open CRM window (the app navigates in place, see main.jsx) or open a new one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).pathname !== '/preview') || null;
    if (win) {
      await win.focus();
      win.postMessage({ type: 'navigate', url });
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
