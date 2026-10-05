import { coverFocalStyle } from '../lib/cover'
import { formatScore } from '../lib/format'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import type { Game } from '../types/game'
import { StarIcon } from './icons'
import { CoverOverlay } from './CoverOverlay'

interface GameCoverCardProps {
  game: Game
  onClick: () => void
  /** A small line under the title — a genre, a tagline. */
  caption?: string
  /** Overrides the fixed width the horizontal galleries use, for a card
   * that instead fills a grid cell. */
  className?: string
}

/** A poster: cover art first, everything else underneath in small text.
 * The gallery unit for "Top rated" and "Best of each genre", and — sized
 * wider — the Games page's grid view. */
export function GameCoverCard({ game, onClick, caption, className = 'w-32 shrink-0' }: GameCoverCardProps) {
  const unreleased = isUnreleased(game)
  return (
    <button type="button" onClick={onClick} className={`flex flex-col gap-1.5 text-left ${className}`}>
      <div className={`relative aspect-[3/4] w-full overflow-hidden rounded-control bg-sunken ${unreleased ? UNRELEASED_RING : ''}`}>
        {game.cover_image_url ? (
          <img
            src={game.cover_image_url}
            alt=""
            className={`size-full object-cover ${unreleased ? UNRELEASED_IMAGE : ''}`}
            style={coverFocalStyle(game)}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-lg font-semibold text-ink-faint">
            {game.title.slice(0, 1)}
          </div>
        )}
        {game.cover_image_url && <CoverOverlay />}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink">{game.title}</span>
        <span className="flex items-center gap-1 truncate text-xs text-ink-faint">
          {game.score != null && (
            <span className="flex shrink-0 items-center gap-0.5">
              <StarIcon className="size-3" />
              {formatScore(game.score)}
            </span>
          )}
          {caption && <span className="truncate">{caption}</span>}
        </span>
      </div>
    </button>
  )
}
