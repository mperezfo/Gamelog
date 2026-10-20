import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DialogProps {
  /** Names the dialog for assistive technology. */
  'aria-label': string
  onClose: () => void
  children: ReactNode
}

/**
 * A popup over everything else: the whole screen on a phone, a large panel
 * in the middle of it from `sm` up. Escape and a click outside close it.
 *
 * Rendered into `document.body` rather than where it is used: it opens from
 * inside the game modal, which is a transformed element, and a transformed
 * ancestor makes `fixed` position against itself instead of the viewport
 * (see Popover).
 */
export function Dialog({ 'aria-label': ariaLabel, onClose, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Read through a ref, so that the listener below is added once rather
  // than on every render of a parent that passes a new function.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Focus moves in, so that keys reach the dialog, and back to where it was
  // on the way out.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // Escape closes the dialog alone, not the game modal under it, which
  // listens on the document. An Escape from inside the dialog is handled by
  // onKeyDown below, after anything in it that has its own use for the key
  // (an open Popover closes first). This catches one from outside it, such
  // as from the body once a button that had focus is disabled, but not one
  // from a Popover opened from it, which is drawn outside it too.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      const target = event.target as Element
      if (panelRef.current?.contains(target) || target.closest?.('[data-popover]')) return
      event.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex sm:items-center sm:justify-center sm:p-6"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        className="absolute inset-0 animate-[gl-appear_150ms_ease-out] bg-black/50 motion-reduce:animate-none"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={[
          'relative flex h-full w-full animate-[gl-appear_150ms_ease-out] flex-col bg-surface outline-none motion-reduce:animate-none',
          'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
          // A fixed height rather than one that follows the content, so
          // that the panel does not jump as results come in.
          'sm:h-[min(85vh,56rem)] sm:max-w-5xl sm:rounded-control sm:pt-0 sm:pb-0',
          'sm:shadow-dialog',
        ].join(' ')}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
