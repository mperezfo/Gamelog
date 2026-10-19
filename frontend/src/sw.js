// The service worker keeps two things on the device:
//
// - The app shell: index.html and every file the build produced, so that
//   the app still opens when the server cannot be reached. The data it then
//   shows comes from the query cache persisted in IndexedDB (see
//   src/lib/offlineCache.ts), not from here: the rest of /api goes to the
//   network as if this worker were not here.
// - Stored images. They are named after a hash of their bytes, so a cached
//   copy can never go stale and is served without asking the server first.
//   Cache Storage also outlives the HTTP cache, which Android is quick to
//   evict for an installed app.
//
// This file is not served as is: the build fills in the two values below
// (see serviceWorkerPlugin in vite.config.ts).

const SHELL_CACHE = 'gamelog-shell-__SHELL_VERSION__'
const SHELL_FILES = ['__SHELL_FILES__']

// Bumping the version drops every image cached under the previous one.
const IMAGES_CACHE = 'gamelog-images-v1'

// The emoji images (see emojiPlugin in vite.config.ts), kept as each is first
// shown rather than precached with the shell: there are close to four
// thousand. Bumped along with the emoji-datasource-google package, whose
// images keep their names when they are redrawn.
const EMOJI_CACHE = 'gamelog-emoji-v16'

// How long a page load waits for the server before falling back to the
// cached shell. An unreachable host often does not fail outright, it just
// never answers.
const NAVIGATION_TIMEOUT_MS = 3000

const shellFiles = new Set(SHELL_FILES)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // `reload` skips the HTTP cache, so the shell is exactly this build.
      await cache.addAll(SHELL_FILES.map((path) => new Request(path, { cache: 'reload' })))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      const stale = names.filter(
        (name) =>
          (name.startsWith('gamelog-images-') && name !== IMAGES_CACHE) ||
          (name.startsWith('gamelog-emoji-') && name !== EMOJI_CACHE) ||
          (name.startsWith('gamelog-shell-') && name !== SHELL_CACHE)
      )
      await Promise.all(stale.map((name) => caches.delete(name)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/images/')) {
    event.respondWith(cachedImage(event, request))
  } else if (url.pathname.startsWith('/api/')) {
    return
  } else if (url.pathname.startsWith('/emoji/')) {
    event.respondWith(cachedEmoji(event, request))
  } else if (request.mode === 'navigate') {
    event.respondWith(navigation(request))
  } else if (shellFiles.has(url.pathname)) {
    event.respondWith(shellFile(request))
  }
})

// The app asks for images to be kept ahead of being shown, so that every
// cover is there the next time the server cannot be reached.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-images' || !Array.isArray(event.data.urls)) return
  event.waitUntil(cacheImages(event.data.urls))
})

/** Every page is the same index.html (the router takes it from there), so a
 * page load that cannot reach the server gets the cached one instead. The
 * network still comes first: that is how a new deployment shows up. */
async function navigation(request) {
  // A timer cleared once the server answers, rather than
  // AbortSignal.timeout: aborting after that would cut the page off halfway.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS)
  try {
    return await fetch(request, { signal: controller.signal })
  } catch (error) {
    const cached = await caches.match('/', { cacheName: SHELL_CACHE, ignoreVary: true })
    if (cached) return cached
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Build files carry a content hash in their name, so the cached copy is
 * always right. That is also why Vary is ignored: a module script asks with
 * an Origin header the precaching request did not carry, and a server that
 * answers `Vary: Origin` (vite preview does) would otherwise never match. */
async function shellFile(request) {
  const cached = await caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true })
  return cached ?? fetch(request)
}

async function cachedImage(event, request) {
  const cache = await caches.open(IMAGES_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (isStorable(response)) {
    event.waitUntil(cache.put(request, response.clone()))
  }
  return response
}

/** Only an image is kept: a name the set has no file for is answered with
 * index.html (see try_files in the Caddyfile), which must not be stored as
 * if it were one. */
async function cachedEmoji(event, request) {
  const cache = await caches.open(EMOJI_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (isStorable(response) && response.headers.get('Content-Type')?.startsWith('image/')) {
    event.waitUntil(cache.put(request, response.clone()))
  }
  return response
}

/** Fetches and keeps every image not cached yet, a few at a time so that a
 * large library does not flood the connection. */
async function cacheImages(urls) {
  const cache = await caches.open(IMAGES_CACHE)
  const queue = urls.filter((url) => typeof url === 'string' && url.startsWith('/api/images/'))

  async function worker() {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        if (await cache.match(url)) continue
        const response = await fetch(url, { credentials: 'same-origin' })
        if (isStorable(response)) await cache.put(url, response)
      } catch {
        // The server went away halfway through: what is cached stays, and
        // the rest is asked for again on the next sync.
        return
      }
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker))
}

/** Only a real image: never a 401 from an expired session or a 404, which
 * would otherwise be served from here forever. */
function isStorable(response) {
  return response.ok && response.type === 'basic'
}
