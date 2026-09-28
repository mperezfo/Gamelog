import { createContext, use } from 'react'

import type { Theme } from './theme'

export interface ThemeChoice {
  theme: Theme
  setTheme: (theme: Theme) => void
}

/**
 * Holds the theme choice for the whole application.
 *
 * A context rather than a hook called wherever it is needed: two switches on
 * screen at once would otherwise each keep their own idea of the current
 * theme, and one would go stale the moment the other was used.
 *
 * The context and its hook live apart from the provider component so that the
 * file holding the component exports nothing but components, which is what
 * keeps fast refresh working during development.
 */
export const ThemeContext = createContext<ThemeChoice | null>(null)

/** The current theme and a way to change it. */
export function useThemeChoice(): ThemeChoice {
  const choice = use(ThemeContext)
  if (!choice) {
    throw new Error('useThemeChoice was called outside ThemeProvider')
  }
  return choice
}
