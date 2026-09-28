import { useEffect, useState } from 'react'

/** Whether the sidebar stays fully open, or collapses to an icon rail that
 * expands on hover — see Sidebar.tsx. A per-browser preference like the
 * theme's own localStorage cache (see theme.ts), not an account setting:
 * it's about this screen's layout, not something worth following a person
 * to another device. */
const STORAGE_KEY = 'gamelog.sidebarPinned'

function readStored(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true' || stored === 'false') return stored === 'true'
  } catch {
    // Storage can be blocked entirely; the default is still fine.
  }
  return true
}

/** Defaults to pinned — today's always-open sidebar — so nobody's layout
 * changes underneath them until they deliberately collapse it. */
export function useSidebarPinned(): [boolean, (pinned: boolean) => void] {
  const [pinned, setPinned] = useState(readStored)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(pinned))
    } catch {
      // The choice then lasts for this page only, which is better than failing.
    }
  }, [pinned])

  return [pinned, setPinned]
}
