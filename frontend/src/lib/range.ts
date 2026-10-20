/** A range of amounts, each with a unit ("2y", "6m"), as a filter keeps it
 * in the URL: the two bounds joined by a dash, either of them left out for
 * an open end ("1m-6m", "2y-", "-7d"). The unit is a single letter whose
 * meaning is the filter's own. */

export interface Bound {
  amount: number
  unit: string
}

export interface Range {
  /** Included. Null for no lower bound. */
  from: Bound | null
  /** Excluded. Null for no upper bound. */
  to: Bound | null
}

const BOUND = /^(\d+)([a-z])$/

function parseBound(raw: string): Bound | null | undefined {
  if (!raw) return null
  const match = BOUND.exec(raw)
  return match ? { amount: Number(match[1]), unit: match[2] } : undefined
}

/** The range in `raw`, or null for one that is not a range at all, or has
 * neither bound. */
export function parseRange(raw: string): Range | null {
  const parts = raw.split('-')
  if (parts.length !== 2) return null
  const from = parseBound(parts[0])
  const to = parseBound(parts[1])
  if (from === undefined || to === undefined || (!from && !to)) return null
  return { from, to }
}

export function formatRange({ from, to }: Range): string {
  const bound = (b: Bound | null) => (b ? `${b.amount}${b.unit}` : '')
  return `${bound(from)}-${bound(to)}`
}
