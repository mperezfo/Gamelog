import type { Lookup } from './lookup'

/** Lifecycle stage of a game, in the order the dashboard columns follow. */
export type GameStatus = 'wishlist' | 'pending' | 'playing' | 'played'

export const GAME_STATUSES: readonly GameStatus[] = ['wishlist', 'pending', 'playing', 'played']

export const STATUS_LABELS: Record<GameStatus, string> = {
  wishlist: 'Wishlist',
  pending: 'Pending',
  playing: 'Playing',
  played: 'Played',
}

/** A small dot of color per status — the dashboard board and the global
 * search results share this so a status reads the same wherever it's shown. */
export const STATUS_DOT: Record<GameStatus, string> = {
  wishlist: 'bg-ink-faint',
  pending: 'bg-accent',
  playing: 'bg-amber-500',
  played: 'bg-ok',
}

/** A game, as every endpoint that returns one describes it. */
export interface Game {
  id: number
  title: string
  /** Derived from the title and kept in sync with it — /games/{slug} uses
   * this, not the id. Renaming a game changes its URL. */
  slug: string
  status: GameStatus
  /** Manual order within its status column on the dashboard board — only a
   * tiebreaker among games sharing a release_date (or with none). */
  position: number
  score: number | null
  tagline: string | null
  notes: string | null
  cover_image_url: string | null
  /** Where a portrait crop of the cover should be centred, as a fraction of
   * its width/height (0-1). Null means centred, the default. See
   * GameCoverCard. */
  cover_focal_x: number | null
  cover_focal_y: number | null
  /** How far to zoom in on the portrait crop, anchored at the focal point.
   * Null or 1 means no zoom, the default. See GameCoverCard. */
  cover_zoom: number | null
  /** Date-only ISO string ("2024-05-17"), or null. */
  release_date: string | null
  logged_date: string | null
  platform_id: number | null
  platform?: Lookup | null
  genres?: Lookup[]
  developers?: Lookup[]
  publishers?: Lookup[]
  created_at: string
  updated_at: string
}

/** The writable half of a game: what create and update send. */
export interface GameInput {
  title: string
  status: GameStatus
  /** Required by the API: a PUT that leaves it out resets it to 0, since a
   * write replaces every field. Always echo back the current value unless
   * deliberately reordering. */
  position: number
  score?: number | null
  tagline?: string | null
  notes?: string | null
  cover_image_url?: string | null
  cover_focal_x?: number | null
  cover_focal_y?: number | null
  cover_zoom?: number | null
  release_date?: string | null
  logged_date?: string | null
  platform_id?: number | null
  genre_ids?: number[]
  developer_ids?: number[]
  publisher_ids?: number[]
}

/** Filters GET /api/games and /api/games/stats both accept. */
export interface GameFilter {
  status?: GameStatus
  platform_id?: number
  genre_id?: number
  developer_id?: number
  publisher_id?: number
  sort?: string
  order?: 'asc' | 'desc'
}

/** The table footer: aggregates over whatever filter produced the rows. */
export interface GameStats {
  count: number
  average_score: number | null
  first_logged_date: string | null
  last_logged_date: string | null
}
