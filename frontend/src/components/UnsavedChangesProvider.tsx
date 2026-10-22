import { useCallback, useMemo, useState, type ReactNode } from 'react'

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

  const discard = useCallback(() => {
    pending?.()
    setPending(null)
  }, [pending])

  const keep = useCallback(() => setPending(null), [])

  const dirty = holds > 0
  const value = useMemo(
    () => ({
      dirty,
      hold,
      requestLeave,
      // A form saved or closed while the question was up leaves nothing to
      // ask about any more.
      leaving: pending !== null && dirty,
      discard,
      keep,
    }),
    [dirty, hold, requestLeave, pending, discard, keep],
  )

  return <UnsavedChangesContext value={value}>{children}</UnsavedChangesContext>
}
