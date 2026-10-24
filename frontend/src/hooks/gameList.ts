import { createContext } from 'react'

/** The games the panel was opened from, in their order on screen, by id,
 * and the way to change them (see GameListProvider). */
export interface GameList {
  ids: number[] | null
  setIds: (ids: number[] | null) => void
}

/** Lives apart from its provider for the reason themeContext gives. */
export const GameListContext = createContext<GameList | null>(null)
