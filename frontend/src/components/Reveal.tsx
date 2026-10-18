import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

interface RevealProps {
  open: boolean
  children: ReactNode
  /** Called once a closing animation has finished, so that the caller can
   * unmount what was inside. */
  onClosed?: () => void
}

/** The length of every move, the same as the slide-over panel's. */
const DURATION_MS = 200

/** What a Reveal offers the Reveals nested inside it. */
interface RevealParent {
  /** Asks the parent to follow its content's height as it is, without a
   * transition of its own, until the returned function is called. */
  hold: () => () => void
}

const RevealContext = createContext<RevealParent | null>(null)

/**
 * Grows open, shrinks closed, and follows its content's height in between,
 * all with the same short ease-out the slide-over panel uses.
 *
 * A height can only be animated between two lengths, never to `auto`, so the
 * content is measured (a ResizeObserver, which also catches it changing on
 * its own) and the wrapper animates to that. Overflow is clipped only while
 * moving: once settled, a dropdown inside can spill out of it as usual.
 */
export function Reveal({ open, children, onClosed }: RevealProps) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)
  // False for the first frame after mounting, so that something mounted
  // already open still grows from nothing instead of popping in.
  const [mounted, setMounted] = useState(false)

  const expanded = open && mounted
  const target = expanded ? contentHeight : 0

  // A new target starts a move. Tracked during render rather than from the
  // transition's own events, so that the very first frame of a move is
  // already clipped.
  const [lastTarget, setLastTarget] = useState(target)
  const [moving, setMoving] = useState(false)
  if (target !== lastTarget) {
    setLastTarget(target)
    setMoving(true)
  }

  // A nested Reveal animating its own height makes this one's content change
  // size on every frame. Chasing each of those with a transition of its own
  // would lag behind and cut the content short, so while any nested one is
  // moving, this one simply takes its content's height.
  const parent = useContext(RevealContext)
  const [holds, setHolds] = useState(0)
  const asParent = useMemo<RevealParent>(
    () => ({
      hold: () => {
        setHolds((n) => n + 1)
        return () => setHolds((n) => n - 1)
      },
    }),
    [],
  )
  useLayoutEffect(() => {
    if (!moving || !parent) return
    return parent.hold()
  }, [moving, parent])

  const onClosedRef = useRef(onClosed)
  useEffect(() => {
    onClosedRef.current = onClosed
  })

  // A timer rather than transitionend, which never fires for a move that
  // turns out to be no move at all, or with reduced motion.
  useEffect(() => {
    if (!moving) return
    const timer = setTimeout(() => {
      setMoving(false)
      if (!open) onClosedRef.current?.()
    }, DURATION_MS + 20)
    return () => clearTimeout(timer)
  }, [moving, lastTarget, open])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const observer = new ResizeObserver(() => setContentHeight(inner.offsetHeight))
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      // Held, plain auto follows the content within the same frame, where a
      // measured height would always be a frame behind it.
      style={{ height: holds > 0 ? 'auto' : target, transitionDuration: `${DURATION_MS}ms` }}
      className={[
        'transition-[height,opacity] ease-out motion-reduce:transition-none',
        expanded ? 'opacity-100' : 'opacity-0',
        !expanded || moving ? 'overflow-hidden' : '',
      ].join(' ')}
      // Closed, what is inside is out of reach of the keyboard too.
      inert={!open}
    >
      <div ref={innerRef}>
        <RevealContext.Provider value={asParent}>{children}</RevealContext.Provider>
      </div>
    </div>
  )
}
