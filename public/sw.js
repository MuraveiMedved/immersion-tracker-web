// Offline support: the app shell is cached on install-free first use (network first for pages and
// data files so updates arrive, cache first for everything else). Race-server calls are never cached.
// v2 (2026-11-21): the Zoo catalog (zoo/animals.json) was cache-first, so a browser that had loaded it
// once kept that old list and never saw animals added since. Bumping the name clears the old cache.
const CACHE = 'immersion-tracker-v2'

/** Network first, falling back to the cache when offline. */
function networkFirst(req, fallback) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy))
    }
    return res
  }).catch(() => caches.match(req).then((r) => r || (fallback ? caches.match(fallback) : undefined)))
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './'))
    return
  }
  // Data that changes between releases (the Zoo catalog, the web manifest): always the newest.
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(networkFirst(req))
    return
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(req, copy))
    }
    return res
  })))
})
