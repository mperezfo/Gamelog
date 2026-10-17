import { useQuery } from '@tanstack/react-query'

import { getHealth } from '../api/health'
import { useOffline } from './useOffline'

/** API status, refreshed every 30s, or every 10s while the server cannot be
 * reached, which is how the app notices it is back. */
export function useHealth() {
  const offline = useOffline()

  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: offline ? 10_000 : 30_000,
  })
}
