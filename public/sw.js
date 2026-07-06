// Offline-first service worker. Vite emits hashed asset filenames, so instead
// of a fixed precache list we cache same-origin GETs as they're fetched.
// API calls are never cached — the game degrades gracefully without them.
const CACHE = 'gh-snake-v4';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add('./').catch(() => {});
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
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return; // network only

  // Navigations: network first so deploys show up, cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        const shell = await caches.match('./');
        if (shell) return shell;
        throw new Error('offline');
      }
    })());
    return;
  }

  // Assets: cache first (hashed filenames make stale entries impossible),
  // falling back to network and populating the cache.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  })());
});
