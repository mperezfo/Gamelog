import { coverFocalStyle, preloadImage } from '../lib/cover'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import type { Game } from '../types/game'
import { CoverImage } from './CoverImage'

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
 * The dashboard's Library unit: the cover is the main event, with the title
 * and the first genre underneath it. A game without one keeps the same
 * shape, its slot showing that the cover is missing, so every card in a
 * column reads the same way.
 *
 * Purely presentational: the board wraps it with drag-and-drop (see
 * SortableGameCard in Dashboard.tsx), which is what moves a game between
 * columns now instead of a status dropdown on the card itself.
 */
export function GameCard({ game, onClick, compact = false }: GameCardProps) {
  const genre = game.genres?.[0]
  const unreleased = isUnreleased(game)
  // The panel this opens shows the full-size cover: start on it as soon as
  // the pointer (or a finger) reaches the card rather than on the click.
  const preload = () => preloadImage(game.cover_image_url)

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={preload}
        className={`flex w-full max-w-[420px] items-center gap-2 rounded-control bg-sunken py-1 pr-2.5 pl-1 text-left transition-colors duration-75 hover:bg-hover ${unreleased ? UNRELEASED_RING : ''}`}
      >
        <CoverImage
          url={game.cover_image_url}
          size="sm"
          className="aspect-square size-7 rounded-[3px] bg-canvas"
          imageClassName={unreleased ? UNRELEASED_IMAGE : ''}
          style={coverFocalStyle(game)}
          iconClassName="size-3.5"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{game.title}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={preload}
      className={`flex w-full max-w-[420px] flex-col gap-2 rounded-control bg-sunken p-2 text-left transition-colors duration-75 hover:bg-hover ${unreleased ? UNRELEASED_RING : ''}`}
    >
      <CoverImage
        url={game.cover_image_url}
        size="md"
        className="aspect-video w-full rounded-control bg-canvas"
        imageClassName={unreleased ? UNRELEASED_IMAGE : ''}
        iconClassName="size-6"
      />

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
