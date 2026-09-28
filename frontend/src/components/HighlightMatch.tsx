import type { ReactNode } from 'react'

interface HighlightMatchProps {
  text: string
  /** Character indices of `text` to render bold, as returned by fuzzyMatch. */
  indices: number[]
}

/** Renders `text` with the characters at `indices` in bold, for showing what a fuzzy match matched. */
export function HighlightMatch({ text, indices }: HighlightMatchProps) {
  if (indices.length === 0) return <>{text}</>

  const matched = new Set(indices)
  const nodes: ReactNode[] = []
  let buffer = ''
  let bufferMatched = false

  function flush(key: number) {
    if (!buffer) return
    nodes.push(
      bufferMatched ? (
        <strong key={key} className="font-semibold text-ink">
          {buffer}
        </strong>
      ) : (
        <span key={key}>{buffer}</span>
      ),
    )
    buffer = ''
  }

  for (let i = 0; i < text.length; i++) {
    const isMatched = matched.has(i)
    if (buffer && isMatched !== bufferMatched) flush(i)
    bufferMatched = isMatched
    buffer += text[i]
  }
  flush(text.length)

  return <>{nodes}</>
}
