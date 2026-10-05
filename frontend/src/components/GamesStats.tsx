import { useState } from 'react'

import { ChevronDownIcon, ChevronUpIcon } from './icons'

export interface GamesStatsData {
  count: number
  average: number | null
  releaseSpan: string | null
  releaseRange: string | null
  loggedSpan: string | null
  loggedRange: string | null
}

/** The footer under the Games list. From `sm` up it is a single row with
 * every figure. On a phone only the count and the average score stay
 * visible, as one line that doubles as the toggle for the date ranges, so
 * the footer costs a single row of height instead of two or three. The
 * ranges then read as more lines of the same list: same type, same gap. */
export function GamesStats({ stats }: { stats: GamesStatsData }) {
  const [open, setOpen] = useState(false)
  const hasRanges = stats.releaseSpan != null || stats.loggedSpan != null
  const Chevron = open ? ChevronDownIcon : ChevronUpIcon

  const summary = (
    <>
      <span>{stats.count} games</span>
      {stats.average != null && <span>Average score: {stats.average.toFixed(1)}</span>}
    </>
  )
  const ranges = (
    <>
      {stats.releaseSpan && <span title={stats.releaseRange ?? undefined}>Release range: {stats.releaseSpan}</span>}
      {stats.loggedSpan && <span title={stats.loggedRange ?? undefined}>Logged range: {stats.loggedSpan}</span>}
    </>
  )

  return (
    <div className="shrink-0 border-t border-line text-xs text-ink-faint">
      <div className="hidden flex-wrap items-center gap-x-6 gap-y-1 px-6 py-2 sm:flex">
        {summary}
        {ranges}
      </div>

      <div className="px-4 py-2 sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={!hasRanges}
          aria-expanded={hasRanges ? open : undefined}
          className="-my-1 flex w-full items-center justify-between py-1 text-left"
        >
          <span className="flex items-center gap-x-4">{summary}</span>
          {hasRanges && <Chevron className="size-4" />}
        </button>

        {/* A 0fr → 1fr grid row animates to the content's natural height,
         * which a plain `height` transition cannot do. */}
        <div
          aria-hidden={!open}
          className={`grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none ${
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-1.5 pt-1.5">{ranges}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
