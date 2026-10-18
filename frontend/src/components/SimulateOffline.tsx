import { useQueryClient } from '@tanstack/react-query'

import { useOfflineSimulated } from '../hooks/useOffline'
import { setOfflineSimulated } from '../lib/connectivity'

/** Development only: makes every request fail as if the server were gone,
 * to try the offline mode without stopping the backend. */
export function SimulateOffline() {
  const simulated = useOfflineSimulated()
  const queryClient = useQueryClient()

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted select-none">
      <input
        type="checkbox"
        checked={simulated}
        onChange={(event) => {
          setOfflineSimulated(event.target.checked)
          // Asks again right away, so the switch takes effect at once in
          // either direction.
          void queryClient.invalidateQueries()
        }}
      />
      Simulate offline
    </label>
  )
}
