/** The arithmetic behind the Stats page: plain functions over the library
 * the app already holds, so the page needs nothing from the server that the
 * dashboard does not already load. */

import type { Dispatch, FocusEvent, PointerEvent, SetStateAction } from 'react'

import type { Game } from '../types/game'
import type { Lookup } from '../types/lookup'
import { MONTH_ABBREVIATIONS, yearOf } from './format'
import { formatRange } from './range'
import { AGE_BANDS, YEAR_DAYS, daysAfterRelease, inAgeRange } from './releaseAge'

/** A game whose share of the charts can be picked out: a row of a breakdown,
 * a band of release age, a range of scores. */
export interface Highlight {
  key: string
  label: string
  test: (game: Game) => boolean
  /** A platform's own colour, painted through the `tint-fill` utility. Null
   * means the accent. */
  color: string | null
}

/** One bar of the time chart: a year, or a month of one. */
export interface Bucket {
  key: string
  label: string
  /** For a narrow screen: "'19" for a year, "J" for January. */
  short: string
  games: Game[]
}

/** One row of a ranked list, and what picking it out highlights. */
export interface Share extends Highlight {
  count: number
  /** The platform or genre itself, to draw its badge or emoji. Null for
   * rows that are not a lookup, such as "No platform". */
  lookup: Lookup | null
  /** The Games page showing the same games, when it can filter for them. */
  href: string | null
  /** The row for games with none of them ("No platform"), drawn quieter. */
  none?: boolean
}

export type BreakdownKind = 'platforms' | 'genres' | 'developers' | 'publishers'

/** The month (0 for January) out of a date-only ISO string. Read from the
 * string rather than a Date, for the reason calendarDate gives. */
function monthOf(date: string): number {
  return Number(date.slice(5, 7)) - 1
}

/** What the page is about: games finished, each on the date it was logged. */
export function playedGames(games: Game[]): Game[] {
  return games.filter((game) => game.status === 'played' && game.logged_date)
}

/** Every year something was played in, newest first. */
export function playedYears(played: Game[]): string[] {
  const years = new Set(played.map((game) => yearOf(game.logged_date)))
  return Array.from(years).sort((a, b) => Number(b) - Number(a))
}

export function inYear(played: Game[], year: string): Game[] {
  return year ? played.filter((game) => yearOf(game.logged_date) === year) : played
}

/** One bucket per year from the first to the last, including any year with
 * nothing in it: a gap is part of the story. */
export function yearBuckets(played: Game[]): Bucket[] {
  const years = playedYears(played).map(Number)
  if (years.length === 0) return []

  const buckets: Bucket[] = []
  for (let year = Math.min(...years); year <= Math.max(...years); year++) {
    const key = String(year)
    buckets.push({ key, label: key, short: `'${key.slice(2)}`, games: inYear(played, key) })
  }
  return buckets
}

/** The twelve months of `year`, given only that year's games. */
export function monthBuckets(gamesOfYear: Game[]): Bucket[] {
  return MONTH_ABBREVIATIONS.map((label, month) => ({
    key: String(month),
    label,
    short: label[0],
    games: gamesOfYear.filter((game) => monthOf(game.logged_date!) === month),
  }))
}

export function averageScore(games: Game[]): number | null {
  const scores = games.map((game) => game.score).filter((score): score is number => score != null)
  if (scores.length === 0) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

/** The Games page's own filters for the same games: status, the year when
 * the page has one, plus whatever names the row. */
function gamesHref(year: string, params: Record<string, string>): string {
  const query = new URLSearchParams({ status: 'played', ...(year ? { playedYear: year } : {}), ...params })
  return `/games?${query}`
}

const LOOKUP_FIELD: Record<Exclude<BreakdownKind, 'platforms'>, 'genres' | 'developers' | 'publishers'> = {
  genres: 'genres',
  developers: 'developers',
  publishers: 'publishers',
}

/** Singular, for the Games page's filter key and the empty row. */
const FILTER_KEY: Record<BreakdownKind, string> = {
  platforms: 'platform',
  genres: 'genre',
  developers: 'developer',
  publishers: 'publisher',
}

const NONE_LABEL: Record<BreakdownKind, string> = {
  platforms: 'No platform',
  genres: 'No genre',
  developers: 'No developer',
  publishers: 'No publisher',
}

/** How many of `played` each platform, genre, developer or publisher
 * accounts for, most first. A game with two genres counts once for each.
 * Games with none come last, as their own row, whatever their number: they
 * are worth seeing, but not worth ranking among the rest. */
export function breakdown(played: Game[], kind: BreakdownKind, year: string): Share[] {
  const lookupsOf = (game: Game): Lookup[] =>
    kind === 'platforms' ? (game.platform ? [game.platform] : []) : (game[LOOKUP_FIELD[kind]] ?? [])

  const counts = new Map<number, { lookup: Lookup; count: number }>()
  let none = 0
  for (const game of played) {
    const lookups = lookupsOf(game)
    if (lookups.length === 0) none++
    for (const lookup of lookups) {
      const entry = counts.get(lookup.id)
      if (entry) entry.count++
      else counts.set(lookup.id, { lookup, count: 1 })
    }
  }

  const rows: Share[] = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.lookup.name.localeCompare(b.lookup.name))
    .map(({ lookup, count }) => ({
      key: `${kind}:${lookup.id}`,
      label: lookup.name,
      count,
      lookup,
      color: kind === 'platforms' ? lookup.color : null,
      test: (game) => lookupsOf(game).some((l) => l.id === lookup.id),
      href: gamesHref(year, { [FILTER_KEY[kind]]: lookup.slug }),
    }))

  if (none > 0) {
    rows.push({
      key: `${kind}:none`,
      label: NONE_LABEL[kind],
      count: none,
      lookup: null,
      none: true,
      color: null,
      test: (game) => lookupsOf(game).length === 0,
      href: gamesHref(year, { missing: kind === 'platforms' ? 'platform' : kind }),
    })
  }
  return rows
}

