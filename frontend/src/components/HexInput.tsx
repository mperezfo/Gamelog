import { useState } from 'react'

const HEX = /^#[0-9a-f]{6}$/i

interface HexInputProps {
  /** #rrggbb, or empty for none. */
  value: string
  onChange: (value: string) => void
  className?: string
}

/** A colour as a hex code, typed or pasted, with or without its "#". It only
 * reaches `onChange` once it is a whole one, so that typing through "#d4"
 * does not repaint everything, and goes back to the colour's own code when
 * left half typed. */
export function HexInput({ value, onChange, className = 'w-full' }: HexInputProps) {
  const [draft, setDraft] = useState(value)
  const [syncedFrom, setSyncedFrom] = useState(value)
  // A pick elsewhere (a swatch, a picker, a slider) replaces whatever was typed.
  if (value !== syncedFrom) {
    setSyncedFrom(value)
    setDraft(value)
  }

  return (
    <input
      aria-label="Hex code"
      placeholder="#RRGGBB"
      value={draft}
      maxLength={7}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        const digits = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
        const next = digits ? '#' + digits : ''
        setDraft(next)
        if (HEX.test(next)) {
          setSyncedFrom(next)
          onChange(next)
        }
      }}
      onBlur={() => setDraft(value)}
      className={`h-8 rounded-control bg-field shadow-field px-2.5 text-sm text-ink uppercase tabular-nums outline-none placeholder:text-ink-faint placeholder:normal-case focus-visible:ring-2 focus-visible:ring-accent/40 ${className}`}
    />
  )
}
