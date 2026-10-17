import { useState, type CSSProperties } from 'react'

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
}: CoverImageProps) {
  const src = url ? imageUrl(url, size) : null
  // Keyed by source, so a slot reused for another cover starts over.
  const [outcome, setOutcome] = useState<{ src: string; loaded: boolean } | null>(null)
  const loaded = outcome?.src === src && outcome.loaded
  const failed = outcome?.src === src && !outcome.loaded

  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden text-ink-faint ${className}`}>
      {!loaded && <ImageIcon className={iconClassName} />}
      {src && !failed && (
        <img
          key={src}
          src={src}
          alt=""
          loading={lazy ? 'lazy' : undefined}
          decoding="async"
          draggable={false}
          onLoad={() => setOutcome({ src, loaded: true })}
          onError={() => setOutcome({ src, loaded: false })}
          className={`absolute -top-px -left-px h-[calc(100%+2px)] w-[calc(100%+2px)] max-w-none object-cover ${imageClassName}`}
          style={style}
        />
      )}
      {loaded && overlay && <CoverOverlay />}
    </span>
  )
}
