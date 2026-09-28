import { useQuery } from '@tanstack/react-query'

import { getHealth } from '../api/health'

/** API status, refreshed every 30s. */
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 30_000,
  })
}
