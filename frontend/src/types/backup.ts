/** One number per section of a document, as an import counts them. */
export interface ImportCounts {
  platforms: number
  genres: number
  developers: number
  publishers: number
  games: number
}

/** Something an import had to decide on its own, tied to the entry that
 * caused it. */
export interface ImportNote {
  section: string
  /** Position of the entry inside its section, counting from zero. -1 when
   * the note is about the import as a whole. */
  index: number
  entry: string
  message: string
}

/** The answer to a backup restore: what was written, and everything the
 * importer had to interpret or leave out along the way. */
export interface ImportReport {
  mode: string
  dry_run: boolean
  created: ImportCounts
  updated: ImportCounts
  deleted: ImportCounts
  skipped: ImportNote[]
  warnings: ImportNote[]
}
