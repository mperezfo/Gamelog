import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useGameModal } from '../hooks/useGameModal'
import { useOffline } from '../hooks/useOffline'
import { useUnsavedChangesContext } from '../hooks/unsavedChanges'
import type { Game } from '../types/game'
import { Button } from './Button'
import { DiscardPrompt } from './DiscardPrompt'
import { GameForm } from './GameForm'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from './icons'
import { isTypingTarget } from '../lib/keyboard'

interface GamePanelProps {
  /** Undefined means creating a new game. */
  game?: Game
  onClose: () => void
}

/** How long the slide takes, in ms — kept in one place since the exit timer
 * has to match the CSS transition duration below. */
const TRANSITION_MS = 200

/** What the "discard unsaved changes?" prompt is standing in the way of:
 * closing the panel, leaving it for the game's full page, or moving on to
 * another game of the list it was opened from. */
type PendingDiscard = 'close' | 'fullPage' | { step: Game }

/** Where the arrow keys belong to what has focus, not to the panel: a list
 * of options, a menu, a calendar. */
const OWNS_ARROWS = '[data-popover], [role="listbox"], [role="menu"], [role="dialog"], [role="grid"]'

/**
 * The slide-over used to create or edit a game without leaving the dashboard
 * or the table underneath it. `/games/:id` renders the same `GameForm` full
 * page for a direct link or a search result — this is the quick path.
 *
 * `onClose` is expected to unmount this component: the slide-out only reads
 * as an animation if the panel is still there to animate while it plays, so
 * closing sets local state and calls `onClose` itself once the transition
 * has had time to finish, rather than unmounting immediately.
 */
export function GamePanel({ game, onClose }: GamePanelProps) {
  const [visible, setVisible] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const navigate = useNavigate()
  const offline = useOffline()
  const unsaved = useUnsavedChangesContext()
  const modal = useGameModal()
  // Previous and next, while the game was opened from a list and is in it.
  const neighbours = game ? modal.neighbours : null
  // The game as the last save left it, and how many saves there have been:
  // with a list to step through, a save keeps the panel open on the game
  // (see saved), its form started over from what the server stored.
  const [saved, setSaved] = useState<{ game: Game; count: number }>()
  useDocumentTitle(game ? game.title : 'New game')

  // Starts off-screen and slides in on the next frame — starting `visible`
  // true would skip the transition, since there would be nothing to animate
  // from.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // A close still waiting out its slide-out is dropped if the panel goes away
  // some other way first. `onClose` rewrites the query string against the
  // page the panel was opened on, so running it late (after "Open full page"
  // has already navigated to /games/:id, say) would send the user straight
  // back to that page.
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // Closes for good, skipping the confirmation — for the paths where there
  // is nothing left to lose: a successful save or delete.
  function closeNow() {
    setVisible(false)
    closeTimer.current = window.setTimeout(onClose, TRANSITION_MS)
  }

  // Confirming only when there is something to lose: a blank, untouched
  // "new game" form is exactly as disposable as no form at all.
  const needsConfirm = dirty

  function requestClose() {
    if (pendingDiscard) return
    if (needsConfirm) {
      setPendingDiscard('close')
      return
    }
    closeNow()
  }

  // Leaving for the full page needs no close of its own: its URL carries no
  // `?modal=`, so the panel unmounts as soon as the route changes. It only
  // has to wait for the same confirmation a close would, unless it opens in
  // another tab and leaves this one, edits included, where it is.
  function openFullPage(event: MouseEvent) {
    const newTab = event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (!needsConfirm || newTab) return
    event.preventDefault()
    setPendingDiscard('fullPage')
  }

  function stepTo(target: Game | undefined) {
    if (!target || pendingDiscard) return
    if (needsConfirm) {
      setPendingDiscard({ step: target })
      return
    }
    modal.show(target)
  }

  function discard() {
    if (pendingDiscard === 'fullPage' && game) {
      navigate(`/games/${game.slug}`)
      return
    }
    if (typeof pendingDiscard === 'object' && pendingDiscard) {
      setPendingDiscard(null)
      modal.show(pendingDiscard.step)
      return
    }
    closeNow()
  }

  // Saving closes the panel, unless there is a list to carry on through:
  // then it stays on the game, for the arrows to move on when ready. A
  // rename changes the game's slug, which the address follows.
  function handleSaved(result: Game) {
    if (!neighbours) {
      closeNow()
      return
    }
    setSaved((current) => ({ game: result, count: (current?.count ?? 0) + 1 }))
    if (game && result.slug !== game.slug) modal.show(result)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && neighbours) {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        const focused = document.activeElement
        if (isTypingTarget(focused) || focused?.closest(OWNS_ARROWS)) return
        event.preventDefault()
        stepTo(event.key === 'ArrowLeft' ? neighbours.previous : neighbours.next)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  })

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={requestClose}
        aria-hidden="true"
      />

      <div
        className={[
          'relative flex h-full w-full flex-col overflow-y-auto bg-surface p-6',
          // No padding at the bottom: the form's action row, pinned there,
          // brings its own, safe area included.
          'pt-[calc(1.5rem+env(safe-area-inset-top))] pb-0',
          'shadow-panel transition-transform duration-200 ease-out sm:w-[760px]',
          visible ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold tracking-tight text-ink">
              {game ? (offline ? 'Game' : 'Edit game') : 'New game'}
            </h2>
            {game && (
              <Link
                to={`/games/${game.slug}`}
                onClick={openFullPage}
                className="text-xs font-medium text-accent hover:underline"
              >
                Open full page
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1">
            {neighbours && (
              <>
                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={() => stepTo(neighbours.previous)}
                  disabled={!neighbours.previous}
                  aria-label="Previous game"
                  data-tooltip="Previous game"
                  data-tooltip-kbd="←"
                  aria-keyshortcuts="ArrowLeft"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  className="px-2"
                  onClick={() => stepTo(neighbours.next)}
                  disabled={!neighbours.next}
                  aria-label="Next game"
                  data-tooltip="Next game"
                  data-tooltip-kbd="→"
                  aria-keyshortcuts="ArrowRight"
                >
                  <ChevronRightIcon />
                </Button>
              </>
            )}
            <Button variant="ghost" className="px-2" onClick={requestClose} aria-label="Close">
              <XIcon />
            </Button>
          </div>
        </div>

        <GameForm
          // Keyed by which game this is: GameForm seeds its fields from
          // `game` only once, via useState, so swapping to a different game
          // (or from the blank "new game" form to an existing one, as the
          // duplicate-title notice's "Open it" link does) has to remount it
          // rather than leave it showing the previous game's stale fields.
          // And by save, for a save that leaves the panel open (see
          // handleSaved), which starts it over from what was stored.
          key={`${game?.slug ?? 'new'}:${saved?.count ?? 0}`}
          game={saved && saved.game.id === game?.id ? saved.game : game}
          onSaved={handleSaved}
          onDeleted={closeNow}
          onCancel={requestClose}
          onDirtyChange={setDirty}
          // Lined up with this panel's own padding, so its background runs
          // edge to edge.
          stickyActionsClassName="-mx-6 px-6 pt-1 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
          actionsNotice={
            pendingDiscard ? (
              <DiscardPrompt onDiscard={discard} onKeep={() => setPendingDiscard(null)} />
            ) : (
              // The browser's Back, held back by the shell, asks here while
              // the panel covers the page (see AppShell).
              unsaved.leaving && <DiscardPrompt onDiscard={unsaved.discard} onKeep={unsaved.keep} />
            )
          }
        />
      </div>
    </div>
  )
}
