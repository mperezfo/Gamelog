/** The small accent "new" after the name of a record that is created only
 * when the game is saved: a developer or publisher chip, or the platform
 * Identify picked.
 *
 * It sits on the name's baseline (see MultiSelectDropdown), lined up with a
 * lower-case name's x-height. `raised` centres it on the capitals of 14px
 * text instead, for platform names, which are mostly capitals (DC, PS5). */
export function NewMark({ raised = false }: { raised?: boolean }) {
  return (
    <span
      className={`shrink-0 text-[10px] leading-none font-semibold tracking-wide text-accent uppercase ${raised ? 'relative bottom-[1.5px]' : ''}`}
    >
      new
    </span>
  )
}
