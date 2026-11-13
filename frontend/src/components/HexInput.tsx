import { useRef, useState } from 'react'

import { XIcon } from './icons'

const HEX = /^#[0-9a-f]{6}$/i

interface HexInputProps {
  /** #rrggbb, or empty for none. */
  value: string
  onChange: (value: string) => void
  /** Whether the colour can be left out: emptying the code then means no
   * colour, and a × in it empties it at once. */
  clearable?: boolean
  className?: string
}

/** A colour as a hex code, typed or pasted, with or without its "#". It only
 * reaches `onChange` once it is a whole one, so that typing through "#d4"
 * does not repaint everything, and goes back to the colour's own code when
 * left half typed. */
export function HexInput({ value, onChange, clearable = false, className = 'w-full' }: HexInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [syncedFrom, setSyncedFrom] = useState(value)
  // A pick elsewhere (a swatch, a picker, a slider) replaces whatever was typed.
  if (value !== syncedFrom) {
    setSyncedFrom(value)
    setDraft(value)
  }

  function commit(next: string) {
    setSyncedFrom(next)
    onChange(next)
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        aria-label="Hex code"
        placeholder={clearable ? 'No colour' : '#RRGGBB'}
        value={draft}
        maxLength={7}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
          const next = digits ? '#' + digits : ''
          setDraft(next)
          if (HEX.test(next) || (clearable && !next)) commit(next)
        }}
        onBlur={() => setDraft(value)}
        className={`h-8 w-full rounded-control bg-field shadow-field pl-2.5 text-sm text-ink uppercase tabular-nums outline-none placeholder:text-ink-faint placeholder:normal-case focus-visible:ring-2 focus-visible:ring-accent/40 ${clearable && value ? 'pr-6' : 'pr-2.5'}`}
      />
      {clearable && value && (
        <button
          type="button"
          aria-label="No colour"
          data-tooltip="No colour"
          onClick={() => {
            setDraft('')
            commit('')
            inputRef.current?.focus()
          }}
          className="absolute inset-y-0 right-0 flex w-6 items-center justify-center rounded-r-control text-ink-faint transition-colors duration-75 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}
