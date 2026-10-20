import { useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Game } from '../types/game'
import { useHoverPreview } from '../hooks/useHoverPreview'
import { GamesPreview } from './GamesPreview'
import { Popover } from './Popover'

interface GamesPreviewLinkProps {
  /** The Games page showing the same games. */
  to: string
  /** What the games are, for the preview's heading. */
  label: string
  /** The games to pick from, and which of them are this link's. */
  games: Game[]
  test: (game: Game) => boolean
  /** See GamesPreview. */
  detail?: (game: Game) => ReactNode
  order?: (a: Game, b: Game) => number
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
  detail,
  order,
  onOpenGame,
  tooltip,
  className,
  'aria-label': ariaLabel,
  children,
}: GamesPreviewLinkProps) {
  const anchorRef = useRef<HTMLAnchorElement>(null)
  const preview = useHoverPreview<true>()
  const open = preview.open !== null

  return (
    <span className="contents" onPointerEnter={(event) => preview.enter(true, event)} onPointerLeave={preview.leave}>
      <Link
        ref={anchorRef}
        to={to}
        onClick={preview.close}
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
      <Popover hover anchorRef={anchorRef} open={open} onClose={preview.close} placement="bottom-end" aria-label={`Games: ${label}`}>
        <GamesPreview
          heading={label}
          games={open ? games.filter(test) : []}
          detail={detail}
          order={order}
          onOpenGame={(game) => {
            preview.close()
            onOpenGame(game)
          }}
        />
      </Popover>
    </span>
  )
}
