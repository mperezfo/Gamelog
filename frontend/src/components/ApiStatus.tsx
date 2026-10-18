import { useHealth } from '../hooks/useHealth'
import { useOfflineSimulated } from '../hooks/useOffline'
import { StatusBadge } from './StatusBadge'

/** The API's own health, kept where it does not interrupt anything. */
export function ApiStatus() {
  const { data, error, isPending } = useHealth()
  const simulated = useOfflineSimulated()

  if (isPending) return <StatusBadge tone="pending">Checking…</StatusBadge>
  if (error) {
    return <StatusBadge tone="error">{simulated ? 'Unreachable (simulated)' : 'Unreachable'}</StatusBadge>
  }
  if (data?.status !== 'ok') return <StatusBadge tone="error">Degraded</StatusBadge>
  return <StatusBadge tone="ok">Reachable</StatusBadge>
}
