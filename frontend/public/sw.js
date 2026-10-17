// The service worker only keeps stored images: everything else, the app
// shell and the rest of /api included, goes to the network as if it were not
// here. Images are named after a hash of their bytes, so a cached copy can
// never go stale and is served without asking the server first. Cache
// Storage also outlives the HTTP cache, which Android is quick to evict for
// an installed app.

// Bumping the version drops every image cached under the previous one.
const IMAGES_CACHE = 'gamelog-images-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      const stale = names.filter((name) => name.startsWith('gamelog-images-') && name !== IMAGES_CACHE)
      await Promise.all(stale.map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/api/images/')) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(IMAGES_CACHE)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      // Only a real image: never a 401 from an expired session or a 404,
      // which would otherwise be served from here forever.
      if (response.ok && response.type === 'basic') {
        event.waitUntil(cache.put(request, response.clone()))
      }
      return response
    })()
  )
})
