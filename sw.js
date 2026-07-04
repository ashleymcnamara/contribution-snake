// Service worker for GitHub Snake.
// Strategy:
//  - Navigations (HTML): network-first, so a fresh deploy is always picked up
//    when online, falling back to the cached shell only when offline.
//  - Other GET requests (assets): stale-while-revalidate, so they load fast
//    but still refresh in the background.
// Bump CACHE whenever the cached asset list changes to purge old caches.
const CACHE = 'gh-snake-v2';
const ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache each asset independently so one missing file can't break install.
    await Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Network-first for page navigations so users always get the latest deploy.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (err) {
        const cached = (await caches.match(req)) || (await caches.match('./index.html'));
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Stale-while-revalidate for other GET requests (static assets).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      })
      .catch(() => null);
    return cached || (await network) || fetch(req);
  })());
});
