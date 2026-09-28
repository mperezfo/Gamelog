import type { Game } from '../types/game'

/**
 * The dashboard board's order within a status column: logged date
 * descending (undated last), and `position` only as a tiebreaker among games
 * that share a date or have none — which is also the only case drag-and-drop
 * reordering is allowed to touch. See migration 00004 on the backend.
 *
 * logged_date rather than release_date: release_date is a fact about the
 * game (when it came out), not a judgement about your relationship to it, so
 * it is not what "most recent first" means here — most games have one and
 * hardly ever share it with another, which would make manual reordering
 * almost never apply. logged_date is when you actually did something with
 * it, and most games do not have one yet, so they group together and stay
 * freely reorderable by hand.
 */
export function compareForBoard(a: Game, b: Game): number {
  if (a.logged_date !== b.logged_date) {
    if (a.logged_date == null) return 1
    if (b.logged_date == null) return -1
    return a.logged_date < b.logged_date ? 1 : -1
  }
  return a.position - b.position
}

/** Whether two games are in the same tie group: same logged_date, or both
 * without one. Reordering across groups would fight the date sort above, so
 * drag-and-drop only commits within one. */
export function sameDateGroup(a: Game, b: Game): boolean {
  return a.logged_date === b.logged_date
}
