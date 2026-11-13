import { useState, type CSSProperties } from 'react'

import { hexToOklch, oklchToHex } from '../lib/oklch'
import { COLUMN_WIDTH } from '../lib/pickerGrid'
import { HexInput } from './HexInput'

/** The chroma at full saturation: soft rather than loud, so that two genres
 * of any hues sit well side by side. */
const CHROMA = 0.11

/** Below this a stored colour reads as a grey, whatever its hue says. */
const GREY_CHROMA = 0.02

/** A colour as the sliders set it: hue in degrees, saturation from 0 (grey)
 * to 1, lightness from 0 (black) to 1 (white). */
interface Tone {
  hue: number
  saturation: number
  lightness: number
}

const toHex = ({ hue, saturation, lightness }: Tone) =>
  oklchToHex({ l: lightness, c: CHROMA * saturation, h: hue })

/** The colour of the text, which an icon with no colour of its own is drawn
 * in (see IconPanel and LookupIcon): a grey, as light as the theme's. */
function textTone(): Tone {
  const ink = hexToOklch(getComputedStyle(document.documentElement).getPropertyValue('--gl-ink-muted').trim())
  return { hue: 0, saturation: 0, lightness: ink ? Math.round(ink.l * 100) / 100 : 0.6 }
}

/** The tone a stored colour stands for. With none, the sliders start from
 * the text's grey, which is how the icon looks without one, rather than from
 * a colour nothing on screen has. */
function toneOf(value: string): Tone {
  const color = value ? hexToOklch(value) : null
  if (!color) return textTone()
  return {
    hue: color.c < GREY_CHROMA ? 0 : Math.round(color.h),
    saturation: Math.min(1, Math.round((color.c / CHROMA) * 100) / 100),
    lightness: Math.round(color.l * 100) / 100,
  }
}

/** A gradient through the given tones. */
const gradient = (steps: Tone[]) => `linear-gradient(to right, ${steps.map(toHex).join(', ')})`

interface ColorSlidersProps {
  /** #rrggbb, or empty for none. */
  value: string
  onChange: (value: string) => void
}

/**
 * The colour of a genre's icon, under the icons it is picked from (see
 * IconPanel), with no heading: its tracks say what it is. Hue, saturation
 * and lightness, each on a slider, in OKLCH so that every hue is as light
 * and as vivid as the next at the same settings; then the colour itself,
 * with its hex code to read or type. Emptying the code (or its ×) leaves the
 * icon in the colour of the text around it. The colour is drawn exactly as
 * picked, in either theme.
 */
export function ColorSliders({ value, onChange }: ColorSlidersProps) {
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
    <div className="shrink-0 border-t border-line">
      <div className={`${COLUMN_WIDTH} flex flex-col gap-1.5 py-2.5`}>
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
        <div className="mt-1 flex items-center gap-2">
          {value ? (
            <span
              className="size-5 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
              style={{ backgroundColor: value }}
            />
          ) : (
            <span className="size-5 shrink-0 rounded-[3px] border border-dashed border-line-strong" />
          )}
          <HexInput value={value} onChange={onChange} clearable className="w-24" />
        </div>
      </div>
    </div>
  )
}

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
  return (
    <input
      type="range"
      min={0}
      max={max}
      value={value}
      aria-label={label}
      aria-valuetext={text}
      onChange={(event) => onChange(Number(event.target.value))}
      className="gl-slider"
      style={{ '--track': track, '--thumb': thumb } as CSSProperties}
    />
  )
}
