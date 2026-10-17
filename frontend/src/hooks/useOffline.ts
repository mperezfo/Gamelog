import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { isOffline, subscribeConnectivity } from '../lib/connectivity'
import { useHealth } from './useHealth'

/**
 * Whether the server cannot be reached right now. While it cannot, the app
 * shows the copy kept on the device and is read-only: everything that would
 * save a change is disabled until the server answers again (#38).
 */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOffline)
}

/** Mounted once, at the top of the app: keeps asking the server while it
 * cannot be reached, and refreshes everything once it answers again. */
export function useReconnect() {
  const offline = useOffline()
  const queryClient = useQueryClient()
  const wasOffline = useRef(offline)
  useHealth()

  useEffect(() => {
    if (wasOffline.current && !offline) void queryClient.invalidateQueries()
    wasOffline.current = offline
  }, [offline, queryClient])
}
