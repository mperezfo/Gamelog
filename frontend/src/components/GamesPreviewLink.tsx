import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useEdgeFade } from '../hooks/useEdgeFade'
import { formatScore } from '../lib/format'
import type { Game } from '../types/game'
import { CoverImage } from './CoverImage'
import { Emoji } from './Emoji'
import { Popover } from './Popover'

/** How long the pointer rests on the link before the preview opens, so that
 * passing over it on the way somewhere else does not flash it. */
const OPEN_DELAY_MS = 300

/** How long the preview stays once the pointer has left both the link and
 * the preview, so that a pointer cutting a corner between them does not
 * close it. */
const CLOSE_GRACE_MS = 150

interface GamesPreviewLinkProps {
  /** The Games page showing the same games. */
  to: string
  /** Names the preview for assistive technology. */
  label: string
  /** The games to pick from, and which of them are this link's. */
  games: Game[]
  test: (game: Game) => boolean
  onOpenGame: (game: Game) => void
  tooltip: string
  className: string
  'aria-label': string
  children: ReactNode
}

/**
 * A link to the Games page that, pointed at with a mouse, also previews the
 * games it leads to in a popup right below it, so that they can be looked
 * over without leaving the page. A click still follows the link, and a game
 * in the preview opens its panel. A touch screen has no hover, so there it is
 * only the link.
 *
 * The preview is drawn into `document.body` but is still this component's
 * child in React's tree, and React sends enter and leave events along that
 * tree: moving from the link into the preview is not leaving either, here or
 * in anything around it (the row the link belongs to stays previewed).
 */
export function GamesPreviewLink({
  to,
  label,
  games,
  test,
  onOpenGame,
  tooltip,
  className,
  'aria-label': ariaLabel,
  children,
}: GamesPreviewLinkProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLAnchorElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function after(ms: number, next: boolean) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }

  function close() {
    clearTimeout(timer.current)
    setOpen(false)
  }

  function handleEnter(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    if (open) clearTimeout(timer.current)
    else after(OPEN_DELAY_MS, true)
  }

  function handleLeave(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return
    if (open) after(CLOSE_GRACE_MS, false)
    else clearTimeout(timer.current)
  }

  return (
    <span className="contents" onPointerEnter={handleEnter} onPointerLeave={handleLeave}>
      <Link
        ref={anchorRef}
        to={to}
        onClick={close}
        // The preview says it better while it shows.
        data-tooltip={open ? undefined : tooltip}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={className}
        // Kept in sight while the pointer is over the preview, which is not
        // over the row as far as CSS knows.
        style={open ? { opacity: 1 } : undefined}
      >
        {children}
      </Link>
      <Popover hover anchorRef={anchorRef} open={open} onClose={close} placement="bottom-end" aria-label={label}>
        <GamesPreview
          games={games}
          test={test}
          onOpenGame={(game) => {
            close()
            onOpenGame(game)
          }}
        />
      </Popover>
    </span>
  )
}

function GamesPreview({
  games,
  test,
  onOpenGame,
}: {
  games: Game[]
  test: (game: Game) => boolean
  onOpenGame: (game: Game) => void
}) {
  // Newest logged first. Only worked out while the preview is open, which
  // is the only time this is drawn.
  const matching = useMemo(
    () => games.filter(test).sort((a, b) => (b.logged_date ?? '').localeCompare(a.logged_date ?? '')),
    [games, test],
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

  // The page does not scroll under the preview: a wheel over it scrolls the
  // list, and once the list is at its end (or too short to scroll at all),
  // nothing. Not passive, to be able to say so.
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
    <div ref={setRoot} className="flex w-72 max-w-[calc(100vw-24px)] flex-col">
      <p className="border-b border-line px-3 py-2 text-xs text-ink-faint">
        {matching.length === 1 ? '1 game' : `${matching.length} games`}
      </p>
      <div
        ref={setList}
        className="max-h-[min(20rem,calc(var(--popover-available-height)-3rem))] overflow-y-auto overscroll-contain p-1"
      >
        {matching.map((game) => (
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
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{formatScore(game.score)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
