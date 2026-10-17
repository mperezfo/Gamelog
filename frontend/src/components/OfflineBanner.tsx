import { useOffline } from '../hooks/useOffline'

/** Says why nothing can be changed while the server cannot be reached, for
 * as long as it cannot. Quiet on purpose: a strip, not an alert, since
 * everything that can still be done keeps working underneath it. */
export function OfflineBanner() {
  const offline = useOffline()
  if (!offline) return null

  return (
    <p role="status" className="shrink-0 border-b border-line bg-sunken px-4 py-1.5 text-[12px] text-ink-muted sm:px-6">
      <span className="font-medium text-ink">Offline.</span> Showing the copy saved on this device; changes are
      disabled until the server is back.
    </p>
  )
}
