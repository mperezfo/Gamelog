import { useEffect, useState, type CSSProperties } from 'react'

import { CalendarIcon } from './icons'
import { useEdgeFade } from '../hooks/useEdgeFade'
import { useDateFormat } from '../hooks/useSession'
import { coverFocalStyle } from '../lib/cover'
import { formatDate } from '../lib/format'
import { daysUntilRelease, upcomingGames } from '../lib/upcoming'
import type { Game } from '../types/game'
import { CoverOverlay } from './CoverOverlay'

interface UpcomingReleaseProps {
  games: Game[]
  onSelectGame: (game: Game) => void
}

/** The next game due out, front and centre for the hype, with whatever else
 * is still to come queued up in a small scrolling box beside it.
 *
 * That box always matches "Next up"'s own height exactly and scrolls
 * internally rather than growing with however many games are left — but
 * flexbox's `items-stretch` only ever grows a shorter sibling to match a
 * taller one, never the reverse, so sizing it that way would have dragged
 * "Next up" itself taller to match a long list instead. The box's height is
 * measured off "Next up" directly and applied as a real pixel value
 * instead, the same approach `boardColumnHeight` uses in Dashboard for the
 * same reason.
 *
 * The fade at the scrollable edges (see useEdgeFade) is applied to an inner
 * wrapper around just the game rows, not to the outer box itself: the outer
 * box keeps its own solid background and crisp rounded corners exactly
 * matching "Next up", and it's the games scrolling past its top/bottom edge
 * that fade into that solid background, not the box's own edge fading into
 * the page behind it. */
export function UpcomingRelease({ games, onSelectGame }: UpcomingReleaseProps) {
  const dateFormat = useDateFormat()
  const fadeRef = useEdgeFade('y')
  const [nextEl, setNextEl] = useState<HTMLButtonElement | null>(null)
  const [nextHeight, setNextHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!nextEl) return
    const observer = new ResizeObserver(() => setNextHeight(nextEl.getBoundingClientRect().height))
    observer.observe(nextEl)
    return () => observer.disconnect()
  }, [nextEl])

  const upcoming = upcomingGames(games)

  if (upcoming.length === 0) {
    return <p className="px-1.5 py-3 text-xs text-ink-faint">Nothing on the horizon — set a release date on a game to see it here.</p>
  }

  const [next, ...rest] = upcoming
  const days = daysUntilRelease(next.release_date!)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:max-h-48">
      <button
        ref={setNextEl}
        type="button"
        onClick={() => onSelectGame(next)}
        className="flex flex-1 items-center gap-4 rounded-control bg-sunken p-3 text-left transition-colors duration-75 hover:bg-hover sm:p-4"
      >
        <div className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-control bg-canvas sm:w-28">
          {next.cover_image_url ? (
            <img
              src={next.cover_image_url}
              alt=""
              className="size-full object-cover"
              style={coverFocalStyle(next)}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-lg font-semibold text-ink-faint">
              {next.title.slice(0, 1)}
            </div>
          )}
          {next.cover_image_url && <CoverOverlay />}
        </div>

        <div className="flex min-w-0 max-w-[16rem] flex-col gap-0.5 sm:max-w-xs">
          <span className="flex items-center gap-1 text-xs font-medium text-accent">
            <CalendarIcon className="size-3.5" />
            Next up
          </span>
          <span className="truncate text-sm font-semibold text-ink sm:text-base">{next.title}</span>
          <span className="truncate text-xs text-ink-faint">{formatDate(next.release_date, dateFormat)}</span>
          <span className="mt-1 text-3xl leading-none font-bold text-accent sm:text-4xl">{days}</span>
          <span className="text-xs font-medium text-ink-muted">{days === 1 ? 'day to go' : 'days to go'}</span>
        </div>
      </button>

      {rest.length > 0 && (
        <div
          className="flex max-h-48 w-full min-h-0 flex-col rounded-control bg-sunken p-1.5 sm:h-[--next-h] sm:w-64"
          style={nextHeight != null ? ({ '--next-h': `${nextHeight}px` } as CSSProperties) : undefined}
        >
          <div ref={fadeRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {rest.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => onSelectGame(game)}
                className="flex items-center gap-2 rounded-control px-1.5 py-1.5 text-left transition-colors duration-75 hover:bg-hover"
              >
                {game.cover_image_url ? (
                  <div className="relative size-8 shrink-0 overflow-hidden rounded-[3px]">
                    <img
                      src={game.cover_image_url}
                      alt=""
                      className="size-full object-cover"
                      style={coverFocalStyle(game)}
                    />
                    <CoverOverlay />
                  </div>
                ) : (
                  <span className="size-8 shrink-0 rounded-[3px] bg-canvas" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-ink">{game.title}</span>
                  <span className="truncate text-[11px] text-ink-faint">{formatDate(game.release_date, dateFormat)}</span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-ink-faint">
                  {daysUntilRelease(game.release_date!)}d
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
