import type { Game, GameFilter, GameInput, GameStats } from '../types/game'
import { apiFetch, apiSend } from './client'

/** Turns a filter into the query string the games endpoints share. */
function query(filter: GameFilter): string {
  const params = new URLSearchParams()
  if (filter.status) params.set('status', filter.status)
  if (filter.platform_id) params.set('platform_id', String(filter.platform_id))
  if (filter.genre_id) params.set('genre_id', String(filter.genre_id))
  if (filter.developer_id) params.set('developer_id', String(filter.developer_id))
  if (filter.publisher_id) params.set('publisher_id', String(filter.publisher_id))
  if (filter.sort) params.set('sort', filter.sort)
  if (filter.order) params.set('order', filter.order)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function listGames(filter: GameFilter = {}): Promise<Game[]> {
  return apiFetch<Game[]>(`/games${query(filter)}`)
}

export function gameStats(filter: GameFilter = {}): Promise<GameStats> {
  return apiFetch<GameStats>(`/games/stats${query(filter)}`)
}

/** ref is a game's numeric id or its slug — the API accepts either. */
export function getGame(ref: number | string): Promise<Game> {
  return apiFetch<Game>(`/games/${ref}`)
}

export function createGame(input: GameInput): Promise<Game> {
  return apiSend<Game>('/games', 'POST', input)
}

export function updateGame(id: number, input: GameInput): Promise<Game> {
  return apiSend<Game>(`/games/${id}`, 'PUT', input)
}

export function deleteGame(id: number): Promise<void> {
  return apiFetch<void>(`/games/${id}`, { method: 'DELETE' })
}
