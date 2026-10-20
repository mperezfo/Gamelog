import { useRef, type CSSProperties, type PointerEvent } from 'react'

import { formatScore } from '../lib/format'
import { averageScore, type Bucket, type Highlight } from '../lib/stats'
import type { Game } from '../types/game'
import { useHoverPreview } from '../hooks/useHoverPreview'
import { GamesPreview } from './GamesPreview'
import { PlatformBadge } from './PlatformBadge'
import { Popover } from './Popover'

interface PlayedChartProps {
  buckets: Bucket[]
  /** A slice of the games to pick out inside every bar, and to average in
   * the score strip instead of everything. */
  highlight: Highlight | null
  /** Makes each bar a button: a year opens its months. */
  onSelect?: (key: string) => void
  /** The year the bars are the months of, or empty when they are years. */
  year: string
  /** Pointing at a bar previews its games (the highlighted ones, when
   * something is), with the platform of each; this opens one of them. */
  onOpenGame?: (game: Game) => void
}

/** Past this many bars, a phone shows "'19" and "J" instead of "2019" and
 * "Jan". */
const MAX_FULL_LABELS = 8

/** Room above the tallest bar for its number. */
const LABEL_ROOM = '16px'

/**
 * Games played per year, or per month of one, with their average score in
 * a strip underneath that shares the same columns.
 *
 * Built by hand like GameCalendar: a bar is a div with a height, and the
 * theme's own roles colour it. Bars are a single quiet tone, so that a
 * highlighted slice (a platform, a genre, a range of scores) is the one
 * thing in colour, and their number sits on top of them in place of an axis.
 *
 * Averages barely move from one year to the next (a library scored between
 * 7 and 9 averages around 8 every year), so the strip spreads them over
 * just the range they cover rather than 0 to 10, where they would read as
 * one flat line. The numbers say what the dots only hint at.
 */
