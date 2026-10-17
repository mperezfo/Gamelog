/**
 * Whether the server can be reached right now, as the requests the app makes
 * find out: the one thing the read-only offline mode (#38) switches on.
 *
 * "Offline" here means the server, not the device: a phone with a perfectly
 * good connection is offline too when the server it runs on is at home and
 * the phone is not. So it follows the outcome of real requests (see
 * `apiFetch`), with the browser's own online/offline events on top for when
 * the device itself has no network.
 */

const SIMULATE_KEY = 'gamelog:simulate-offline'

let serverReachable = true
let deviceOnline = typeof navigator === 'undefined' ? true : navigator.onLine
let simulated = import.meta.env.DEV && readSimulated()
const listeners = new Set<() => void>()

function readSimulated(): boolean {
  try {
    return localStorage.getItem(SIMULATE_KEY) === '1'
  } catch {
    return false
  }
}

function notify() {
  listeners.forEach((listener) => listener())
}

/** Records what the last request found out. */
export function setServerReachable(reachable: boolean) {
  if (reachable === serverReachable) return
  serverReachable = reachable
  notify()
}

/** Whether the app should behave as offline: read-only, from the copy on the
 * device. */
export function isOffline(): boolean {
  return simulated || !deviceOnline || !serverReachable
}

export function subscribeConnectivity(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    deviceOnline = true
    notify()
  })
  window.addEventListener('offline', () => {
    deviceOnline = false
    notify()
  })
}

/** Development only: whether every request fails as if the server were
 * gone, to try the offline mode without stopping the backend. It survives a
 * reload, so restoring from the device copy can be tried as well. */
export function isOfflineSimulated(): boolean {
  return simulated
}

export function setOfflineSimulated(value: boolean) {
  if (!import.meta.env.DEV) return
  simulated = value
  try {
    if (value) localStorage.setItem(SIMULATE_KEY, '1')
    else localStorage.removeItem(SIMULATE_KEY)
  } catch {
    // Storage blocked: the switch still holds until the next reload.
  }
  notify()
}
