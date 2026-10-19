import { useId, useRef, useState } from 'react'

import { HexColorPicker } from 'react-colorful'

import { CheckIcon } from './icons'
import { Popover } from './Popover'

/**
 * Ready-made colours, the ones the theme already uses for its own tints
 * (Notion's palette): each reads well as text on its own low-opacity tint,
 * which is how PlatformBadge shows it, in either theme.
 */
const SWATCHES = [
  { name: 'Gray', value: '#787774' },
  { name: 'Brown', value: '#9f6b53' },
  { name: 'Orange', value: '#d9730d' },
  { name: 'Yellow', value: '#cb912f' },
  { name: 'Green', value: '#448361' },
  { name: 'Teal', value: '#4dab9a' },
  { name: 'Blue', value: '#337ea9' },
  { name: 'Purple', value: '#9065b0' },
  { name: 'Pink', value: '#c14c8a' },
  { name: 'Red', value: '#d44c47' },
]

const HEX = /^#[0-9a-f]{6}$/i

interface ColorFieldProps {
  label: string
  /** #rrggbb */
  value: string
  onChange: (value: string) => void
}

/**
 * A labelled colour, in place of `<input type="color">`, whose swatch looks
 * different in every browser and whose picker is the operating system's own
 * dialog. This one opens a popover with the theme's colours to pick from,
 * a free picker (react-colorful, restyled in index.css) and the hex code.
 */
export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

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
        aria-label={`${label}: ${value}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-11 items-center justify-center rounded-control bg-sunken transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="size-5 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ backgroundColor: value }} />
      </button>

      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} aria-label={`Pick the ${label.toLowerCase()}`}>
        <div className="flex w-60 flex-col gap-3 p-3">
          <div className="grid grid-cols-5 gap-1.5">
            {SWATCHES.map((swatch) => {
              const selected = swatch.value.toLowerCase() === value.toLowerCase()
              return (
                <button
                  key={swatch.value}
                  type="button"
                  aria-label={swatch.name}
                  data-tooltip={swatch.name}
                  aria-pressed={selected}
                  data-autofocus={selected ? '' : undefined}
                  onClick={() => onChange(swatch.value)}
                  className="flex aspect-square items-center justify-center rounded-control text-white transition-transform duration-75 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  style={{ backgroundColor: swatch.value }}
                >
                  {selected && <CheckIcon className="size-3.5" />}
                </button>
              )
            })}
          </div>

          <HexColorPicker color={value} onChange={onChange} className="gl-colorful" />

          <HexInput value={value} onChange={onChange} />
        </div>
      </Popover>
    </div>
  )
}

/** The colour as a hex code, which only reaches `onChange` once it is a
 * whole one, so that typing through "#d4" does not repaint everything. */
function HexInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [syncedFrom, setSyncedFrom] = useState(value)
  // A pick from the swatches or the picker replaces whatever was typed.
  if (value !== syncedFrom) {
    setSyncedFrom(value)
    setDraft(value)
  }

  return (
    <input
      aria-label="Hex code"
      value={draft}
      maxLength={7}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        const next = '#' + event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
        setDraft(next)
        if (HEX.test(next)) {
          setSyncedFrom(next)
          onChange(next)
        }
      }}
      onBlur={() => setDraft(value)}
      className="h-8 w-full rounded-control bg-sunken px-2.5 text-sm text-ink uppercase tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    />
  )
}
