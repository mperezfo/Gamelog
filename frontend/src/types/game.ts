import type { Lookup } from './lookup'

/** The longest title and tagline the API takes, in characters. */
export const MAX_TITLE = 255
export const MAX_TAGLINE = 255

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
  playing: 'bg-warn',
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
   * tiebreaker among games sharing a logged_date (or with none). */
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
  /** The IGDB game it was identified as, or null. */
  igdb_id: number | null
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
  /** Like every other field, left out unlinks it: always echo it back. */
  igdb_id?: number | null
  genre_ids?: number[]
  developer_ids?: number[]
  publisher_ids?: number[]
  /** Created along with the game, in the same transaction, so a form that is
   * abandoned or a save that fails leaves no unused record behind. A name the
   * library already has is attached rather than created again. */
  new_developers?: NewLookup[]
  new_publishers?: NewLookup[]
  /** Ties existing records to the IGDB company each stands for. */
  developer_links?: CompanyLink[]
  publisher_links?: CompanyLink[]
  /** The platform to play it on, by name: created if the library does not
   * have it yet, and attached in place of platform_id. */
  new_platform?: NewPlatform | null
  /** Ties an existing platform to an IGDB platform it stands for. */
  platform_link?: PlatformLink | null
}

/** A platform to create when the game is saved. */
export interface NewPlatform {
  name: string
  /** The IGDB platform to link it to. */
  igdb_platform_id?: number | null
}

/** An existing platform and an IGDB platform it stands for. */
export interface PlatformLink {
  id: number
  igdb_platform_id: number
}

/** A developer or publisher to create when the game is saved. */
export interface NewLookup {
  name: string
  /** The IGDB company to link it to, when it came from Identify. */
  igdb_company_id?: number | null
}

/** An existing developer or publisher and the IGDB company it stands for. */
export interface CompanyLink {
  id: number
  igdb_company_id: number
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
