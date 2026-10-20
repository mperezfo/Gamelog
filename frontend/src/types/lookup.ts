/** The shape shared by genres, developers, publishers and platforms. A few
 * fields only ever come with some of them. */
export interface Lookup {
  id: number
  name: string
  /** Derived from the name and kept in sync with it. The id is purely
   * internal — this is what belongs in a URL. */
  slug: string
  /** An emoji shown beside the name. Genres and platforms only. */
  icon?: string | null
  /** Where a developer or publisher is from, as an ISO 3166-1 two-letter
   * code ("JP"), drawn as its flag. Developers and publishers only. */
  country?: string | null
  /** Hex color. Only ever set for platforms. */
  color: string | null
  /** The IGDB companies a developer or publisher has been linked to through
   * Identify. Left out when there are none, and always for the other two. */
  igdb_company_ids?: number[]
  /** The same for a platform and the IGDB platforms it stands for. */
  igdb_platform_ids?: number[]
}

/** What creating or renaming one of them sends. */
export interface LookupInput {
  name: string
  icon?: string | null
  color?: string | null
  country?: string | null
}

/** The longest name the API takes for a genre, developer, publisher or
 * platform, in characters. A longer one fails the request, and inside a game
 * write (a new developer, say) the whole save with it. */
export const MAX_LOOKUP_NAME = 100

/** The four simple entities, plural as their endpoint segment. */
export type LookupKind = 'genres' | 'developers' | 'publishers' | 'platforms'
