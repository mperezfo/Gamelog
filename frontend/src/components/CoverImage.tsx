import { useCallback, useRef, useState, type CSSProperties } from 'react'

import { imageUrl, type ImageSize } from '../lib/cover'
import { CoverOverlay } from './CoverOverlay'
import { ImageIcon } from './icons'

interface CoverImageProps {
  /** The stored path (or any other URL), or nothing for a game without a
   * cover. */
  url: string | null | undefined
  size: ImageSize
  /** The slot itself: its size, radius and background. */
  className?: string
  /** Added to the image alone, such as UNRELEASED_IMAGE. */
  imageClassName?: string
  /** The image's crop, from coverFocalStyle. */
  style?: CSSProperties
  /** Sized to the slot: a row icon wants a smaller glyph than a poster. */
  iconClassName?: string
  /** Defers the download until the slot nears the viewport. */
  lazy?: boolean
  /** Darkens the edges of the image (see CoverOverlay). */
  overlay?: boolean
  /** Called with the image once it has loaded, to read its size. */
  onLoad?: (image: HTMLImageElement) => void
}

/** How quickly an image has to arrive to count as coming from a cache, in
 * ms: the service worker's answers are not instant like the browser's own
 * memory cache, but they are far quicker than the network. */
const CACHED_MS = 60

// Resource timings are only kept until the browser's buffer fills (a few
// hundred entries, fewer than a long library's covers), and covers read
// them to tell a cached image apart. Each time it fills it is made twice as
// large instead of cleared, which could drop the entry of an image whose
// load is about to be handled.
let timingBufferSize = 250
performance.addEventListener?.('resourcetimingbufferfull', () => {
  timingBufferSize *= 2
  performance.setResourceTimingBufferSize(timingBufferSize)
})

/** Whether an image that has just loaded came from a cache: its download,
 * as the browser timed it, was too short for a trip over the network. An
 * image loaded lazily may start long after its slot appeared, so the time
 * since then says nothing. */
function arrivedFromCache(image: HTMLImageElement, since: number): boolean {
  if (performance.now() - since < CACHED_MS) return true
  const entries = performance.getEntriesByName(image.currentSrc)
  const entry = entries[entries.length - 1]
  return entry !== undefined && entry.startTime >= since && entry.duration < CACHED_MS
}

/**
 * A slot for a game's cover art, filled by the image once it has loaded.
 *
 * Until then (still loading, a game with no cover, or an image that failed:
 * offline and never kept on this device, say) the slot shows a picture glyph
 * instead of an empty box, so it reads as an image that is missing rather
 * than as a gap in the layout.
 *
 * The image is drawn a pixel larger than the slot on every side, which the
 * slot clips. Some cover files carry a thin light frame of their own, and at
 * thumbnail size it showed as a hairline around the art; a pixel of a cover's
 * edge is never missed.
 *
 * An image that has to come over the network fades in as it arrives; one
 * already in a cache (most of them, after the first visit) shows at once, so
 * a page that opens instantly does not flicker.
 */
export function CoverImage({
  url,
  size,
  className = '',
  imageClassName = '',
  style,
  iconClassName = 'size-4',
  lazy = true,
  overlay = true,
  onLoad,
}: CoverImageProps) {
  const src = url ? imageUrl(url, size) : null
  // Keyed by source, so a slot reused for another cover starts over.
  const [outcome, setOutcome] = useState<{ src: string; loaded: boolean; fade: boolean } | null>(null)
  const loaded = outcome?.src === src && outcome.loaded
  const failed = outcome?.src === src && !outcome.loaded
  // When the image element appeared, and whether it was complete already.
  const mounted = useRef({ at: 0, complete: false })
  // Stable, so that it runs when an image element appears (a new source is
  // a new element, see its key) and not again on every render.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image) mounted.current = { at: performance.now(), complete: image.complete && image.naturalWidth > 0 }
  }, [])

  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden text-ink-faint ${className}`}>
      {/* While the image is on its way the glyph only fades in late, so a
          cover coming from the cache does not flash it on every load. */}
      {!loaded && <ImageIcon className={`${iconClassName} ${src && !failed ? 'appear-late' : ''}`} />}
      {src && !failed && (
        <img
          key={src}
          ref={imageRef}
          src={src}
          alt=""
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget
            const cached = mounted.current.complete || arrivedFromCache(image, mounted.current.at)
            setOutcome({ src, loaded: true, fade: !cached })
            onLoad?.(image)
          }}
          onError={() => setOutcome({ src, loaded: false, fade: false })}
          className={[
            'absolute -top-px -left-px h-[calc(100%+2px)] w-[calc(100%+2px)] max-w-none object-cover',
            // The transition only goes on once the image is known to need
            // it: one from a cache goes from hidden to shown in one step.
            outcome?.fade ? 'transition-opacity duration-150 ease-out motion-reduce:transition-none' : '',
            imageClassName,
          ].join(' ')}
          // Hidden inline rather than by a class, which would compete with
          // an opacity of imageClassName's own (UNRELEASED_IMAGE).
          style={loaded ? style : { ...style, opacity: 0 }}
        />
      )}
      {loaded && overlay && <CoverOverlay />}
    </span>
  )
}
