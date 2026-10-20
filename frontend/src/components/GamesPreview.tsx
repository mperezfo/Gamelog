import { useCallback, useMemo, useRef, type ReactNode } from 'react'

import { useEdgeFade } from '../hooks/useEdgeFade'
import { formatScore } from '../lib/format'
import type { Game } from '../types/game'
import { CoverImage } from './CoverImage'
import { Emoji } from './Emoji'

interface GamesPreviewProps {
  /** What the games are ("PC", "2024"), above them with their count. */
  heading: string
  games: Game[]
  /** A word on each game beside its score: when it was played, on what. */
  detail?: (game: Game) => ReactNode
  onOpenGame: (game: Game) => void
}

/**
 * A short list of games in a popup, one compact line each (cover, title,
 * a detail, score), newest logged first, with their count at the top. It
 * scrolls inside itself when it is long, and the page does not scroll under
 * it. A game opens its panel.
 */
export function GamesPreview({ heading, games, detail, onOpenGame }: GamesPreviewProps) {
  const sorted = useMemo(
    () => [...games].sort((a, b) => (b.logged_date ?? '').localeCompare(a.logged_date ?? '')),
    [games],
  )

  const fadeRef = useEdgeFade('y')
  const listRef = useRef<HTMLDivElement | null>(null)
  const setList = useCallback(
    (element: HTMLDivElement | null) => {
      listRef.current = element
      return fadeRef(element)
    },
    [fadeRef],
  )

  // A wheel over the preview scrolls the list, and once the list is at its
  // end (or too short to scroll at all), nothing. Not passive, to be able to
  // say so.
  const setRoot = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    function handleWheel(event: WheelEvent) {
      const list = listRef.current
      const inList = list?.contains(event.target as Node)
      const atTop = !list || list.scrollTop <= 0
      const atBottom = !list || list.scrollTop + list.clientHeight >= list.scrollHeight - 1
      if (!inList || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) event.preventDefault()
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div ref={setRoot} className="flex w-80 max-w-[calc(100vw-24px)] flex-col">
      <p className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line px-3 py-2 text-xs">
        <span className="truncate font-medium text-ink">
          <Emoji value={heading} />
        </span>
        <span className="shrink-0 text-ink-faint">{sorted.length === 1 ? '1 game' : `${sorted.length} games`}</span>
      </p>
      <div
        ref={setList}
        className="max-h-[min(20rem,calc(var(--popover-available-height)-3rem))] overflow-y-auto overscroll-contain p-1"
      >
        {sorted.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => onOpenGame(game)}
            className="flex w-full items-center gap-2.5 rounded-control px-2 py-1 text-left text-[13px] text-ink transition-colors duration-75 hover:bg-hover"
          >
            <CoverImage
              url={game.cover_image_url}
              size="sm"
              className="h-9 w-7 rounded-[3px] bg-sunken"
              iconClassName="size-3.5"
            />
            <span className="min-w-0 flex-1 truncate">
              <Emoji value={game.title} />
            </span>
            {detail && <span className="flex max-w-[40%] shrink-0 text-xs text-ink-faint">{detail(game)}</span>}
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-muted">{formatScore(game.score)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