/** One bar of the score histogram, from `from` up to half a point more. */
export interface ScoreBin extends Highlight {
  from: number
  count: number
}

/** Scores in half-point bins, from the lowest one anyone got up to 10. A
 * perfect 10 shares the last bin with 9.5 and up: a bin of its own would sit
 * past the end of the scale. */
export function scoreBins(played: Game[]): ScoreBin[] {
  const scores = played.map((game) => game.score).filter((score): score is number => score != null)
  if (scores.length === 0) return []

  const binOf = (score: number) => Math.min(Math.floor(score * 2) / 2, 9.5)
  const bins: ScoreBin[] = []
  for (let from = binOf(Math.min(...scores)); from <= 9.5; from += 0.5) {
    const to = from === 9.5 ? '10' : (from + 0.4).toFixed(1)
    bins.push({
      key: `score:${from}`,
      label: `${from.toFixed(1)}–${to}`,
      from,
      count: scores.filter((score) => binOf(score) === from).length,
      color: null,
      test: (game) => game.score != null && binOf(game.score) === from,
    })
  }
  return bins
}

/** How old games were when they were played, in bands, each with the Games
 * page filtered to it, and the middle of it all as a single number of
 * years. */
export function releaseAge(played: Game[], year: string): { bands: Share[]; median: number | null } {
  const ages = played.map(daysAfterRelease).filter((days): days is number => days != null)

  const bands: Share[] = AGE_BANDS.map((band, index) => {
    const test = (game: Game) => inAgeRange(game, band.range)
    return {
      key: `age:${index}`,
      label: band.label,
      count: played.filter(test).length,
      lookup: null,
      color: null,
      href: gamesHref(year, { playedAfter: formatRange(band.range) }),
      test,
    }
  })
  const middle = median(ages)
  return { bands, median: middle == null ? null : middle / YEAR_DAYS }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** "Mar 2024": the month of a date-only ISO string, for a game's logged
 * date in a preview. Just "Mar" where the year goes without saying. */
export function monthLabel(date: string, withYear = true): string {
  const month = MONTH_ABBREVIATIONS[monthOf(date)]
  return withYear ? `${month} ${date.slice(0, 4)}` : month
}

/** How long after its release a game was played, as a person would say it:
 * "Day one", "5 days", "3 weeks", "8 months", "2 years". */
export function formatAfterRelease(days: number): string {
  if (days < 1) return 'Day one'
  if (days < 14) return days < 2 ? '1 day' : `${Math.floor(days)} days`
  if (days < 61) return `${Math.round(days / 7)} weeks`
  return formatYears(days / YEAR_DAYS)
}

/** A number of years as a person would say it: "8 months", "2 years". */
export function formatYears(years: number): string {
  // Months are rounded first, so that 11.7 of them read as "a year" rather
  // than as "12 months".
  const months = Math.max(Math.round(years * 12), 1)
  if (months < 12) return months === 1 ? 'a month' : `${months} months`
  const whole = Math.max(Math.round(years), 1)
  return whole === 1 ? 'a year' : `${whole} years`
}

/** The setter of the previewed highlight, which takes an update as well as a
 * value. */
export type SetPreview = Dispatch<SetStateAction<Highlight | null>>

/** What makes an element preview `row` while pointed at or reached with the
 * keyboard. Only a real pointer previews: on a touch screen a tap fires the
 * enter events too, and the preview would then outlast unpinning the row.
 * Focus is the same: only the keyboard's, not the one a click leaves.
 *
 * Leaving or losing focus only ever takes back the element's own preview.
 * Pressing on another row blurs the one clicked before it, and that blur
 * would otherwise wipe the new row's preview while the button is held,
 * flashing the pinned highlight back until the click lands. */
export function previewHandlers(row: Highlight, onPreview: SetPreview) {
  const release = () => onPreview((current) => (current?.key === row.key ? null : current))
  return {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') onPreview(row)
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === 'mouse') release()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.target.matches(':focus-visible')) onPreview(row)
    },
    onBlur: release,
  }
}
