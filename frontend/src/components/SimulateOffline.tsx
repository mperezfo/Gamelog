import { useQueryClient } from '@tanstack/react-query'

import { useOfflineSimulated } from '../hooks/useOffline'
import { setOfflineSimulated } from '../lib/connectivity'
import { Switch } from './Switch'

/** Development only: makes every request fail as if the server were gone,
 * to try the offline mode without stopping the backend. */
export function SimulateOffline() {
  const simulated = useOfflineSimulated()
  const queryClient = useQueryClient()

  return (
    <Switch
      checked={simulated}
      onChange={(checked) => {
        setOfflineSimulated(checked)
        // Asks again right away, so the switch takes effect at once in
        // either direction.
        void queryClient.invalidateQueries()
      }}
    >
      Simulate offline
    </Switch>
  )
}
