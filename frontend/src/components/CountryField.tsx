import { useId, useMemo, useRef, useState } from 'react'

import { COUNTRY_CODES, countryName } from '../lib/countries'
import { foldCase } from '../lib/fuzzy'
import { CountryFlag } from './CountryFlag'
import { CheckIcon } from './icons'
import { Popover } from './Popover'

interface CountryFieldProps {
  label: string
  /** A two-letter code, or empty for none. */
  value: string
  onChange: (value: string) => void
}

/**
 * A labelled country, picked from a searchable list of every one with its
 * flag, in the style of the other dropdowns. Searched by name or by code, so
 * "jp" finds Japan as well as "japan" does. Enter picks the first match.
 */
export function CountryField({ label, value, onChange }: CountryFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // By name, which is how they are looked for, rather than by code.
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  const folded = foldCase(query.trim())
  const matches = folded
    ? countries.filter(({ code, name }) => foldCase(name).includes(folded) || code.toLowerCase() === folded)
    : countries

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(next: string) {
    onChange(next)
    close()
    buttonRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? countryName(value) : 'none'}`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 min-w-16 items-center justify-center rounded-control bg-field shadow-field px-2.5 text-sm transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {value ? (
          <span className="text-lg leading-none">
            <CountryFlag code={value} />
          </span>
        ) : (
          <span className="text-ink-faint">None</span>
        )}
      </button>

      <Popover
        anchorRef={buttonRef}
        open={open}
        onClose={close}
        aria-label={`Pick the ${label.toLowerCase()}`}
        className="flex w-64 flex-col overflow-hidden"
      >
        <input
          data-autofocus=""
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches.length > 0) {
              event.preventDefault()
              pick(matches[0].code)
            }
          }}
          placeholder="Search countries…"
          aria-label="Search countries"
          className="w-full border-b border-line bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="max-h-[min(18rem,calc(var(--popover-available-height)-5rem))] overflow-y-auto p-1">
          {matches.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint">No matches.</p>}
          {matches.map(({ code, name }) => (
            <button
              key={code}
              type="button"
              onClick={() => pick(code)}
              className={[
                'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm transition-colors duration-75',
                'focus-visible:bg-hover focus-visible:outline-none',
                code === value ? 'text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
              ].join(' ')}
            >
              <CountryFlag code={code} decorative />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {code === value && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        {value && (
          <div className="flex justify-end border-t border-line p-1">
            <button
              type="button"
              onClick={() => pick('')}
              className="rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Remove
            </button>
          </div>
        )}
      </Popover>
    </div>
  )
}
