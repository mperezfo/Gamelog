import { createContext, use, useEffect } from 'react'

export interface UnsavedChanges {
  /** Whether any form on screen holds changes that have not been saved. */
  dirty: boolean
  /** Marks one more form as holding changes, until the returned function is
   * called. */
  hold: () => () => void
  /** Asks before `leave` runs, which is expected to take the forms holding
   * changes off screen (a navigation to another section, say). */
  requestLeave: (leave: () => void) => void
  /** Whether a leave is waiting on the user's answer. */
  leaving: boolean
  /** The two answers: drop the changes and go, or stay where they are. */
  discard: () => void
  keep: () => void
}

/**
 * What the forms of the library shell have left unsaved, for the sidebar to
 * ask before leaving the section they are in.
 *
 * React Router only blocks a navigation from a data router, which the app
 * does not use, so the links that leave a section ask here themselves (see
 * Sidebar). The context and its hooks live apart from the provider component
 * for the reason themeContext gives.
 */
export const UnsavedChangesContext = createContext<UnsavedChanges | null>(null)

/** The shell's unsaved changes and the way to leave them behind. */
export function useUnsavedChangesContext(): UnsavedChanges {
  const context = use(UnsavedChangesContext)
  if (!context) {
    throw new Error('useUnsavedChangesContext was called outside UnsavedChangesProvider')
  }
  return context
}

/**
 * Reports a form's unsaved changes: to the shell, which asks before a link in
 * the sidebar leaves them behind, and to the browser, which warns before the
 * tab is closed or reloaded.
 */
export function useUnsavedChanges(dirty: boolean) {
  const context = use(UnsavedChangesContext)
  const hold = context?.hold

  useEffect(() => {
    if (!dirty || !hold) return
    return hold()
  }, [dirty, hold])

  useEffect(() => {
    if (!dirty) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])
}
