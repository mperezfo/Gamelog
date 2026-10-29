import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import { autoUpdate, flip, offset, shift, size, useFloating, type Placement } from '@floating-ui/react-dom'

import { useMediaQuery } from '../hooks/useMediaQuery'

/** The popovers opened from inside another (a Dropdown in the date picker,
 * say). Each is drawn into `document.body` too, so it is not inside its
 * parent in the DOM, yet a press or focus in it is not "outside" it. */
const NestedPanels = createContext<Set<(node: Node) => boolean> | null>(null)

interface PopoverProps {
  /** What the popover hangs off. */
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  /** After Escape focus also goes back to the anchor; after a press
   * elsewhere it stays wherever that press put it. */
  onClose: () => void
  /** The button that opens and closes it, where it is not the anchor itself
   * (a field drawn around one, say). A press on it is not "outside", since
   * its own click is what toggles the popover, and focus goes back to it on
   * Escape. A press anywhere else, the rest of the anchor included, closes
   * the popover. Defaults to the anchor. */
  triggerRef?: RefObject<HTMLElement | null>
  placement?: Placement
  /** `listbox` for a plain list of options (see Dropdown), whose rows are
   * then the panel's own children. */
  role?: 'dialog' | 'listbox'
  id?: string
  /** Names the popover for assistive technology. */
  'aria-label'?: string
  /** Keys the panel has a use for besides Escape and Tab, such as the
   * arrow keys of a list. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  className?: string
  /** For a preview opened by pointing at the anchor rather than clicking
   * it: focus stays where it is, Escape works from anywhere, and the panel
   * touches its anchor, so that the pointer can cross from one to the other
   * without passing over anything else. The visible box keeps its usual
   * distance through a transparent margin, which is part of the panel. */
  hover?: boolean
  /** For a hover popover whose content is not a child of what opened it in
   * React's tree, to tell when the pointer is over it. */
  onPointerEnter?: (event: PointerEvent<HTMLDivElement>) => void
  onPointerLeave?: (event: PointerEvent<HTMLDivElement>) => void
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}

/** How the panel looks: fading in as it opens, and out as it closes. */
const BOX = 'z-[70] rounded-control border border-line bg-surface shadow-popover outline-none'
const OPENING = 'animate-[gl-appear_100ms_ease-out] motion-reduce:animate-none'
const CLOSING = 'pointer-events-none animate-[gl-disappear_100ms_ease-in_forwards]'

/** Between the panel and its anchor. */
const GAP = 4

/** What Tab can land on. */
const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]'

/**
 * The floating panel of every picker, list and filter in the app: the date,
 * colour and emoji pickers, Dropdown, the filter popovers and the like.
 *
 * Drawn into `document.body` and positioned by Floating UI, `fixed`: it opens
 * from inside the game modal, a transformed element that would make `fixed`
 * position against itself (see Dialog), and from controls anywhere on the
 * screen, so it flips above its anchor where there is no room below and
 * keeps clear of the sides on a phone. Two CSS variables on the panel size
 * its contents: `--popover-anchor-width`, for a list as wide as its trigger,
 * and `--popover-available-height`, the room left on the side it opened on.
 *
 * Focus moves into it on opening. Escape, a press outside it or Tab out of
 * it close it; Escape goes no further, so the modal underneath stays open,
 * and Tab carries on from its trigger, as if the panel sat right after it.
 *
 * It fades in as it opens and out as it closes. While it fades out it is
 * only a picture of itself: inert, out of the way of the pointer, no longer
 * counted as open (see useShortcut), and showing what it showed when it
 * closed, rather than whatever its owner resets as it closes it (the
 * "+ Filter" menu going back to its first step, say).
 */
