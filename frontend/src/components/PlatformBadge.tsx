import type { CSSProperties } from 'react'

import type { Lookup } from '../types/lookup'
import { Emoji } from './Emoji'
import { HighlightMatch } from './HighlightMatch'

interface PlatformBadgeProps {
  platform: Lookup | null | undefined
  className?: string
  /** Characters of the name to draw bold, for a search that matched them
   * (see HighlightMatch). */
  highlight?: number[]
}

/**
 * A platform's name as a small tinted pill. The colour is the platform's
 * own choice (see the Platforms page), drawn through the `tint` utility
 * (index.css), which keeps its hue but sets its lightness for the theme, so
 * that any colour, white included, stays readable on either one.
 */
export function PlatformBadge({ platform, className = '', highlight }: PlatformBadgeProps) {
  if (!platform) return null

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${
        platform.color ? 'tint' : 'bg-sunken text-ink-muted'
      } ${className}`}
      style={platform.color ? ({ '--tint': platform.color } as CSSProperties) : undefined}
    >
      {platform.icon && <span aria-hidden="true"><Emoji value={platform.icon} /></span>}
      <span className="truncate">
        {highlight ? (
          <HighlightMatch text={platform.name} indices={highlight} matchClassName="font-bold" />
        ) : (
          <Emoji value={platform.name} />
        )}
      </span>
    </span>
  )
}
