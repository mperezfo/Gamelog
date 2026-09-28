/** Shared formatting for the values that show up across every game view. */

import type { DateFormat } from '../types/auth'

/** Zero-pads a number to two digits, for the numeric date layouts below. */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** The twelve month abbreviations 'long' is written with — index 0 is
 * January, matching `Date#getMonth()`. Fixed in English regardless of the
 * viewer's own browser locale: the project is English-only, and
 * `toLocaleDateString` with no explicit locale was reading whatever locale
 * the browser happened to be in, which could silently violate that. Shared with DateField, whose month dropdown has to offer
 * exactly these twelve spellings for 'long' to stay editable in the same
 * format it's displayed in. */
export const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

export function formatDate(iso: string | null | undefined, format: DateFormat = 'long'): string {
  if (!iso) return '—'
  const date = new Date(iso)

  if (format === 'long') {
    return `${date.getDate()} ${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getFullYear()}`
  }

  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())

  switch (format) {
    case 'ymd':
      return `${year}/${month}/${day}`
    case 'dmy':
      return `${day}/${month}/${year}`
    case 'mdy':
      return `${month}/${day}/${year}`
  }
}

export function formatScore(score: number | null | undefined): string {
  return score != null ? score.toFixed(1) : '—'
}

function earliestAndLatest(dates: (string | null | undefined)[]): [string, string] | null {
  const sorted = dates.filter((d): d is string => !!d).sort()
  if (sorted.length === 0) return null
  return [sorted[0], sorted[sorted.length - 1]]
}

/** The span from the earliest to the latest of a set of dates, as the two
 * dates themselves — "Jan 2020 – Mar 2022" — or null when none of them have
 * one set. Meant for a tooltip: see `dateRangeSpan` for the number-of-time
 * form shown by default. */
export function dateRange(dates: (string | null | undefined)[], format: DateFormat = 'long'): string | null {
  const range = earliestAndLatest(dates)
  if (!range) return null
  const [first, last] = range
  const a = formatDate(first, format)
  const b = formatDate(last, format)
  return a === b ? a : `${a} – ${b}`
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** How much time elapsed between two dates — "2 years", "15 years and 3
 * months", "3 months", "6 days" — rounded down to whichever pair of units
 * reads best, the way a human would describe it rather than an exact
 * duration. */
export function formatDurationSpan(fromIso: string, toIso: string, format: DateFormat = 'long'): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (from.getTime() === to.getTime()) return formatDate(fromIso, format)

  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  if (to.getDate() < from.getDate()) months -= 1

  const years = Math.floor(months / 12)
  const remainingMonths = months % 12

  if (years > 0) {
    return remainingMonths > 0
      ? `${pluralize(years, 'year')} and ${pluralize(remainingMonths, 'month')}`
      : pluralize(years, 'year')
  }

  if (remainingMonths > 0) return pluralize(remainingMonths, 'month')

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  return pluralize(days, 'day')
}

/** The span from the earliest to the latest of a set of dates, as an elapsed
 * duration — "2 years" — or null when none of them have one set. */
export function dateRangeSpan(dates: (string | null | undefined)[], format: DateFormat = 'long'): string | null {
  const range = earliestAndLatest(dates)
  return range ? formatDurationSpan(range[0], range[1], format) : null
}
