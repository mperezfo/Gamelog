import { useId, useRef, useState, type CSSProperties } from 'react'

import { hexToOklch, oklchToHex } from '../lib/oklch'
import { CheckIcon } from './icons'
import { Popover } from './Popover'

/** How light and how vivid every colour picked here is: soft enough that no
 * hue is loud, and that any two genres sit well side by side. Drawn as an
 * icon, `tint-ink` (index.css) darkens it on a light page and keeps it as it
 * is on a dark one. */
const LIGHTNESS = 0.72
const CHROMA = 0.11

/** Below this a stored colour reads as a grey, whatever its hue says. */
const GREY_CHROMA = 0.02

/** Ready-made hues, a twelfth of the circle apart. */
const HUES = [
  { name: 'Red', hue: 25 },
  { name: 'Orange', hue: 55 },
  { name: 'Yellow', hue: 85 },
  { name: 'Lime', hue: 115 },
  { name: 'Green', hue: 145 },
  { name: 'Teal', hue: 175 },
  { name: 'Cyan', hue: 205 },
  { name: 'Sky', hue: 235 },
  { name: 'Blue', hue: 265 },
  { name: 'Violet', hue: 295 },
  { name: 'Purple', hue: 325 },
  { name: 'Pink', hue: 355 },
]

const colorOf = (hue: number) => oklchToHex({ l: LIGHTNESS, c: CHROMA, h: hue })
const GREY = oklchToHex({ l: LIGHTNESS, c: 0, h: 0 })

/** The slider's track: every hue at the field's lightness and chroma. */
const TRACK = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => colorOf(i * 30)).join(', ')})`

interface HueFieldProps {
  label: string
  /** #rrggbb, or empty for none. */
  value: string
  onChange: (value: string) => void
}

/**
 * A labelled colour picked by hue alone, for a genre's icon: the lightness
 * and chroma are fixed, so every colour it gives is as soft as the next one
 * and none clashes. Twelve hues to pick from, a grey, none, and a slider for
 * any hue in between. A platform, which wants a brand's exact colour, has
 * ColorField instead.
 */
export function HueField({ label, value, onChange }: HueFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // The slider's own hue while it is moved: read back from the hex code it
  // gave, a hue can come out a degree off, which would hold the arrow keys
  // in place.
  const [sliding, setSliding] = useState<number | null>(null)

  const color = value ? hexToOklch(value) : null
  const grey = color !== null && color.c < GREY_CHROMA
  // Where the slider sits: the colour's own hue, or red for a grey or none.
  const hue = sliding ?? (color && !grey ? Math.round(color.h) : HUES[0].hue)
  const named = color && !grey ? HUES.find((option) => colorOf(option.hue) === value.toLowerCase()) : undefined
  const description = !value ? 'none' : grey ? 'gray' : (named?.name.toLowerCase() ?? value)

  function pick(next: string) {
    setSliding(null)
    onChange(next)
    setOpen(false)
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
        aria-label={`${label}: ${description}`}
        onClick={() => {
          setSliding(null)
          setOpen((o) => !o)
        }}
        className="flex h-9 w-11 items-center justify-center rounded-control bg-field shadow-field transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Swatch color={value} />
      </button>

      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} aria-label={`Pick the ${label.toLowerCase()}`}>
        <div className="flex w-60 flex-col gap-3 p-3">
          <div className="grid grid-cols-7 gap-1.5">
            <Choice name="No colour" color="" selected={!value} onPick={pick} />
            {HUES.map((option) => {
              const swatch = colorOf(option.hue)
              return <Choice key={option.hue} name={option.name} color={swatch} selected={value.toLowerCase() === swatch} onPick={pick} />
            })}
            <Choice name="Gray" color={GREY} selected={grey} onPick={pick} />
          </div>

          <input
            type="range"
            min={0}
            max={359}
            value={hue}
            aria-label="Hue"
            aria-valuetext={`${hue} degrees`}
            // Moving it is a pick, but the popover stays open until the
            // hue is right.
            onChange={(event) => {
              const next = Number(event.target.value)
              setSliding(next)
              onChange(colorOf(next))
            }}
            className="gl-hue"
            style={{ '--track': TRACK, '--thumb': color && !grey ? value : colorOf(hue) } as CSSProperties}
          />
        </div>
      </Popover>
    </div>
  )
}

/** The colour as a small square, or an empty dashed one for none. */
function Swatch({ color }: { color: string }) {
  return color ? (
    <span className="size-5 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ backgroundColor: color }} />
  ) : (
    <span className="size-5 rounded-[3px] border border-dashed border-line-strong" />
  )
}

function Choice({
  name,
  color,
  selected,
  onPick,
}: {
  name: string
  color: string
  selected: boolean
  onPick: (color: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={name}
      data-tooltip={name}
      aria-pressed={selected}
      data-autofocus={selected ? '' : undefined}
      onClick={() => onPick(color)}
      className={[
        'flex aspect-square items-center justify-center rounded-control transition-transform duration-75 hover:scale-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        // The swatches are all light, so the check is dark on every one.
        color ? 'text-black/70' : 'border border-dashed border-line-strong text-ink-muted',
      ].join(' ')}
      style={color ? { backgroundColor: color } : undefined}
    >
      {selected && <CheckIcon className="size-3.5" />}
    </button>
  )
}
