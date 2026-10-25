import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

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

/** How long an image can keep its slot waiting on screen and still show
 * at once, in ms: the service worker's answers are not instant like the
 * browser's own memory cache, but they are far quicker than the network. */
const QUICK_MS = 60

/** When each slot came into view, for the images still on their way. One
 * observer is shared by every cover on the page. */
const inView = new WeakMap<Element, number>()
let viewObserver: IntersectionObserver | undefined

function observeView(slot: Element): () => void {
  viewObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !inView.has(entry.target)) inView.set(entry.target, entry.time)
    }
  })
  viewObserver.observe(slot)
  return () => viewObserver?.unobserve(slot)
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
 * An image that keeps its slot waiting on screen fades in as it arrives;
 * one that arrives at once (from a cache, most of them after the first
 * visit) or before its slot is scrolled into view simply shows, so a page
 * that opens instantly does not flicker. What counts is the wait on screen
 * rather than how long the download took, which the browser may not know:
 * a lazy image starts at no telling when, and a throttle such as the
 * developer tools' may not show in its timings.
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
  // Whether the image element was complete already when it appeared.
  const completeAtMount = useRef(false)
  // Stable, so that it runs when an image element appears (a new source is
  // a new element, see its key) and not again on every render.
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    if (image) completeAtMount.current = image.complete && image.naturalWidth > 0
  }, [])
  const slotRef = useRef<HTMLSpanElement>(null)
  const waiting = Boolean(src) && !loaded && !failed
  useEffect(() => {
    const slot = slotRef.current
    if (!waiting || !slot) return
    inView.delete(slot)
    return observeView(slot)
  }, [waiting, src])

  /** Whether the image kept its slot waiting on screen long enough to be
   * seen arriving. */
  function keptWaiting(): boolean {
    if (completeAtMount.current || !slotRef.current) return false
    const since = inView.get(slotRef.current)
    return since !== undefined && performance.now() - since >= QUICK_MS
  }

  return (
    <span ref={slotRef} className={`relative flex shrink-0 items-center justify-center overflow-hidden text-ink-faint ${className}`}>
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
            setOutcome({ src, loaded: true, fade: keptWaiting() })
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
