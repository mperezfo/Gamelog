import { useQuery } from '@tanstack/react-query'

import { getMetadataCapabilities, listIgdbNames, searchGameMetadata } from '../api/metadata'

/** What the deployment is configured for. It only changes with a restart of
 * the server, so it is read once per session. */
export function useMetadataCapabilities() {
  return useQuery({
    queryKey: ['metadata', 'capabilities'],
    queryFn: getMetadataCapabilities,
    staleTime: Infinity,
  })
}

/** The names of IGDB companies or platforms, fetched only once `enabled`:
 * they are shown on demand, and a name hardly ever changes. */
export function useIgdbNames(kind: 'companies' | 'platforms', ids: number[], enabled: boolean) {
  return useQuery({
    queryKey: ['metadata', kind, ids],
    queryFn: () => listIgdbNames(kind, ids),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
}

/** The IGDB candidates for a title. Null runs no search: it starts when the
 * Identify button is pressed, not on every keystroke in the title. */
export function useGameCandidates(title: string | null) {
  return useQuery({
    queryKey: ['metadata', 'games', title],
    queryFn: () => searchGameMetadata(title ?? ''),
    enabled: title !== null,
    // A search reflects the library's links at the time, which a save may
    // change: run it again each time rather than serve an old answer.
    gcTime: 0,
    retry: false,
  })
}
