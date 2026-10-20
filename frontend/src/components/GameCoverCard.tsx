import { coverFocalStyle, preloadImage } from '../lib/cover'
import { formatScore } from '../lib/format'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import type { Game } from '../types/game'
import { CoverImage } from './CoverImage'
import { StarIcon } from './icons'
import { Emoji } from './Emoji'

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
    <button
      type="button"
      onClick={onClick}
      // The panel this opens shows the full-size cover: start on it before
      // the click lands.
      onPointerEnter={() => preloadImage(game.cover_image_url)}
      className={`flex flex-col gap-1.5 text-left ${className}`}
    >
      <CoverImage
        url={game.cover_image_url}
        size="md"
        className={`aspect-[3/4] w-full rounded-control bg-sunken ${unreleased ? UNRELEASED_RING : ''}`}
        imageClassName={unreleased ? UNRELEASED_IMAGE : ''}
        style={coverFocalStyle(game)}
        iconClassName="size-6"
      />

      <div className="flex flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-ink"><Emoji value={game.title} /></span>
        <span className="flex items-center gap-1 truncate text-xs text-ink-faint">
          {game.score != null && (
            <span className="flex shrink-0 items-center gap-0.5">
              <StarIcon className="size-3" />
              {formatScore(game.score)}
            </span>
          )}
          {caption && <span className="truncate"><Emoji value={caption} /></span>}
        </span>
      </div>
    </button>
  )
}
