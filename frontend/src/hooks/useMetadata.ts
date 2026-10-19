import { useQuery } from '@tanstack/react-query'

import { getMetadataCapabilities, listIgdbNames, searchGameImages, searchGameMetadata } from '../api/metadata'
import type { ImageSource } from '../types/metadata'

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

/** The images of a game on one source, by id or else by the first match for
 * the title (see searchGameImages). Unlike a metadata search, nothing in the
 * answer depends on the library, so it is kept for the session. */
export function useGameImages(source: ImageSource, title: string | null, gameId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['metadata', 'images', source, title, gameId],
    queryFn: () => searchGameImages(source, title, gameId),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
}
