import { coverFocalStyle } from '../lib/cover'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import type { Game } from '../types/game'
import { CoverOverlay } from './CoverOverlay'

interface GameCardProps {
  game: Game
  onClick: () => void
  /** Shrinks the cover art down to a small thumbnail in a single-line row,
   * for the wishlist/pending columns — see Dashboard, where those two hold
   * far more games at once than playing/played and benefit from more
   * fitting in view at once. */
  compact?: boolean
}

/**
 * The dashboard's Library unit: the cover is the main event when there is
 * one, with the title and the first genre underneath it — a plain row when
 * there isn't, rather than a card with an empty box on top of it.
 *
 * Purely presentational: the board wraps it with drag-and-drop (see
 * SortableGameCard in Dashboard.tsx), which is what moves a game between
 * columns now instead of a status dropdown on the card itself.
 */
export function GameCard({ game, onClick, compact = false }: GameCardProps) {
  const genre = game.genres?.[0]
  const unreleased = isUnreleased(game)

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full max-w-[420px] items-center gap-2 rounded-control bg-sunken text-left transition-colors duration-75 hover:bg-hover ${
          game.cover_image_url ? 'py-1 pr-2.5 pl-1' : 'py-2 pr-2.5 pl-2.5'
        } ${unreleased ? UNRELEASED_RING : ''}`}
      >
        {game.cover_image_url && (
          <div className="relative aspect-square size-7 shrink-0 overflow-hidden rounded-[3px] bg-canvas">
            <img
              src={game.cover_image_url}
              alt=""
              className={`size-full object-cover ${unreleased ? UNRELEASED_IMAGE : ''}`}
              style={coverFocalStyle(game)}
            />
            <CoverOverlay />
          </div>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{game.title}</span>
      </button>
    )
  }

  if (!game.cover_image_url) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full max-w-[420px] items-center gap-2 rounded-control bg-sunken px-2.5 py-2.5 text-left transition-colors duration-75 hover:bg-hover ${unreleased ? UNRELEASED_RING : ''}`}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{game.title}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full max-w-[420px] flex-col gap-2 rounded-control bg-sunken p-2 text-left transition-colors duration-75 hover:bg-hover ${unreleased ? UNRELEASED_RING : ''}`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-control bg-canvas">
        <img src={game.cover_image_url} alt="" className={`size-full object-cover ${unreleased ? UNRELEASED_IMAGE : ''}`} />
        <CoverOverlay />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 px-0.5 pb-0.5">
        <span className="truncate text-sm font-medium text-ink">{game.title}</span>
        {genre && (
          <span className="flex items-center gap-1 truncate text-xs text-ink-faint">
            {genre.icon && <span aria-hidden="true">{genre.icon}</span>}
            {genre.name}
          </span>
        )}
      </div>
    </button>
  )
}
