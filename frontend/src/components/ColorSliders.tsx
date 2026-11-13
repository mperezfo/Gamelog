import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { hexToOklch, oklchToHex } from '../lib/oklch'
import { HexInput } from './HexInput'

/** The chroma at full saturation for a genre's icon: soft rather than loud,
 * so that two genres of any hues sit well side by side. */
export const SOFT_CHROMA = 0.11

/** The chroma at full saturation for a platform: as vivid as a brand's
 * colour (Nintendo's red is about 0.24), which sRGB holds at most hues. */
export const BRAND_CHROMA = 0.25

/** Below this a stored colour reads as a grey, whatever its hue says. */
const GREY_CHROMA = 0.02

/** A colour as the sliders set it: hue in degrees, saturation from 0 (grey)
 * to 1, lightness from 0 (black) to 1 (white). */
interface Tone {
  hue: number
  saturation: number
  lightness: number
}

/** The colour of the text, which an icon with no colour of its own is drawn
 * in (see IconPanel and LookupIcon): a grey, as light as the theme's. */
function textTone(): Tone {
  const ink = hexToOklch(getComputedStyle(document.documentElement).getPropertyValue('--gl-ink-muted').trim())
  return { hue: 0, saturation: 0, lightness: ink ? Math.round(ink.l * 100) / 100 : 0.6 }
}

interface ColorSlidersProps {
  /** #rrggbb, or empty for none where the colour can be cleared. */
  value: string
  onChange: (value: string) => void
  /** The chroma at full saturation (SOFT_CHROMA or BRAND_CHROMA). */
  chroma?: number
  /** Whether the colour can be left out: emptying the code then means none. */
  clearable?: boolean
  /** What stands beside the code for the colour: a square of it, unless
   * something shows the result better (a platform's badge). */
  preview?: ReactNode
}

/**
 * A colour picked by hue, saturation and lightness, each on a slider, with
 * no heading: their tracks say what they are. In OKLCH, so that every hue is
 * as light and as vivid as the next at the same settings. Then the colour
 * itself, with its hex code to read, type or paste. The surroundings (a
 * border, a padding) are the caller's: the icon picker and ColorField.
 *
 * Cleared (where it can be), it starts from the text's grey, which is how a
 * genre's icon looks without a colour, rather than from a colour nothing on
 * screen has.
 */
export function ColorSliders({ value, onChange, chroma = SOFT_CHROMA, clearable = false, preview }: ColorSlidersProps) {
  const toHex = ({ hue, saturation, lightness }: Tone) =>
    oklchToHex({ l: lightness, c: chroma * saturation, h: hue })
  const gradient = (steps: Tone[]) => `linear-gradient(to right, ${steps.map(toHex).join(', ')})`

  function toneOf(hex: string): Tone {
    const color = hex ? hexToOklch(hex) : null
    if (!color) return textTone()
    return {
      hue: color.c < GREY_CHROMA ? 0 : Math.round(color.h),
      saturation: Math.min(1, Math.round((color.c / chroma) * 100) / 100),
      lightness: Math.round(color.l * 100) / 100,
    }
  }

  // The sliders' own tone while they are moved: read back from the hex code
  // it gave, a tone can come out a step off, which would hold the arrow keys
  // in place. Only while the colour is still the one it gave: a code typed,
  // or none, puts the sliders where that colour is.
  const [sliding, setSliding] = useState<{ tone: Tone; hex: string } | null>(null)
  const tone = sliding && sliding.hex === value ? sliding.tone : toneOf(value)

  function slide(next: Partial<Tone>) {
    const merged = { ...tone, ...next }
    // A hue means nothing to a grey: moving it from one, the text's included,
    // brings the colour in at full saturation rather than changing nothing.
    if (next.hue !== undefined && tone.saturation === 0) merged.saturation = 1
    const hex = toHex(merged)
    setSliding({ tone: merged, hex })
    onChange(hex)
  }

  // With no colour, a hollow thumb: the track's colour shows nowhere yet.
  const thumb = value ? toHex(tone) : 'var(--color-surface)'
  const percent = (x: number) => Math.round(x * 100)

  return (
    <div className="flex flex-col gap-1.5">
      <Slider
        label="Hue"
        max={359}
        value={tone.hue}
        text={`${tone.hue} degrees`}
        // The hues as moving it would give them, so in colour from a grey.
        track={gradient(Array.from({ length: 13 }, (_, i) => ({ ...tone, saturation: tone.saturation || 1, hue: i * 30 })))}
        thumb={thumb}
        onChange={(hue) => slide({ hue })}
      />
      <Slider
        label="Saturation"
        max={100}
        value={percent(tone.saturation)}
        text={`${percent(tone.saturation)}%`}
        track={gradient([0, 0.25, 0.5, 0.75, 1].map((saturation) => ({ ...tone, saturation })))}
        thumb={thumb}
        onChange={(saturation) => slide({ saturation: saturation / 100 })}
      />
      <Slider
        label="Lightness"
        max={100}
        value={percent(tone.lightness)}
        text={`${percent(tone.lightness)}%`}
        track={gradient(Array.from({ length: 11 }, (_, i) => ({ ...tone, lightness: i / 10 })))}
        thumb={thumb}
        onChange={(lightness) => slide({ lightness: lightness / 100 })}
      />
      <div className="mt-1 flex min-w-0 items-center gap-2">
        {preview ??
          (value ? (
            <span
              className="size-5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
              style={{ backgroundColor: value }}
            />
          ) : (
            <span className="size-5 shrink-0 rounded-[3px] border border-dashed border-line-strong" />
          ))}
        <HexInput value={value} onChange={onChange} clearable={clearable} className="w-24 shrink-0" />
      </div>
    </div>
  )
}

/** How long a slider takes to glide to a value it was not dragged to. */
const GLIDE_MS = 200

/**
 * One slider. Dragged, it follows the pointer at once; moved by anything
 * else (another slider, a code typed, the colour cleared), it glides there,
 * so that what changed is seen to change. Not with reduced motion.
 *
 * A range input's thumb cannot be animated with CSS, so the value it shows
 * is: eased from where it was to where it is going, a frame at a time.
 */
function Slider({
  label,
  max,
  value,
  text,
  track,
  thumb,
  onChange,
}: {
  label: string
  max: number
  value: number
  text: string
  track: string
  thumb: string
  onChange: (value: number) => void
}) {
  const [shown, setShown] = useState(value)
  // Where the thumb is drawn right now, mid-glide included.
  const at = useRef(value)
  // Whether the change in `value` is this slider's own, dragged.
  const dragged = useRef(false)

  useEffect(() => {
    const from = at.current
    if (dragged.current || from === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      dragged.current = false
      at.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    let frame = requestAnimationFrame(function glide(now) {
      const progress = Math.min(1, (now - start) / GLIDE_MS)
      // Fast at first and settling at the end (cubic ease-out).
      at.current = from + (value - from) * (1 - (1 - progress) ** 3)
      setShown(at.current)
      if (progress < 1) frame = requestAnimationFrame(glide)
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  return (
    <input
      type="range"
      min={0}
      max={max}
      value={shown}
      aria-label={label}
      aria-valuetext={text}
      onChange={(event) => {
        // Shown at once, in this same render: waiting for the effect would
        // put the thumb back where it was for a frame under the pointer.
        const next = Number(event.target.value)
        dragged.current = true
        at.current = next
        setShown(next)
        onChange(next)
      }}
      className="gl-slider"
      style={{ '--track': track, '--thumb': thumb } as CSSProperties}
    />
  )
}
