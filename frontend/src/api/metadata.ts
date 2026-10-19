import type { GameCandidate, IgdbKind, IgdbNamed, MetadataCapabilities } from '../types/metadata'
import { apiFetch } from './client'

export function getMetadataCapabilities(): Promise<MetadataCapabilities> {
  return apiFetch<MetadataCapabilities>('/metadata/capabilities')
}

/** Where the page of an IGDB record opens: the API redirects there, since
 * IGDB addresses its pages by name rather than by id. */
export function igdbPage(kind: IgdbKind, id: number): string {
  return `/api/metadata/${kind}/${id}/page`
}

/** The names IGDB gives companies or platforms, in the order of `ids`. The
 * library only keeps the ids it is linked to. */
export async function listIgdbNames(kind: 'companies' | 'platforms', ids: number[]): Promise<IgdbNamed[]> {
  const response = await apiFetch<Record<typeof kind, IgdbNamed[]>>(`/metadata/${kind}?ids=${ids.join(',')}`)
  return response[kind]
}

/** The IGDB games a title may refer to, most relevant first. */
export async function searchGameMetadata(title: string): Promise<GameCandidate[]> {
  const params = new URLSearchParams({ title })
  const { candidates } = await apiFetch<{ candidates: GameCandidate[] }>(`/metadata/games?${params}`)
  return candidates
}
