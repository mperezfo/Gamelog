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

/** A colour as a hex code, typed or pasted, with or without its "#", in a
 * monospaced face so that every code takes the same room. It only
 * reaches `onChange` once it is a whole one, so that typing through "#d4"
 * does not repaint everything, and goes back to the colour's own code when
 * left half typed. */
export function HexInput({ value, onChange, clearable = false, className = '' }: HexInputProps) {
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
    <div className={`relative w-fit ${className}`}>
      <input
        ref={inputRef}
        aria-label="Hex code"
        placeholder={clearable ? 'None' : '#RRGGBB'}
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
        // As wide as a code: seven characters of this same face, and the
        // room for the × where there is one, whether it shows yet or not.
        className={`h-8 rounded-control bg-field shadow-field pl-2.5 font-mono text-[13px] text-ink uppercase outline-none placeholder:font-sans placeholder:text-ink-faint placeholder:normal-case focus-visible:ring-2 focus-visible:ring-accent/40 ${clearable ? 'w-[calc(7ch+2.125rem+2px)] pr-6' : 'w-[calc(7ch+1.25rem+2px)] pr-2.5'}`}
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
