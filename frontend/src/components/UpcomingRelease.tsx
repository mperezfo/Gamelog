import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { CalendarIcon } from './icons'
import { useEdgeFade } from '../hooks/useEdgeFade'
import { errorMessage } from '../api/client'
import { useUpdateGame } from '../hooks/useGames'
import { useIgdbReleaseDates, useMetadataCapabilities } from '../hooks/useMetadata'
import { useDateFormat } from '../hooks/useSession'
import { coverFocalStyle, preloadImage } from '../lib/cover'
import { formatDate } from '../lib/format'
import { gameInput } from '../lib/gameInput'
import { daysUntilRelease, isUnreleased, upcomingGames } from '../lib/upcoming'
import type { Game } from '../types/game'
import { CoverImage } from './CoverImage'
import { Emoji } from './Emoji'

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
  const [nextEl, setNextEl] = useState<HTMLDivElement | null>(null)
  const [nextHeight, setNextHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!nextEl) return
    const observer = new ResizeObserver(() => setNextHeight(nextEl.getBoundingClientRect().height))
    observer.observe(nextEl)
    return () => observer.disconnect()
  }, [nextEl])

  const upcoming = upcomingGames(games)

  // What IGDB says now about the dates of the games still to come that are
  // linked to it: dates move until a game is out. Never asked about one
  // already out, whose date is often not IGDB's on purpose (an earlier
  // release in Japan, an early access).
  const capabilities = useMetadataCapabilities()
  const linked = upcoming.filter((game) => game.igdb_id !== null && isUnreleased(game))
  const igdb = useIgdbReleaseDates(
    linked.map((game) => game.igdb_id!),
    Boolean(capabilities.data?.identify),
  )
  const igdbDates = new Map((igdb.data ?? []).map((entry) => [entry.igdb_id, entry.release_date?.slice(0, 10)]))

  /** The date IGDB has now for a game, when it is another one, known to the
   * day, and still to come: a date IGDB says has passed is more likely an
   * earlier release elsewhere than a game out early. */
  function newDate(game: Game): string | undefined {
    if (game.igdb_id === null || !isUnreleased(game)) return undefined
    const date = igdbDates.get(game.igdb_id)
    if (!date || date === game.release_date?.slice(0, 10) || !isUnreleased({ release_date: date })) return undefined
    return date
  }

  if (upcoming.length === 0) {
    return <p className="px-1.5 py-3 text-xs text-ink-faint">Nothing on the horizon — set a release date on a game to see it here.</p>
  }

  const [next, ...rest] = upcoming
  const days = daysUntilRelease(next.release_date!)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:max-h-48">
      {/* A card the whole of which opens the game, with the date IGDB has
          now, if it is another one, offered on top of it: the button
          covers the card rather than holding it, since a button cannot
          hold another. */}
      <div
        ref={setNextEl}
        onPointerEnter={() => preloadImage(next.cover_image_url)}
        className="relative flex min-w-0 flex-1 items-center gap-4 rounded-control bg-raised p-3 shadow-card transition-colors duration-75 hover:bg-hover sm:p-4"
      >
        <button
          type="button"
          onClick={() => onSelectGame(next)}
          aria-label={next.title}
          className="absolute inset-0 rounded-control"
        />
        <CoverImage
          url={next.cover_image_url}
          size="md"
          className="aspect-[3/4] w-20 rounded-control bg-well sm:w-28"
          style={coverFocalStyle(next)}
          iconClassName="size-6"
          lazy={false}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1 text-xs font-medium text-accent">
            <CalendarIcon className="size-3.5" />
            Next up
          </span>
          <span className="truncate text-sm font-semibold text-ink sm:text-base"><Emoji value={next.title} /></span>
          <span className="truncate text-xs text-ink-faint">{formatDate(next.release_date, dateFormat)}</span>
          {days === 0 ? (
            <span className="mt-1 text-2xl leading-none font-bold text-accent sm:text-3xl">Out now</span>
          ) : (
            <>
              <span className="mt-1 text-3xl leading-none font-bold text-accent sm:text-4xl">{days}</span>
              <span className="text-xs font-medium text-ink-muted">{days === 1 ? 'day to go' : 'days to go'}</span>
            </>
          )}
          <NewDate game={next} date={newDate(next)} className="mt-1 text-xs" />
        </div>
      </div>

      {rest.length > 0 && (
        <div
          className="flex max-h-48 w-full min-h-0 flex-col rounded-control bg-raised p-1.5 shadow-card sm:h-[--next-h] sm:w-64"
          style={nextHeight != null ? ({ '--next-h': `${nextHeight}px` } as CSSProperties) : undefined}
        >
          <div ref={fadeRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {rest.map((game) => (
              <div
                key={game.id}
                onPointerEnter={() => preloadImage(game.cover_image_url)}
                className="relative flex items-center gap-2 rounded-control px-1.5 py-1.5 transition-colors duration-75 hover:bg-hover"
              >
                <button
                  type="button"
                  onClick={() => onSelectGame(game)}
                  aria-label={game.title}
                  className="absolute inset-0 rounded-control"
                />
                <CoverImage
                  url={game.cover_image_url}
                  size="sm"
                  className="size-8 rounded-[3px] bg-well"
                  style={coverFocalStyle(game)}
                  iconClassName="size-3.5"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-medium text-ink"><Emoji value={game.title} /></span>
                  <span className="truncate text-[11px] text-ink-faint">{formatDate(game.release_date, dateFormat)}</span>
                  <NewDate game={game} date={newDate(game)} className="text-[11px]" short />
                </span>
                <OutIn releaseDate={game.release_date!} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** A list row's countdown, or "Out now" on release day. */
function OutIn({ releaseDate }: { releaseDate: string }) {
  const days = daysUntilRelease(releaseDate)
  return (
    <span className={`shrink-0 text-[11px] font-medium ${days === 0 ? 'text-accent' : 'text-ink-faint'}`}>
      {days === 0 ? 'Out now' : `${days}d`}
    </span>
  )
}

/**
 * The release date IGDB has now for a game, when it is another one: said
 * quietly, with Apply to save it. Nothing is written without it.
 *
 * Drawn above the button that covers the card or row it is in (see
 * UpcomingRelease), so that its own button can be pressed.
 */
function NewDate({
  game,
  date,
  className,
  short = false,
}: {
  game: Game
  date: string | undefined
  className: string
  /** For a narrow row: "IGDB:" rather than "IGDB now says". */
  short?: boolean
}): ReactNode {
  const dateFormat = useDateFormat()
  const update = useUpdateGame()
  if (!date) return null

  return (
    <span className={`relative z-10 flex min-w-0 flex-wrap items-baseline gap-x-1 self-start text-ink-muted ${className}`}>
      {update.isError ? (
        <span className="text-danger">Not saved: {errorMessage(update.error)}</span>
      ) : (
        <>
          <span>
            {short ? 'IGDB:' : 'IGDB now says'} {formatDate(`${date}T00:00:00Z`, dateFormat)}
          </span>
          <span aria-hidden="true" className="text-ink-faint">·</span>
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: game.id, input: gameInput(game, { release_date: `${date}T00:00:00Z` }) })}
            className="font-medium text-accent hover:underline disabled:opacity-50"
          >
            Apply
          </button>
        </>
      )}
    </span>
  )
}
