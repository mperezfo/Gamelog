/** The Cache Storage name public/sw.js keeps stored images under. */
const IMAGES_CACHE = 'gamelog-images-v1'

/** Registers public/sw.js, which keeps every stored image the app has shown
 * so that it loads from the device from then on. Production builds only:
 * under the Vite dev server it would serve images from a previous session
 * while their code is being worked on. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    // An app that cannot register one works exactly as before, only without
    // the cache.
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

/** Drops the cached images, so the next account to sign in on this device
 * does not get the previous one's covers served from it. */
export async function clearImageCache() {
  if (!('caches' in window)) return
  await caches.delete(IMAGES_CACHE)
}
