import type { Lookup } from '../types/lookup'

/** A genre's emoji and name, inline — no pill, no border: the emoji already
 * does the work of setting it apart from plain text. */
export function GenreTag({ genre }: { genre: Lookup }) {
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-ink-muted">
      {genre.icon && <span aria-hidden="true">{genre.icon}</span>}
      {genre.name}
    </span>
  )
}
