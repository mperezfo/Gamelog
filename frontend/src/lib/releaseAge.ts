/** How long after its release a game was played: the Stats page's "Age
 * when played" bands and the Games page's filter for the same thing, kept
 * in one place so that every band reads as exactly one filter. */

import type { Game } from '../types/game'
import { parseRange, type Bound, type Range } from './range'

export const YEAR_DAYS = 365.25

/** The units a bound is given in, by the letter the URL keeps. */
export const AGE_UNITS = [
  { value: 'd', label: 'days' },
  { value: 'm', label: 'months' },
  { value: 'y', label: 'years' },
]

const UNIT_DAYS: Record<string, number> = { d: 1, m: YEAR_DAYS / 12, y: YEAR_DAYS }

const UNIT_NAMES: Record<string, { one: string; many: string }> = {
  d: { one: 'day', many: 'days' },
  m: { one: 'month', many: 'months' },
  y: { one: 'year', many: 'years' },
}

/** How many days after it came out a game was played, or null for one
 * missing either date. Logged before its release (early access, a review
 * copy) counts as no time at all. */
export function daysAfterRelease(game: Game): number | null {
  if (!game.release_date || !game.logged_date) return null
  const days = (Date.parse(game.logged_date.slice(0, 10)) - Date.parse(game.release_date.slice(0, 10))) / 86_400_000
  return Math.max(days, 0)
}

export function boundDays(bound: Bound): number {
  return bound.amount * (UNIT_DAYS[bound.unit] ?? NaN)
}

/** Whether `game` was played inside `range`: from its lower bound, included,
 * up to its upper one, excluded, so that neighbouring ranges never share a
 * game. */
export function inAgeRange(game: Game, range: Range): boolean {
  const days = daysAfterRelease(game)
  if (days == null) return false
  if (range.from && days < boundDays(range.from)) return false
  if (range.to && days >= boundDays(range.to)) return false
  return true
}

/** Finer near release, where habits differ most (launch week and a few
 * months later are not the same thing), and coarser further out, where a
 * year more or less says little. */
export const AGE_BANDS: { label: string; range: Range }[] = [
  { label: 'Launch week', range: { from: null, to: { amount: 7, unit: 'd' } } },
  { label: 'First month', range: { from: { amount: 7, unit: 'd' }, to: { amount: 1, unit: 'm' } } },
  { label: '1–6 months', range: { from: { amount: 1, unit: 'm' }, to: { amount: 6, unit: 'm' } } },
  { label: '6–12 months', range: { from: { amount: 6, unit: 'm' }, to: { amount: 1, unit: 'y' } } },
  { label: '1–2 years', range: { from: { amount: 1, unit: 'y' }, to: { amount: 2, unit: 'y' } } },
  { label: '2–3 years', range: { from: { amount: 2, unit: 'y' }, to: { amount: 3, unit: 'y' } } },
  { label: '3–5 years', range: { from: { amount: 3, unit: 'y' }, to: { amount: 5, unit: 'y' } } },
  { label: '5–10 years', range: { from: { amount: 5, unit: 'y' }, to: { amount: 10, unit: 'y' } } },
  { label: '10–20 years', range: { from: { amount: 10, unit: 'y' }, to: { amount: 20, unit: 'y' } } },
  { label: 'Over 20 years', range: { from: { amount: 20, unit: 'y' }, to: null } },
]

/** "1 to 6 months", "2+ years", "under 7 days", for the filter's pill. The
 * unit is only spelled out once when both bounds share it. */
export function describeAgeRange(raw: string): string {
  const range = parseRange(raw)
  if (!range) return raw
  const name = (bound: Bound) => {
    const names = UNIT_NAMES[bound.unit]
    return names ? (bound.amount === 1 ? names.one : names.many) : bound.unit
  }
  const { from, to } = range
  if (from && to) {
    return from.unit === to.unit
      ? `${from.amount} to ${to.amount} ${name(to)}`
      : `${from.amount} ${name(from)} to ${to.amount} ${name(to)}`
  }
  if (from) return `${from.amount}+ ${UNIT_NAMES[from.unit]?.many ?? from.unit}`
  return `under ${to!.amount} ${name(to!)}`
}
