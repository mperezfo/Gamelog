/** Which of the metadata features this deployment is configured for. */
export interface MetadataCapabilities {
  /** Games can be looked up on IGDB (the game form's Identify button). */
  identify: boolean
  /** Where cover images can be searched for, in the order to offer them.
   * Empty when the deployment is configured for neither. */
  image_sources: ImageSource[]
}

/** A place cover images are searched for. */
export type ImageSource = 'igdb' | 'steamgriddb'

/** What an image is: IGDB's box art (cover) or other official art
 * (artwork), or SteamGridDB's library art (grid, portrait or landscape) or
 * page banner (hero). */
export type ImageKind = 'cover' | 'artwork' | 'grid' | 'hero'

/** One image of a game, hosted by its source. */
export interface GameImage {
  /** The image at full size. Never stored as it is: picking it imports a
   * copy into the library. */
  url: string
  /** A smaller copy, to choose from. */
  thumb_url: string
  /** In pixels, 0 when the source does not say. */
  width: number
  height: number
  kind: ImageKind
}

/** A game an image search may refer to. */
export interface ImageSearchGame {
  /** The source's own id for it. */
  id: number
  name: string
  /** RFC 3339 at midnight UTC, or null when the source does not know it. */
  release_date: string | null
}

/** The games a title may refer to, and the images of one of them. */
export interface ImageSearchResult {
  /** Empty when the search was by id alone. */
  games: ImageSearchGame[]
  /** The game the images are of, or null when the title matched nothing. */
  game_id: number | null
  images: GameImage[]
}

/** How a company or platform from IGDB was matched to a record of the
 * library. Only `linked` is certain: the user chose it before. The rest are
 * guesses from the name, from the surest to the loosest. */
export type MatchReason = 'linked' | 'name' | 'normalized' | 'prefix'

/** The record of the library a company or platform most likely is. */
export interface MatchTarget {
  id: number
  name: string
  reason: MatchReason
}

/** A developer or publisher of a candidate, with the record of the library
 * it most likely is. */
export interface CompanyMatch {
  igdb_company_id: number
  /** The company's name on IGDB. */
  name: string
  match: MatchTarget | null
}

/** A platform of a candidate, with the platform of the library it most
 * likely is: of those linked to it, the one with the most games. */
export interface PlatformMatch {
  igdb_platform_id: number
  /** The platform's name on IGDB ("PlayStation 5"). */
  name: string
  /** IGDB's short name for it ("PS5"), or empty. */
  abbreviation: string
  match: MatchTarget | null
}

/** The kinds of IGDB record the library links to by id. */
export type IgdbKind = 'companies' | 'platforms' | 'games'

/** A company or platform as IGDB names it. */
export interface IgdbNamed {
  id: number
  name: string
}

/** One IGDB game a title may refer to. */
export interface GameCandidate {
  igdb_id: number
  name: string
  /** RFC 3339 at midnight UTC, or null when IGDB does not know it. */
  release_date: string | null
  platforms: PlatformMatch[]
  /** A small cover hosted by IGDB, only to tell candidates apart: it is never
   * stored as a game's cover. */
  cover_url: string | null
  developers: CompanyMatch[]
  publishers: CompanyMatch[]
}
