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

/** Portrait cards crop with this aspect ratio — see GameCoverCard. */
const PORTRAIT_ASPECT = 3 / 4

/** The portrait crop window, in image pixels: the largest 3:4 box that fits
 * inside the image, since that's what `object-fit: cover` crops down to. */
export function cropSize(natural: { w: number; h: number }) {
  if (natural.w / natural.h > PORTRAIT_ASPECT) {
    const height = natural.h
    return { width: height * PORTRAIT_ASPECT, height }
  }
  const width = natural.w
  return { width, height: width / PORTRAIT_ASPECT }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Inline style for a cover shown in a box of any shape (the game panel's
 * banner, as wide as the screen allows): the image fills the box unzoomed,
 * as `object-fit: cover` would, but slid across whichever axis overflows to
 * centre on the saved portrait crop rather than on the image's own centre.
 *
 * The crop's zoom only says where that centre is. Zooming a box this large
 * would stretch the image past its resolution, which a small card hides and
 * a banner does not.
 *
 * `imageAspect` and `boxAspect` are width / height. Returns nothing for a
 * cover without a saved crop, so the caller keeps its own default. */
export function coverFitStyle(
  game: Pick<Game, 'cover_focal_x' | 'cover_focal_y' | 'cover_zoom'>,
  imageAspect: number,
  boxAspect: number,
) {
  if (game.cover_focal_x == null && game.cover_focal_y == null && game.cover_zoom == null) return undefined

  // In units of the image's height, so the image is imageAspect × 1.
  const image = { w: imageAspect, h: 1 }
  const base = cropSize(image)
  const zoom = game.cover_zoom ?? 1
  const crop = { w: base.width / zoom, h: base.height / zoom }
  const cropCentre = {
    x: (image.w - crop.w) * (game.cover_focal_x ?? 0.5) + crop.w / 2,
    y: (image.h - crop.h) * (game.cover_focal_y ?? 0.5) + crop.h / 2,
  }

  // What `object-fit: cover` shows of the image, centred on the crop as far
  // as the image's edges allow, then as the fraction of how far it can
  // travel across the image that object-position takes.
  const window = imageAspect > boxAspect ? { w: boxAspect, h: 1 } : { w: imageAspect, h: imageAspect / boxAspect }
  const left = clamp(cropCentre.x - window.w / 2, 0, image.w - window.w)
  const top = clamp(cropCentre.y - window.h / 2, 0, image.h - window.h)
  const x = (image.w - window.w > 1e-6 ? left / (image.w - window.w) : 0.5) * 100
  const y = (image.h - window.h > 1e-6 ? top / (image.h - window.h) : 0.5) * 100
  return { objectPosition: `${x}% ${y}%` }
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
