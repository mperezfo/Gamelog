/** Shared logic for games that have not been released yet: whether a game
 * counts as upcoming, how far away its release is, and the styling used to
 * mark it wherever it shows up (Games, every dashboard panel, Library, the
 * calendar). */

import type { Game } from '../types/game'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Today, as a date-only string in the same "YYYY-MM-DD" shape release_date
 * is stored in — local time, since that's what "today" means to whoever is
 * looking at the screen. */
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** release_date comes back from the API as a full RFC3339 timestamp at
 * midnight UTC ("2026-12-03T00:00:00Z"), not the bare "YYYY-MM-DD" it's
 * edited as — the calendar date it names is always the first 10
 * characters, regardless of the viewer's own timezone (unlike
 * `new Date(iso).getDate()`, which reads it back in local time and can
 * land on the day before for anyone west of UTC). Every comparison below
 * goes through this first so it's never comparing a date against a
 * timestamp. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

/** A game counts as upcoming exactly when its release date is later than
 * today — string comparison is enough since both sides are zero-padded
 * "YYYY-MM-DD". A game releasing today is already out. */
export function isUnreleased(game: Pick<Game, 'release_date'>): boolean {
  return game.release_date != null && dateOnly(game.release_date) > todayIso()
}

/** Whole days between two date-only ISO strings, computed in UTC so the
 * local clock's own DST shifts can't knock the count off by one. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number)
  const [ty, tm, td] = toIso.split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd)
  const to = Date.UTC(ty, tm - 1, td)
  return Math.round((to - from) / 86_400_000)
}

/** How many days remain until a game's release. Only meaningful for a game
 * `isUnreleased` is true for, so the result is always >= 1. */
export function daysUntilRelease(releaseDate: string): number {
  return daysBetween(todayIso(), dateOnly(releaseDate))
}

/** Every unreleased game, soonest first (a tie broken by title so the order
 * is stable). */
export function upcomingGames(games: Game[]): Game[] {
  return games
    .filter(isUnreleased)
    .sort((a, b) => {
      const [aDate, bDate] = [dateOnly(a.release_date!), dateOnly(b.release_date!)]
      return aDate < bDate ? -1 : aDate > bDate ? 1 : a.title.localeCompare(b.title)
    })
}

/** The dashed outline every unreleased game gets wherever it's shown, so it
 * reads at a glance as "not out yet" — Games, every dashboard panel,
 * Library, the calendar. Pair with `UNRELEASED_IMAGE` on the cover art
 * itself where there is one. */
export const UNRELEASED_RING = 'outline outline-dashed outline-1 outline-offset-1 outline-ink-faint/60'

/** Fades and desaturates cover art for a game that hasn't released yet. */
export const UNRELEASED_IMAGE = 'grayscale opacity-60'
