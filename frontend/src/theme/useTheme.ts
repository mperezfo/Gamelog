import { useCallback, useEffect, useState } from 'react'

import { applyTheme, readTheme, storeTheme, type Theme } from './theme'

/**
 * The current theme and a way to change it.
 *
 * While the choice is `system`, the hook follows the operating system as it
 * changes: switching a laptop to dark at sunset repaints the page without a
 * reload.
 */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = () => applyTheme('system')
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next)
    setThemeState(next)
  }, [])

  return { theme, setTheme }
}
