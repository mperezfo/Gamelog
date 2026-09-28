import { useSearchParams } from 'react-router-dom'

import type { Game } from '../types/game'
import { useGames } from './useGames'

/** Query parameter the open game/new-game panel is reflected in, so that
 * reloading the page — or following a link built by hand — reopens it. See
 * AppShell's LibraryShell, the one place that reads this to render the
 * panel: every page that can open one goes through this hook instead of
 * keeping its own local state, so there is only ever one panel on screen. */
const PARAM = 'modal'

/** Sentinel `?modal=` value for the "new game" form, which has no slug of
 * its own to point at. */
const NEW = 'new'

/**
 * The game panel's open/closed state, as the `?modal=` query parameter.
 *
 * A slug resolves against the already-loaded games list (the same one every
 * other view of the library reads, so this costs nothing extra); an unknown
 * slug simply renders nothing, same as no parameter at all.
 */
export function useGameModal() {
  const [searchParams, setSearchParams] = useSearchParams()
  const games = useGames()

  const raw = searchParams.get(PARAM)
  const creating = raw === NEW
  const game = raw && !creating ? games.data?.find((g) => g.slug === raw) : undefined

  function withParam(update: (next: URLSearchParams) => void) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      update(next)
      return next
    })
  }

  return {
    /** The game the panel is editing, once resolved. */
    game,
    /** Whether the panel is open for a new game. */
    creating,
    /** Opens the panel to edit an existing game. */
    openGame: (game: Game) => withParam((next) => next.set(PARAM, game.slug)),
    /** Opens the panel for a new game. */
    openNew: () => withParam((next) => next.set(PARAM, NEW)),
    /** Closes the panel. */
    close: () => withParam((next) => next.delete(PARAM)),
  }
}
