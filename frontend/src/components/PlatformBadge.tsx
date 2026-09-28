import type { Lookup } from '../types/lookup'

interface PlatformBadgeProps {
  platform: Lookup | null | undefined
  className?: string
}

/**
 * A platform's name as a small tinted pill — the colour is the platform's
 * own choice (see the Platforms page), always a low-opacity tint of it rather
 * than a solid fill, so an arbitrary user-picked colour never fights with the
 * text on top of it in either theme.
 */
export function PlatformBadge({ platform, className = '' }: PlatformBadgeProps) {
  if (!platform) return null

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${
        platform.color ? '' : 'bg-sunken text-ink-muted'
      } ${className}`}
      style={platform.color ? { backgroundColor: `${platform.color}22`, color: platform.color } : undefined}
    >
      {platform.icon && <span aria-hidden="true">{platform.icon}</span>}
      <span className="truncate">{platform.name}</span>
    </span>
  )
}