export function PlayedChart({ buckets, highlight, onSelect, year, onOpenGame }: PlayedChartProps) {
  const preview = useHoverPreview<string>()
  // The bar the preview hangs off, set as the pointer reaches it.
  const anchorRef = useRef<HTMLElement | null>(null)
  const max = Math.max(1, ...buckets.map((bucket) => bucket.games.length))
  const shortOnPhone = buckets.length > MAX_FULL_LABELS

  const columns = buckets.map((bucket) => {
    const marked = highlight ? bucket.games.filter(highlight.test) : bucket.games
    return { bucket, marked, average: averageScore(marked) }
  })

  const all = buckets.flatMap((bucket) => bucket.games)
  const overall = averageScore(highlight ? all.filter(highlight.test) : all)
  const averages = columns.map((column) => column.average).filter((average): average is number => average != null)
  const low = Math.min(...averages, overall ?? Infinity) - 0.1
  const high = Math.max(...averages, overall ?? -Infinity) + 0.1
  // From 4px up to 28px of a 48px strip, which leaves the top for the number
  // over the highest dot.
  const dotBottom = (average: number) => `${4 + ((average - low) / (high - low || 1)) * 24}px`

  const previewed = columns.find((column) => column.bucket.key === preview.open)
  const heading = (bucket: Bucket) =>
    [year ? `${bucket.label} ${year}` : bucket.label, highlight?.label].filter(Boolean).join(', ')

  const tint = highlight?.color ? ({ '--tint': highlight.color } as CSSProperties) : undefined
  const fill = highlight?.color ? 'tint-fill' : 'bg-accent'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-40 items-end gap-1 border-b border-line sm:h-44 sm:gap-2" style={tint}>
        {columns.map(({ bucket, marked }) => {
          const count = bucket.games.length
          const label = `${bucket.label}: ${tooltipCount(count, marked.length, highlight)}`
          const Bar = onSelect ? 'button' : 'div'
          const previewable = Boolean(onOpenGame) && marked.length > 0

          return (
            <div key={bucket.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {count > 0 && (
                <span
                  className={`mb-1 text-[11px] leading-none tabular-nums ${highlight && marked.length > 0 ? 'font-medium text-ink' : 'text-ink-faint'}`}
                >
                  {marked.length}
                </span>
              )}
              <Bar
                {...(onSelect
                  ? {
                      type: 'button' as const,
                      onClick: () => {
                        preview.close()
                        onSelect(bucket.key)
                      },
                      'aria-label': label,
                    }
                  : {})}
                {...(previewable
                  ? {
                      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
                        anchorRef.current = event.currentTarget
                        preview.enter(bucket.key, event)
                      },
                      onPointerLeave: preview.leave,
                    }
                  : {})}
                // The preview says it better while it shows.
                data-tooltip={count > 0 && preview.open !== bucket.key ? label : undefined}
                className={[
                  'flex w-full max-w-12 flex-col justify-end overflow-hidden rounded-t-[3px] bg-line-strong',
                  'transition-[height,background-color] duration-200 ease-out motion-reduce:transition-none',
                  onSelect && count > 0 ? 'cursor-pointer hover:bg-ink-faint/60' : '',
                ].join(' ')}
                style={{ height: `calc((100% - ${LABEL_ROOM}) * ${count / max})` }}
              >
                {highlight && marked.length > 0 && (
                  <span
                    className={`block w-full transition-[height] duration-200 ease-out motion-reduce:transition-none ${fill}`}
                    style={{ height: `${(marked.length / count) * 100}%` }}
                  />
                )}
              </Bar>
            </div>
          )
        })}
      </div>

      {/* Keyed by the bar, so that moving to the next one places the
          preview under it afresh. */}
      <Popover
        key={preview.open ?? ''}
        hover
        anchorRef={anchorRef}
        open={Boolean(previewed && onOpenGame)}
        onClose={preview.close}
        placement="bottom"
        aria-label={previewed ? `Games: ${heading(previewed.bucket)}` : undefined}
        onPointerEnter={preview.keep}
        onPointerLeave={preview.leave}
      >
        {previewed && onOpenGame && (
          <GamesPreview
            heading={heading(previewed.bucket)}
            games={previewed.marked}
            detail={(game) => <PlatformBadge platform={game.platform} />}
            onOpenGame={(game) => {
              preview.close()
              onOpenGame(game)
            }}
          />
        )}
      </Popover>

      <div className="flex gap-1 sm:gap-2" aria-hidden="true">
        {buckets.map((bucket) => (
          <span key={bucket.key} className="min-w-0 flex-1 text-center text-[11px] text-ink-faint">
            {shortOnPhone ? (
              <>
                <span className="sm:hidden">{bucket.short}</span>
                <span className="hidden sm:inline">{bucket.label}</span>
              </>
            ) : (
              bucket.label
            )}
          </span>
        ))}
      </div>

      {/* Always there, empty or not. A slice with no scores in this period
          (PS5 in a year with none) would otherwise drop the strip, moving
          everything under it up; pointing at the next row brings it back,
          moving that row out from under the pointer, and the two chase each
          other in a loop. */}
      <div className="mt-3 flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          Average score
          {overall != null && <span className="w-3 border-t border-dashed border-ink-faint" aria-hidden="true" />}
          <span className="min-w-0 truncate tabular-nums">
            {overall != null
              ? `${formatScore(overall)} ${highlight ? `for ${highlight.label}` : 'overall'}`
              : `· no scores${highlight ? ` for ${highlight.label}` : ''}`}
          </span>
        </p>
        <div className="relative flex h-12 gap-1 sm:gap-2" style={tint}>
          {overall != null && (
            <span
              className="absolute inset-x-0 border-t border-dashed border-line-strong"
              style={{ bottom: dotBottom(overall) }}
              aria-hidden="true"
            />
          )}
          {columns.map(({ bucket, marked, average }) => (
            <div key={bucket.key} className="relative min-w-0 flex-1">
              {average != null && (
                <div
                  className="absolute inset-x-0 flex translate-y-[3px] flex-col items-center gap-0.5"
                  style={{ bottom: dotBottom(average) }}
                  data-tooltip={`${bucket.label}: average ${formatScore(average)} over ${plural(marked.length, 'game')}`}
                >
                  <span className="text-[11px] leading-none tabular-nums text-ink-muted">{formatScore(average)}</span>
                  <span className={`size-1.5 rounded-full ${highlight ? fill : 'bg-ink-muted'}`} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function tooltipCount(count: number, marked: number, highlight: Highlight | null): string {
  return highlight ? `${marked} of ${count} (${highlight.label})` : plural(count, 'game')
}
