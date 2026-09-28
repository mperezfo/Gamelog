/** Which theme the application renders in. */
export type Theme = 'light' | 'dark' | 'system'

/** How a date is written out throughout the application. 'long' is
 * "Dec 31, 2023"; the other three are all-numeric, in year/month/day,
 * day/month/year and month/day/year order respectively. */
export type DateFormat = 'long' | 'ymd' | 'dmy' | 'mdy'

/** Which layout the Games page opens in when its URL carries no `view` of
 * its own. */
export type GamesView = 'table' | 'grid'

/** An account, as every endpoint that returns one describes it. */
export interface User {
  id: number
  /** Signs the account in. Not shown anywhere in the application itself. */
  username: string
  /** Shown throughout the application instead of the username. */
  name: string
  avatar_url: string | null
  /** Display preferences. They travel with the account rather than the
   * browser, so they follow it across devices and are part of the backup. */
  theme: Theme
  date_format: DateFormat
  games_view: GamesView
  /** Set right after a backup is restored: the password was overwritten with
   * whatever the backup carried, so nothing works until a fresh one replaces
   * it. */
  must_change_password: boolean
  /** The whole permission system: an admin manages accounts and owns no games. */
  is_admin: boolean
  created_at: string
  updated_at: string
}

/** Response of `GET /api/setup`. */
export interface SetupStatus {
  /** Whether the deployment still has no accounts at all. */
  pending: boolean
  /** What the admin account will be called. */
  admin_username: string
}
