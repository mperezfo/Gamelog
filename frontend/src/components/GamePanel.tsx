import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Game } from '../types/game'
import { Button } from './Button'
import { GameForm } from './GameForm'
import { XIcon } from './icons'

interface GamePanelProps {
  /** Undefined means creating a new game. */
  game?: Game
  onClose: () => void
}

/** How long the slide takes, in ms — kept in one place since the exit timer
 * has to match the CSS transition duration below. */
const TRANSITION_MS = 200

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
  const [confirmingClose, setConfirmingClose] = useState(false)

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

  // Closes for good, skipping the confirmation — for the paths where there
  // is nothing left to lose: a successful save or delete.
  function closeNow() {
    setVisible(false)
    setTimeout(onClose, TRANSITION_MS)
  }

  // Confirming only when there is something to lose: a blank, untouched
  // "new game" form is exactly as disposable as no form at all.
  const needsConfirm = dirty

  function requestClose() {
    if (confirmingClose) return
    if (needsConfirm) {
      setConfirmingClose(true)
      return
    }
    closeNow()
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
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
          'shadow-[-12px_0_32px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out sm:w-[760px]',
          visible ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold tracking-tight text-ink">
              {game ? 'Edit game' : 'New game'}
            </h2>
            {game && (
              <Link
                to={`/games/${game.slug}`}
                onClick={requestClose}
                className="text-xs font-medium text-accent hover:underline"
              >
                Open full page
              </Link>
            )}
          </div>
          <Button variant="ghost" className="px-2" onClick={requestClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>

        {confirmingClose && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-ink">
            <span>Discard unsaved changes?</span>
            <div className="flex gap-2">
              <Button variant="danger" onClick={closeNow}>
                Discard
              </Button>
              <Button onClick={() => setConfirmingClose(false)}>Keep editing</Button>
            </div>
          </div>
        )}

        <GameForm
          // Keyed by which game this is: GameForm seeds its fields from
          // `game` only once, via useState, so swapping to a different game
          // (or from the blank "new game" form to an existing one, as the
          // duplicate-title notice's "Open it" link does) has to remount it
          // rather than leave it showing the previous game's stale fields.
          key={game?.slug ?? 'new'}
          game={game}
          onSaved={closeNow}
          onDeleted={closeNow}
          onCancel={requestClose}
          onDirtyChange={setDirty}
        />
      </div>
    </div>
  )
}
