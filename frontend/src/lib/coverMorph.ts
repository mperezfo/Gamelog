import { flushSync } from 'react-dom'

/**
 * The game panel growing out of a cover in the Games grid, and shrinking
 * back into it, with the View Transitions API: the cover morphs into the
 * banner at the top of the panel while the rest of the page crossfades.
 *
 * A prototype. Without the API, or with reduced motion, the panel slides in
 * and out as it always has.
 */

/** The one name the morphing cover has, on the card or on the banner, never
 * both at once. */
const NAME = 'game-cover'

/** The game whose panel was opened by a morph, which is the only one that
 * closes by one: a panel opened from anywhere else has no card to go back
 * into. */
let morphedFrom: number | null = null

/** Whether a morph is putting the panel on screen right now: the panel then
 * starts where it ends, rather than off-screen to slide in. */
let opening = false

export function isMorphOpening(): boolean {
  return opening
}

function canMorph(): boolean {
  return 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The cover of a game's card in the grid, while it is on screen. */
function cardCover(gameId: number): HTMLElement | null {
  const cover = document.querySelector<HTMLElement>(`[data-game-card="${gameId}"] > :first-child`)
  if (!cover) return null
  const rect = cover.getBoundingClientRect()
  const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
  return onScreen ? cover : null
}

function banner(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cover-banner]')
}

/** Opens a game's panel by growing its card's cover into the banner. */
export function morphOpen(gameId: number, open: () => void) {
  const cover = cardCover(gameId)
  if (!cover || !canMorph()) {
    open()
    return
  }
  cover.style.viewTransitionName = NAME
  opening = true
  const transition = document.startViewTransition(() => {
    flushSync(open)
    cover.style.viewTransitionName = ''
    const target = banner()
    if (target) target.style.viewTransitionName = NAME
  })
  morphedFrom = gameId
  void transition.finished.finally(() => {
    opening = false
    const target = banner()
    if (target) target.style.viewTransitionName = ''
  })
}

/** Closes a game's panel by shrinking the banner back into its card, if it
 * was opened that way and the card is still on screen. Returns whether it
 * did: if not, the panel closes the usual way. */
export function morphClose(gameId: number, close: () => void): boolean {
  if (morphedFrom !== gameId) return false
  morphedFrom = null
  const cover = cardCover(gameId)
  const source = banner()
  if (!cover || !source || !canMorph()) return false

  source.style.viewTransitionName = NAME
  const transition = document.startViewTransition(() => {
    flushSync(close)
    cover.style.viewTransitionName = NAME
  })
  void transition.finished.finally(() => {
    cover.style.viewTransitionName = ''
  })
  return true
}
