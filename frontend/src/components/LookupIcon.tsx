import type { CSSProperties } from 'react'

import { GENRE_ICONS_PATH, iconName } from '../lib/genreIcons'
import { Emoji } from './Emoji'

/**
 * A genre's icon: one of Tabler's, drawn in the colour of the text around it,
 * or an emoji (see Emoji).
 *
 * The icon is the SVG genreIconsPlugin serves (vite.config.ts) used as a
 * mask over the text's colour, so it follows the theme. A colour of the
 * genre's own takes its place, exactly as it was picked in either theme;
 * an emoji ignores it. Sized and placed like an emoji, so that the two sit
 * the same beside a name. A name with no file shows nothing.
 */
export function LookupIcon({ value, color }: { value: string; color?: string | null }) {
  const name = iconName(value)
  if (!name) return <Emoji value={value} />

  const mask = `url(${GENRE_ICONS_PATH}${name}.svg) center / contain no-repeat`
  return (
    <span
      className="inline-block size-[1.15em] bg-current align-[-0.2em]"
      style={{ mask, WebkitMask: mask, color: color ?? undefined } as CSSProperties}
    />
  )
}
