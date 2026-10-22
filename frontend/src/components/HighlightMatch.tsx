import type { ReactNode } from 'react'

import { graphemes } from '../lib/graphemes'
import { Emoji } from './Emoji'

interface HighlightMatchProps {
  text: string
  /** Character indices of `text` to render bold, as returned by fuzzyMatch. */
  indices: number[]
  /** How a matched run is drawn. Bold in the page's ink unless the text
   * sits on a colour of its own, such as a platform's badge. */
  matchClassName?: string
}

/** Renders `text` with the characters at `indices` in bold, for showing what a fuzzy match matched. */
export function HighlightMatch({ text, indices, matchClassName = 'font-semibold text-ink' }: HighlightMatchProps) {
  if (indices.length === 0) return <Emoji value={text} />

  const matched = new Set(indices)
  const nodes: ReactNode[] = []
  let buffer = ''
  let bufferMatched = false

  function flush(key: number) {
    if (!buffer) return
    nodes.push(
      bufferMatched ? (
        <strong key={key} className={matchClassName}>
          <Emoji value={buffer} />
        </strong>
      ) : (
        <span key={key}>
          <Emoji value={buffer} />
        </span>
      ),
    )
    buffer = ''
  }

  // A grapheme at a time rather than a code unit, so that an emoji is never
  // split between two runs: it is bold if any part of it matched.
  for (const { segment, index } of graphemes.segment(text)) {
    let isMatched = false
    for (let i = index; i < index + segment.length; i++) isMatched ||= matched.has(i)
    if (buffer && isMatched !== bufferMatched) flush(index)
    bufferMatched = isMatched
    buffer += segment
  }
  flush(text.length)

  return <>{nodes}</>
}
