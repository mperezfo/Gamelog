/** The shape shared by genres, developers, publishers and platforms. */
export interface Lookup {
  id: number
  name: string
  /** Derived from the name and kept in sync with it. The id is purely
   * internal — this is what belongs in a URL. */
  slug: string
  icon: string | null
  /** Hex color. Only ever set for platforms. */
  color: string | null
  /** The IGDB companies a developer or publisher has been linked to through
   * Identify. Left out when there are none, and always for the other two. */
  igdb_company_ids?: number[]
}

/** What creating or renaming one of them sends. */
export interface LookupInput {
  name: string
  icon?: string | null
  color?: string | null
}

/** The four simple entities, plural as their endpoint segment. */
export type LookupKind = 'genres' | 'developers' | 'publishers' | 'platforms'
