import { useState } from 'react'

import { imageUrl } from '../lib/cover'
import { UserIcon } from './icons'

interface AvatarProps {
  avatarUrl: string | null
  className?: string
}

/** A profile picture, or a plain silhouette while there is none, or while
 * it cannot be loaded (offline and not kept on this device). */
export function Avatar({ avatarUrl, className = 'size-6' }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (avatarUrl && avatarUrl !== failedUrl) {
    return (
      <img
        src={imageUrl(avatarUrl, 'sm')}
        alt=""
        decoding="async"
        onError={() => setFailedUrl(avatarUrl)}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    )
  }
  return (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-full bg-sunken text-ink-faint`}>
      <UserIcon className="size-[60%]" />
    </span>
  )
}
