import { useId, useRef, useState } from 'react'

import type { Lookup } from '../types/lookup'
import { BRAND_CHROMA, ColorSliders } from './ColorSliders'
import { PlatformBadge } from './PlatformBadge'
import { Popover } from './Popover'

interface ColorFieldProps {
  label: string
  /** #rrggbb, or empty for none. */
  value: string
  onChange: (value: string) => void
  /** The platform's name, for the badge the popover previews. */
  name: string
}

/**
 * A platform's colour, in place of `<input type="color">`, whose swatch looks
 * different in every browser and whose picker is the operating system's own
 * dialog. This one opens the sliders a genre's icon is coloured with (see
 * ColorSliders), as vivid as a brand's colour can be. With none, the badge
 * is the theme's own grey.
 *
 * A badge shows its colour adjusted to the theme (the `tint` utility), not
 * as picked, so the popover previews the platform's badge itself rather than
 * a square of the colour.
 */
export function ColorField({ label, value, onChange, name }: ColorFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  // Enough of a platform for its badge; the rest of it does not show.
  const preview = { id: 0, slug: '', name: name.trim() || 'Platform', color: value || null } satisfies Lookup

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
        aria-label={`${label}: ${value || 'none'}`}
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-control bg-field shadow-field transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {value ? (
          <span className="size-5 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]" style={{ backgroundColor: value }} />
        ) : (
          <span className="size-5 rounded-[3px] border border-dashed border-line-strong" />
        )}
      </button>

      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} aria-label={`Pick the ${label.toLowerCase()}`}>
        <div className="w-[17rem] p-3">
          <ColorSliders
            value={value}
            onChange={onChange}
            chroma={BRAND_CHROMA}
            clearable
            preview={
              <span className="flex min-w-0 flex-1">
                <PlatformBadge platform={preview} />
              </span>
            }
          />
        </div>
      </Popover>
    </div>
  )
}
