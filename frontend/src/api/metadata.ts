import type { GameCandidate, MetadataCapabilities } from '../types/metadata'
import { apiFetch } from './client'

export function getMetadataCapabilities(): Promise<MetadataCapabilities> {
  return apiFetch<MetadataCapabilities>('/metadata/capabilities')
}

/** The IGDB games a title may refer to, most relevant first. */
export async function searchGameMetadata(title: string): Promise<GameCandidate[]> {
  const params = new URLSearchParams({ title })
  const { candidates } = await apiFetch<{ candidates: GameCandidate[] }>(`/metadata/games?${params}`)
  return candidates
}
