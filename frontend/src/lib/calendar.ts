/** Minimal month-grid math for the release calendar. No date library: a
 * month grid is a handful of integer operations, not worth a dependency. */

export interface MonthDay {
  date: Date
  /** yyyy-mm-dd, matched against a game's release_date. */
  key: string
  inMonth: boolean
  isToday: boolean
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function weekdayLabels(): string[] {
  return WEEKDAY_LABELS
}

/** yyyy-mm-dd in local time, for a Date or the first 10 chars of an ISO string. */
export function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Every cell of a 6-week grid covering `month`, Monday-first. */
export function monthGrid(month: Date): MonthDay[] {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()

  const firstOfMonth = new Date(year, monthIndex, 1)
  // getDay() is Sunday-first; shift so Monday is 0.
  const leadingDays = (firstOfMonth.getDay() + 6) % 7

  const start = new Date(year, monthIndex, 1 - leadingDays)
  const today = dayKey(new Date())

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return {
      date,
      key: dayKey(date),
      inMonth: date.getMonth() === monthIndex,
      isToday: dayKey(date) === today,
    }
  })
}

export function monthLabel(month: Date): string {
  return month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Full month names in the viewer's locale, January first. */
export function monthNames(): string[] {
  return Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' }))
}
