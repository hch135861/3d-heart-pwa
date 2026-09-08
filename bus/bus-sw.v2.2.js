const CACHE = 'bus-commute-shell-v2.2.2';
const SHELL = [
  './v2.html', './app.v2.2.mjs', './domain.v2.1.mjs', './theme.v2.1.css',
  './sound.v2.2.1.js', './calendar.v2.2.2.js',
  './bus.webmanifest', './bus-icon.svg', './bus-icon-192.png', './bus-icon-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('bus-commute-shell-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const live = await fetch(request, { cache: 'no-store' });
        if (live.ok) {
          const cache = await caches.open(CACHE);
          await cache.put('./v2.html', live.clone()).catch(() => {});
          return live;
        }
      } catch {}
      return (await caches.match('./v2.html')) || new Response('公交助手暂时无法打开', { status: 503 });
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try { return await fetch(request, { cache: 'no-store' }); }
    catch { return new Response('', { status: 503 }); }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || new URL('./v2.html', self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(target);
  })());
});
