import type { GameCandidate, IgdbCompany, MetadataCapabilities } from '../types/metadata'
import { apiFetch } from './client'

export function getMetadataCapabilities(): Promise<MetadataCapabilities> {
  return apiFetch<MetadataCapabilities>('/metadata/capabilities')
}

/** Where a company's page on IGDB opens: the API redirects there, since
 * IGDB addresses its pages by name rather than by id. */
export function igdbCompanyPage(id: number): string {
  return `/api/metadata/companies/${id}/page`
}

/** Where a game's page on IGDB opens, the same way as a company's. */
export function igdbGamePage(id: number): string {
  return `/api/metadata/games/${id}/page`
}

/** The names IGDB gives companies, in the order of `ids`. The library only
 * keeps the ids it is linked to. */
export async function listIgdbCompanies(ids: number[]): Promise<IgdbCompany[]> {
  const { companies } = await apiFetch<{ companies: IgdbCompany[] }>(`/metadata/companies?ids=${ids.join(',')}`)
  return companies
}

/** The IGDB games a title may refer to, most relevant first. */
export async function searchGameMetadata(title: string): Promise<GameCandidate[]> {
  const params = new URLSearchParams({ title })
  const { candidates } = await apiFetch<{ candidates: GameCandidate[] }>(`/metadata/games?${params}`)
  return candidates
}
