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

/** The thumbnail sizes `GET /api/images/{name}?size=` serves, by the
 * length of their shorter side: `sm` (160 px) for row icons, search results,
 * the calendar and avatars, `md` (640 px) for cover cards. */
export type ImageSize = 'sm' | 'md'

/** The URL of a stored image's thumbnail at `size`. Only images this
 * deployment stores have thumbnails; any other URL is returned unchanged. */
export function imageUrl(url: string, size: ImageSize): string {
  return url.startsWith('/api/images/') ? `${url}?size=${size}` : url
}

const preloaded = new Set<string>()

/** Starts downloading an image into the browser cache, once per URL, so it
 * is already there by the time something shows it: the full-size cover the
 * crop editor needs, fetched as soon as the pointer reaches the card that
 * opens it. */
export function preloadImage(url: string | null | undefined) {
  if (!url || preloaded.has(url)) return
  preloaded.add(url)
  new Image().src = url
}
