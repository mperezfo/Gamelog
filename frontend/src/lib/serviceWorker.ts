/** The Cache Storage name src/sw.js keeps stored images under. */
const IMAGES_CACHE = 'gamelog-images-v1'

/** Registers src/sw.js, which keeps the app shell and every stored image the
 * app has shown, so that it opens and shows them from the device when the
 * server cannot be reached. Production builds only: under the Vite dev server
 * it would serve files from a previous session while their code is being
 * worked on. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    // An app that cannot register one works exactly as before, only without
    // the cache.
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    // Without this a browser may clear the offline copy under storage
    // pressure, and Safari does after a week without a visit. It is only a
    // request: the browser is free to refuse it.
    void navigator.storage?.persist?.().catch(() => false)
  })
}

/** Asks the service worker to fetch and keep these stored images, so that
 * they are on the device before anything shows them. Anything already cached
 * is skipped, so repeating the same list is cheap. */
export async function cacheImages(urls: string[]) {
  if (!('serviceWorker' in navigator) || urls.length === 0) return
  const registration = await navigator.serviceWorker.getRegistration()
  registration?.active?.postMessage({ type: 'cache-images', urls })
}

/** Drops the cached images, so the next account to sign in on this device
 * does not get the previous one's covers served from it. */
export async function clearImageCache() {
  if (!('caches' in window)) return
  await caches.delete(IMAGES_CACHE)
}
