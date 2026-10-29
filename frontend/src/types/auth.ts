/** The longest password the API takes: bcrypt reads no further than 72
 * bytes, so a longer one is refused rather than cut short. */
export const MAX_PASSWORD = 72

/** The longest account name, and the longest name shown in the application,
 * the API takes. */
export const MAX_USERNAME = 64
export const MAX_NAME = 100

/** Which theme the application renders in. */
export type Theme = 'light' | 'dark' | 'system'

/** How a date is written out throughout the application. 'long' is
 * "Dec 31, 2023"; the other three are all-numeric, in year/month/day,
 * day/month/year and month/day/year order respectively. */
export type DateFormat = 'long' | 'ymd' | 'dmy' | 'mdy'

/** Which layout the Games page opens in when its URL carries no `view` of
 * its own. */
export type GamesView = 'table' | 'grid'

/** Which dates the dashboard calendar opens on: when each game came out, or
 * when it was logged. */
export type CalendarView = 'release' | 'logged'

/** Display preferences. They travel with the account rather than the
 * browser, so they follow it across devices and are part of the backup. */
export interface Preferences {
  theme: Theme
  date_format: DateFormat
  games_view: GamesView
  calendar_view: CalendarView
}

/** What an account starts with, and what is shown while it loads, the same
 * as the backend's (see models.Preferences). */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  date_format: 'long',
  games_view: 'table',
  calendar_view: 'release',
}

/** An account, as every endpoint that returns one describes it. */
export interface User extends Preferences {
  id: number
  /** Signs the account in. Not shown anywhere in the application itself. */
  username: string
  /** Shown throughout the application instead of the username. */
  name: string
  avatar_url: string | null
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
