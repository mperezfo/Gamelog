import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'

import { UnsavedChangesContext } from '../hooks/unsavedChanges'

/**
 * Keeps count of the forms holding unsaved changes, and of the leave waiting
 * on whether to discard them (see unsavedChanges).
 *
 * A count rather than a flag: a game's own page and the game panel opened
 * over another page each hold a form of their own, and one being saved must
 * not clear the other.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [holds, setHolds] = useState(0)
  const [pending, setPending] = useState<(() => void) | null>(null)

  const hold = useCallback(() => {
    setHolds((count) => count + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      setHolds((count) => count - 1)
    }
  }, [])

  const requestLeave = useCallback(
    (leave: () => void) => {
      if (holds === 0) {
        leave()
        return
      }
      // Wrapped, since a function given to a state setter is called as an
      // updater rather than stored.
      setPending(() => leave)
    },
    [holds],
  )

  // The browser's Back (or Forward, or a phone's back gesture), which no link
  // of ours can ask before: held back, and asked about the same way. Only
  // those: every other navigation is one of the app's own, which asks first
  // where it has to (the sidebar), or follows a save.
  const blocker = useBlocker(({ historyAction }) => holds > 0 && historyAction === 'POP')
  const blocked = blocker.state === 'blocked'

  // A form saved or closed while the question was up leaves nothing to ask
  // about: stay where the Back was held back.
  useEffect(() => {
    if (blocker.state === 'blocked' && holds === 0) blocker.reset()
  }, [blocker, holds])

  const discard = useCallback(() => {
    if (blocker.state === 'blocked') blocker.proceed()
    pending?.()
    setPending(null)
  }, [pending, blocker])

  const keep = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset()
    setPending(null)
  }, [blocker])

  const dirty = holds > 0
  const value = useMemo(
    () => ({
      dirty,
      hold,
      requestLeave,
      // A form saved or closed while the question was up leaves nothing to
      // ask about any more.
      leaving: (pending !== null || blocked) && dirty,
      discard,
      keep,
    }),
    [dirty, hold, requestLeave, pending, blocked, discard, keep],
  )

  return <UnsavedChangesContext value={value}>{children}</UnsavedChangesContext>
}
