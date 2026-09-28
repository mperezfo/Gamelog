import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getSetupStatus, runSetup } from '../api/auth'
import { sessionKey } from './useSession'

/** Whether the deployment is still waiting for its admin account. */
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup'],
    queryFn: getSetupStatus,
    // It can only go from pending to done, once, in this browser's lifetime.
    staleTime: Infinity,
    retry: 1,
  })
}

/** Creates the admin account and signs in as it. */
export function useRunSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: runSetup,
    onSuccess: (user) => {
      queryClient.setQueryData(sessionKey, user)
      void queryClient.invalidateQueries({ queryKey: ['setup'] })
    },
  })
}
