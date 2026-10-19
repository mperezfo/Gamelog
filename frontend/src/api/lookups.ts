import type { Lookup, LookupInput, LookupKind } from '../types/lookup'
import { apiFetch, apiSend } from './client'

/** CRUD shared by genres, developers, publishers and platforms. */

export function listLookups(kind: LookupKind): Promise<Lookup[]> {
  return apiFetch<Lookup[]>(`/${kind}`)
}

export function createLookup(kind: LookupKind, input: LookupInput): Promise<Lookup> {
  return apiSend<Lookup>(`/${kind}`, 'POST', input)
}

export function updateLookup(kind: LookupKind, id: number, input: LookupInput): Promise<Lookup> {
  return apiSend<Lookup>(`/${kind}/${id}`, 'PUT', input)
}

/** Forgets that a developer, publisher or platform stands for one IGDB
 * company or platform. */
export function unlinkLookupFromIgdb(kind: LookupKind, id: number, igdbId: number): Promise<void> {
  return apiFetch<void>(`/${kind}/${id}/igdb/${igdbId}`, { method: 'DELETE' })
}

export function deleteLookup(kind: LookupKind, id: number): Promise<void> {
  return apiFetch<void>(`/${kind}/${id}`, { method: 'DELETE' })
}
