import { formatScore } from '../lib/format'
import { previewHandlers, type Highlight, type SetPreview, type ScoreBin } from '../lib/stats'

interface ScoreHistogramProps {
  bins: ScoreBin[]
  average: number | null
  activeKey: string | null
  pinnedKey: string | null
  onPreview: SetPreview
  onPin: (bin: Highlight) => void
}

/**
 * How scores spread, in half points: whether a 9 is rare or routine. Each
 * bar picks its games out of the chart above like a row of the breakdown,
 * so "which years did I love the most games" is one point away.
 */
export function ScoreHistogram({ bins, average, activeKey, pinnedKey, onPreview, onPin }: ScoreHistogramProps) {
  if (bins.length === 0) return null

  const max = Math.max(1, ...bins.map((bin) => bin.count))
  const first = bins[0].from

  return (
    <div className="flex flex-col gap-1.5">
      {/* Touching hit areas, like BarList's rows: the gap between bars is
          each one's own padding, so moving across them never lands on
          nothing in between. */}
      <div className="relative flex h-24 items-end border-b border-line">
        {average != null && (
          <span
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-ink-faint"
            style={{ left: `${((average - first) / (10 - first)) * 100}%` }}
            aria-hidden="true"
          />
        )}
        {bins.map((bin) => {
          const active = bin.key === activeKey
          return (
            <button
              key={bin.key}
              type="button"
              aria-pressed={bin.key === pinnedKey}
              aria-label={`${bin.label}: ${bin.count} games`}
              data-tooltip={`${bin.label}: ${bin.count} game${bin.count === 1 ? '' : 's'}`}
              {...previewHandlers(bin, onPreview)}
              onClick={() => onPin(bin)}
              className="group flex h-full min-w-0 flex-1 items-end px-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span
                className={[
                  'block w-full rounded-t-[2px] transition-[height,background-color] duration-200 ease-out motion-reduce:transition-none',
                  active ? 'bg-accent' : 'bg-line-strong group-hover:bg-ink-faint/60',
                ].join(' ')}
                style={{ height: `${(bin.count / max) * 100}%` }}
              />
            </button>
          )
        })}
      </div>

      <div className="flex" aria-hidden="true">
        {bins.map((bin) => (
          <span key={bin.key} className="min-w-0 flex-1 text-center text-[11px] text-ink-faint">
            {Number.isInteger(bin.from) ? bin.from : ''}
          </span>
        ))}
      </div>

      {average != null && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <span className="h-3 border-l border-dashed border-ink-faint" aria-hidden="true" />
          <span className="tabular-nums">Average {formatScore(average)}</span>
        </p>
      )}
    </div>
  )
}
