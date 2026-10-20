import { useState, type ReactNode } from 'react'

import aliases from 'virtual:emoji-aliases'

import { graphemes } from '../lib/graphemes'

/** What can only be drawn as an emoji: a pictograph, half of a flag, or the
 * box of a keycap ("1️⃣"). A grapheme with none of these is plain text. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u

/** What is drawn as an emoji in running text: a pictograph that is one by
 * default, or any asking to be one with U+FE0F, a flag or a keycap. A "™"
 * in a title is pictographic too, but reads as a letter there. */
const EMOJI_IN_TEXT = /\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}|⃣/u

/** The image of one grapheme (see emojiPlugin in vite.config.ts), named
 * after its code points, or null for one that is not an emoji. One on its
 * own, an icon, is an emoji whenever it can be: a bare heart is still meant
 * as one there. */
function emojiSrc(grapheme: string, alone: boolean): string | null {
  if (!(alone ? PICTOGRAPHIC : EMOJI_IN_TEXT).test(grapheme)) return null
  const key = Array.from(grapheme, (char) => char.codePointAt(0)!.toString(16).padStart(4, '0')).join('-')
  return `/emoji/${aliases[key] ?? key}.png`
}

/**
 * Text as the app shows it, a genre's icon or a game's title alike, with
 * every emoji in it drawn as an image of Google's Noto set rather than in
 * the system's emoji font, so that it looks the same on every device and
 * next to an icon of the same emoji. The rest of it stays text, as does an
 * emoji the set has no image for.
 */
export function Emoji({ value }: { value: string }) {
  // Most text has no emoji at all, and is left as one string.
  if (!PICTOGRAPHIC.test(value)) return value

  const segments = Array.from(graphemes.segment(value))
  const parts: ReactNode[] = []
  let text = ''
  for (const { segment, index } of segments) {
    const src = emojiSrc(segment, segments.length === 1)
    if (!src) {
      text += segment
      continue
    }
    if (text) parts.push(text)
    text = ''
    // Keyed by the grapheme as well as its place, so that a new emoji in
    // the same place starts over rather than inheriting whether the
    // previous one failed to load.
    parts.push(<Grapheme key={`${index}:${segment}`} text={segment} src={src} />)
  }
  if (text) parts.push(text)
  return <>{parts}</>
}

function Grapheme({ text, src }: { text: string; src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return text

  return (
    <img
      src={src}
      // The emoji itself, so that it copies and reads as one.
      alt={text}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
      // About the size an emoji font draws at, on the text's baseline. The
      // alt text transparent: Firefox draws it in the box until the image
      // has loaded, which would flash the system's own emoji, smaller and
      // lower, before every reload settles. One that fails is shown as text
      // anyway (see above).
      className="inline-block size-[1.15em] align-[-0.2em] text-transparent select-none"
    />
  )
}
