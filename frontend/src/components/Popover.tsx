import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react-dom'

interface PopoverProps {
  /** What the popover hangs off. A press on it is not "outside": its own
   * click is what opens and closes the popover. */
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  /** After Escape focus also goes back to the anchor; after a press
   * elsewhere it stays wherever that press put it. */
  onClose: () => void
  /** Where focus goes back to on Escape, when the anchor itself does not
   * take it (a field drawn around a button, say). Defaults to the anchor. */
  returnFocusRef?: RefObject<HTMLElement | null>
  placement?: Placement
  /** Names the popover for assistive technology. */
  'aria-label': string
  className?: string
  children: ReactNode
}

/**
 * A small floating panel under a control, for the pickers that stand in for
 * the browser's own (date, colour, emoji).
 *
 * Drawn into `document.body` and positioned by Floating UI, `fixed`: it opens
 * from inside the game modal, a transformed element that would make `fixed`
 * position against itself (see Dialog), and from fields anywhere on the
 * screen, so it flips above its anchor where there is no room below and
 * keeps clear of the sides on a phone.
 *
 * Focus moves into it on opening. Escape, a press outside it or Tab out of
 * it close it; Escape goes no further, so the modal underneath stays open.
 */
export function Popover({
  anchorRef,
  returnFocusRef = anchorRef,
  open,
  onClose,
  placement = 'bottom-start',
  'aria-label': ariaLabel,
  className = '',
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  const { refs, floatingStyles } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  useLayoutEffect(() => {
    refs.setReference(anchorRef.current)
  }, [refs, anchorRef, open])

  useEffect(() => {
    if (!open) return
    // The first thing in it that takes focus, or the panel itself. Done
    // once it has been placed, so that focusing it does not scroll to
    // wherever it was drawn first.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      // Something in it may have taken focus by itself already.
      if (panel?.contains(document.activeElement)) return
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel
      target?.focus({ preventScroll: true })
    })

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={(node) => {
        panelRef.current = node
        refs.setFloating(node)
      }}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={floatingStyles}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
        returnFocusRef.current?.focus()
      }}
      onBlur={(event) => {
        // Tab out of it, not a move between two things inside it.
        const next = event.relatedTarget as Node | null
        if (next && !event.currentTarget.contains(next) && !anchorRef.current?.contains(next)) onClose()
      }}
      className={[
        'z-[70] animate-[gl-appear_100ms_ease-out] rounded-control border border-line bg-surface outline-none',
        'shadow-[0_8px_24px_rgba(0,0,0,0.16)] motion-reduce:animate-none',
        className,
      ].join(' ')}
    >
      {children}
    </div>,
    document.body,
  )
}
