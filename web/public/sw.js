// Service worker: makes the CRM installable and quick to open.
// - Hashed assets (/_astro/*) and icons: cache-first (they never change).
// - Pages: network-first, falling back to the cached copy, then the offline page.
// - /api/*: never cached (client data stays on the server only).
const VERSION = 'ksa-v1';
const SHELL = ['/offline.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(url.pathname, copy)); }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match('/offline.html')))
    );
  }
});
