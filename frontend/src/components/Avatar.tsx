import { UserIcon } from './icons'

interface AvatarProps {
  avatarUrl: string | null
  className?: string
}

/** A profile picture, or a plain silhouette while there is none. */
export function Avatar({ avatarUrl, className = 'size-6' }: AvatarProps) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className={`${className} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${className} flex shrink-0 items-center justify-center rounded-full bg-sunken text-ink-faint`}>
      <UserIcon className="size-[60%]" />
    </span>
  )
}
