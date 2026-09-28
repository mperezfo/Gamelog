/** Response of `GET /api/health`. */
export interface Health {
  status: string
  service: string
  /** A git tag, or a short commit hash when the build has none. */
  version: string
  /** Instant in UTC, RFC 3339 format. */
  time: string
}
