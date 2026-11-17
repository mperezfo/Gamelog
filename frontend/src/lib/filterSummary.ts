import type { FilterField } from '../components/FilterBar'

/** How a field's current value(s) read on its pill: up to two option
 * labels, then a "+N" for the rest, rather than every one spelled out. */
export function valueSummary(field: FilterField, raw: string): string {
  if (field.summary) return field.summary(raw)
  const values = raw ? raw.split(',') : []
  const labels = values.map((v) => field.options.find((o) => o.value === v)?.label ?? v)
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

/** What each active filter reads as on its pill, in the order the fields
 * come: the makings of a name for the whole set. */
export function describeFilters(fields: FilterField[], values: Record<string, string>): string[] {
  return fields.filter((f) => values[f.key]).map((f) => valueSummary(f, values[f.key]))
}
