import { useEffect, useState } from 'react'

import { useGames } from '../hooks/useGames'
import { useOffline } from '../hooks/useOffline'
import { CloudOffIcon } from './icons'

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** How long ago `then` was, worded in full ("5 minutes ago") and short ("5
 * min ago") for a narrow screen. */
function relativeTime(then: number, now: number): { long: string; short: string } {
  const minutes = Math.round((now - then) / 60_000)
  if (minutes < 1) return { long: 'just now', short: 'just now' }
  if (minutes < 60) return { long: RELATIVE.format(-minutes, 'minute'), short: `${minutes} min ago` }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { long: RELATIVE.format(-hours, 'hour'), short: `${hours} h ago` }
  const days = Math.round(hours / 24)
  return { long: RELATIVE.format(-days, 'day'), short: `${days} d ago` }
}

/** How long ago the library was last read from the server, which is how old
 * the copy on the device is. Kept current while shown. */
function useCopyAge() {
  const games = useGames()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  return games.dataUpdatedAt ? relativeTime(games.dataUpdatedAt, now) : null
}

/** Says why nothing can be changed while the server cannot be reached, and
 * how old what is shown instead is, for as long as it cannot. */
export function OfflineBanner() {
  const offline = useOffline()
  const age = useCopyAge()
  if (!offline) return null

  return (
    <p
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-[12px] text-amber-800 dark:text-amber-200"
    >
      <CloudOffIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="font-medium">Offline</span>
        <span className="opacity-80"> · read-only copy from this device</span>
        {age && (
          <span className="opacity-60">
            <span className="hidden sm:inline">, saved {age.long}</span>
            <span className="sm:hidden"> · {age.short}</span>
          </span>
        )}
      </span>
    </p>
  )
}
