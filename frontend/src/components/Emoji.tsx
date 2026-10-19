import { useState } from 'react'

import aliases from 'virtual:emoji-aliases'

/** What can only be drawn as an emoji: a pictograph, half of a flag, or the
 * box of a keycap ("1️⃣"). A grapheme with none of these is plain text. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The image of one grapheme (see emojiPlugin in vite.config.ts), named
 * after its code points, or null for one that is not an emoji. */
function emojiSrc(grapheme: string): string | null {
  if (!PICTOGRAPHIC.test(grapheme)) return null
  const key = Array.from(grapheme, (char) => char.codePointAt(0)!.toString(16).padStart(4, '0')).join('-')
  return `/emoji/${aliases[key] ?? key}.png`
}

/**
 * A short piece of text such as a genre's icon, with every emoji in it drawn
 * as an image of Google's Noto set rather than in the system's emoji font,
 * so that it looks the same on every device. Anything else in it, and an
 * emoji the set has no image for, stays text.
 */
export function Emoji({ value }: { value: string }) {
  return (
    <>
      {/* Keyed by the grapheme as well as its place, so that a new emoji
          in the same place starts over rather than inheriting whether the
          previous one failed to load. */}
      {Array.from(segmenter.segment(value), ({ segment, index }) => (
        <Grapheme key={`${index}:${segment}`} text={segment} />
      ))}
    </>
  )
}

function Grapheme({ text }: { text: string }) {
  const [failed, setFailed] = useState(false)
  const src = emojiSrc(text)
  if (!src || failed) return text

  return (
    <img
      src={src}
      // The emoji itself, so that it copies and reads as one.
      alt={text}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
      // About the size an emoji font draws at, on the text's baseline.
      className="inline-block size-[1.15em] align-[-0.2em] select-none"
    />
  )
}
