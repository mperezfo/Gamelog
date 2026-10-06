/**
 * Theme choice and how it is stored.
 *
 * The account is the source of truth (see models.User.Theme on the backend),
 * so the choice follows a person across devices and is part of the backup.
 * A copy still lives in localStorage purely as a paint cache: it is read
 * before the session has, which is what lets the very first paint — and the
 * login screen, before there is an account to read a theme from — apply the
 * last-known theme instead of flashing light and then repainting dark.
 */

import type { Theme } from '../types/auth'
export type { Theme }

/** Where the choice is kept. Mirrored by the inline script in index.html.
 *
 * This is now a cache of the account's own theme (see models.User.Theme on
 * the backend) rather than the source of truth: it exists so the very first
 * paint — before the session has even loaded — does not flash the wrong
 * theme, and so the choice still applies on the login screen, before there
 * is an account to read it from at all. */
const STORAGE_KEY = 'gamelog.theme'

/** The themes a switch offers, in the order it shows them. */
export const THEMES: readonly Theme[] = ['light', 'dark', 'system']

/** Reads the stored choice, defaulting to following the system. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
  } catch {
    // Storage can be blocked entirely; the default is still fine.
  }
  return 'system'
}

/** Stores a choice, ignoring a browser that refuses to keep it. */
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // The choice then lasts for this page only, which is better than failing.
  }
}

/** Whether a choice means a dark page right now. */
export function isDark(theme: Theme): boolean {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return theme === 'dark'
}

/**
 * Applies a choice to the document.
 *
 * `color-scheme` is set alongside the class so that the parts of the page the
 * application does not paint — scrollbars, form controls, the canvas behind a
 * bounce scroll — follow the theme too. `theme-color` does the same for the
 * browser UI around the page, such as the status bar on Android.
 */
export function applyTheme(theme: Theme): void {
  const dark = isDark(theme)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--gl-canvas').trim()
  if (canvas) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', canvas)
  }
}
