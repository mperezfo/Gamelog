import { useEffect, useRef, type ReactNode } from 'react'

import { useSession, useUpdatePreferences } from '../hooks/useSession'
import { ThemeContext } from './themeContext'
import { useTheme } from './useTheme'
import type { Theme } from './theme'

/**
 * Makes the theme choice available to everything below it, and keeps it in
 * sync with the account: once the session loads, its stored theme (which may
 * differ from what this browser had cached — see theme.ts) wins, and any
 * further change a signed-in account makes is written back.
 *
 * Not signed in yet (the login screen), the local cache is all there is, and
 * a change made there — there is nowhere in the UI to make one before
 * signing in, but nothing stops it structurally — is simply not persisted.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme()
  const session = useSession()
  const updatePreferences = useUpdatePreferences()

  // Only once per signed-in account, not on every render this theme happens
  // to differ from the account's own — otherwise a change made here would
  // immediately be overwritten back to what the account had on the last page
  // load.
  const syncedUserID = useRef<number | null>(null)

  useEffect(() => {
    const user = session.data
    if (!user || syncedUserID.current === user.id) return
    syncedUserID.current = user.id
    if (user.theme !== theme) setTheme(user.theme)
  }, [session.data, theme, setTheme])

  function changeTheme(next: Theme) {
    setTheme(next)
    const user = session.data
    if (user) updatePreferences.mutate({ theme: next, dateFormat: user.date_format, gamesView: user.games_view })
  }

  return <ThemeContext value={{ theme, setTheme: changeTheme }}>{children}</ThemeContext>
}
