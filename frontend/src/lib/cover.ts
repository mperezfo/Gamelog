import type { Game } from '../types/game'

/** Inline style for a cover image shown in a non-landscape crop (square or
 * portrait): centers and zooms on the saved focal point instead of the
 * plain geometric center `object-cover` would use on its own. Landscape
 * crops (e.g. the aspect-video cards) don't use this — the focal point is
 * only meaningful relative to the portrait crop it was picked against. */
export function coverFocalStyle(game: Pick<Game, 'cover_focal_x' | 'cover_focal_y' | 'cover_zoom'>) {
  const x = (game.cover_focal_x ?? 0.5) * 100
  const y = (game.cover_focal_y ?? 0.5) * 100
  return {
    objectPosition: `${x}% ${y}%`,
    transform: `scale(${game.cover_zoom ?? 1})`,
    transformOrigin: `${x}% ${y}%`,
  }
}
