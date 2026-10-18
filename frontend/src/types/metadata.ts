/** Which of the metadata features this deployment is configured for. */
export interface MetadataCapabilities {
  /** Games can be looked up on IGDB (the game form's Identify button). */
  identify: boolean
}

/** How a company from IGDB was matched to a record of the library. Only
 * `linked` is certain: the user chose it before. The rest are guesses from
 * the name, from the surest to the loosest. */
export type MatchReason = 'linked' | 'name' | 'normalized' | 'prefix'

/** A developer or publisher of a candidate, with the record of the library
 * it most likely is. */
export interface CompanyMatch {
  igdb_company_id: number
  /** The company's name on IGDB. */
  name: string
  match: { id: number; name: string; reason: MatchReason } | null
}

/** A company as IGDB names it. */
export interface IgdbCompany {
  id: number
  name: string
}

/** One IGDB game a title may refer to. */
export interface GameCandidate {
  igdb_id: number
  name: string
  /** RFC 3339 at midnight UTC, or null when IGDB does not know it. */
  release_date: string | null
  platforms: string[]
  /** A small cover hosted by IGDB, only to tell candidates apart: it is never
   * stored as a game's cover. */
  cover_url: string | null
  developers: CompanyMatch[]
  publishers: CompanyMatch[]
}
