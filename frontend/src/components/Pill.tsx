import { CountryFlag } from './CountryFlag'

/** A small neutral pill for a plain name (a developer, a publisher), with
 * its country's flag when it has one. */
export function Pill({ children, country }: { children: string; country?: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-[4px] bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
      {country && <CountryFlag code={country} />}
      <span className="truncate">{children}</span>
    </span>
  )
}
