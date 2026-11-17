import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { GameListContext } from '../hooks/gameList'

/** Kept for the tab, so that a reload with the panel open keeps its previous
 * and next. Ids rather than slugs: renaming a game changes its slug. */
const STORAGE_KEY = 'gamelog.panelList'

function readStored(): number[] | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    if (Array.isArray(stored) && stored.every((id) => typeof id === 'number')) return stored
  } catch {
    // Blocked or unreadable storage: no list, as if it was never kept.
  }
  return null
}

/**
 * The list the game panel was opened from (a page of Games, a column of the
 * board), for it to step to the previous and next game (see useGameModal).
 * One for the whole shell, like the panel itself.
 */
export function GameListProvider({ children }: { children: ReactNode }) {
  const [ids, setIdsState] = useState(readStored)

  const setIds = useCallback((next: number[] | null) => {
    setIdsState(next)
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // The list then lasts until a reload, which is fine.
    }
  }, [])

  const value = useMemo(() => ({ ids, setIds }), [ids, setIds])
  return <GameListContext value={value}>{children}</GameListContext>
}