export function Popover({
  anchorRef,
  triggerRef = anchorRef,
  open,
  onClose,
  placement = 'bottom-start',
  role = 'dialog',
  id,
  'aria-label': ariaLabel,
  onKeyDown,
  className = '',
  hover = false,
  onPointerEnter,
  onPointerLeave,
  ref,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setClosing(!open && !reduceMotion)
  }
  // What it showed last while open, to keep showing as it fades out.
  const [shown, setShown] = useState(children)
  if (open && shown !== children) setShown(children)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // The panel and every popover opened from inside it.
  const [nested] = useState(() => new Set<(node: Node) => boolean>())
  const [contains] = useState(
    () => (node: Node) => Boolean(panelRef.current?.contains(node)) || [...nested].some((inside) => inside(node)),
  )
  const parent = useContext(NestedPanels)
  useEffect(() => {
    if (!open || !parent) return
    parent.add(contains)
    return () => {
      parent.delete(contains)
    }
  }, [open, parent, contains])

  const { refs, floatingStyles } = useFloating({
    open: open || closing,
    placement,
    strategy: 'fixed',
    middleware: [
      offset(hover ? 0 : GAP),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, availableHeight, elements }) {
          elements.floating.style.setProperty('--popover-anchor-width', `${rects.reference.width}px`)
          elements.floating.style.setProperty('--popover-available-height', `${Math.floor(availableHeight)}px`)
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Stable, rather than an inline callback: React detaches a ref that
  // changes and attaches the new one after the panel's children, so an
  // inline one leaves the panel unset on every render for a moment. A child
  // that takes focus as it mounts (the "+ Filter" value list, say) would do
  // so right then, and the focus would read as having left the panel.
  const setPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node
      refs.setFloating(node)
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [refs, ref],
  )

  useLayoutEffect(() => {
    refs.setReference(anchorRef.current)
  }, [refs, anchorRef, open, closing])

  useEffect(() => {
    if (!open || !hover) return
    // Focus never moves into a preview, so its Escape has to be heard here.
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, hover])

  useEffect(() => {
    if (!open) return
    // The first thing in it that takes focus, or the panel itself. Done
    // once it has been placed, so that focusing it does not scroll to
    // wherever it was drawn first.
    const frame = requestAnimationFrame(() => {
      if (hover) return
      const panel = panelRef.current
      // Something in it may have taken focus by itself already.
      if (panel?.contains(document.activeElement)) return
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel
      target?.focus({ preventScroll: true })
    })

    // A press, or focus, anywhere else: Tab out of it, say, even from the
    // trigger before focus has moved in.
    function handleOutside(event: Event) {
      const target = event.target as Node
      if (contains(target) || triggerRef.current?.contains(target)) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', handleOutside)
    document.addEventListener('focusin', handleOutside)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handleOutside)
      document.removeEventListener('focusin', handleOutside)
    }
  }, [open, hover, triggerRef, contains])

  /** Tab past either end of the panel. The panel sits at the end of the
   * page, so the browser would carry on from there: focus goes back to the
   * trigger instead, and the browser's own Tab carries on from it, onto
   * whatever follows it, or with Shift stops on the trigger itself. */
  function handleTab(event: KeyboardEvent<HTMLDivElement>) {
    const panel = event.currentTarget
    const tabbable = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(
      (element) => element.tabIndex >= 0 && !element.matches(':disabled'),
    )
    const index = tabbable.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey ? index > 0 : index < tabbable.length - 1) return
    const trigger = triggerRef.current
    if (!trigger) return
    if (event.shiftKey) event.preventDefault()
    trigger.focus()
    onClose()
  }

  if (!open && !closing) return null

  const box = [BOX, closing ? CLOSING : OPENING, className].join(' ')

  return createPortal(
    <NestedPanels.Provider value={nested}>
      <div
        ref={setPanel}
        id={id}
        role={closing ? undefined : role}
        data-popover={closing ? undefined : ''}
        inert={closing}
        aria-label={ariaLabel}
        tabIndex={-1}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // A key from a popover opened inside this one is that one's.
          if (!event.currentTarget.contains(event.target as Node)) return
          if (event.key === 'Tab') handleTab(event)
          if (event.key !== 'Escape') return
          event.stopPropagation()
          onClose()
          triggerRef.current?.focus()
        }}
        onAnimationEnd={(event) => {
          if (event.animationName === 'gl-disappear') setClosing(false)
        }}
        className={hover ? 'z-[70] outline-none' : box}
        style={hover ? { ...floatingStyles, padding: GAP } : floatingStyles}
      >
        {hover ? <div className={box}>{shown}</div> : shown}
      </div>
    </NestedPanels.Provider>,
    document.body,
  )
}
