import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

/** How long the pointer rests on something before its preview opens, so
 * that passing over it on the way somewhere else does not flash it. */
const OPEN_DELAY_MS = 300

/** How long a preview stays once the pointer has left both what opened it
 * and the preview itself, so that a pointer cutting a corner between them
 * does not close it. */
const CLOSE_GRACE_MS = 150

/**
 * When a games preview pointed at with a mouse opens and closes, for one or
 * several things that open one (the bars of a chart, say, each with a key).
 * Moving from one of them to the next while a preview shows switches it at
 * once, without waiting all over again. A touch screen has no hover, so
 * there nothing opens.
 */
export function useHoverPreview<K>() {
  const [open, setOpen] = useState<K | null>(null)
  const openRef = useRef<K | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const set = useCallback((next: K | null) => {
    openRef.current = next
    setOpen(next)
  }, [])

  return {
    open,
    /** The pointer reached what opens the preview of `key`. */
    enter: (key: K, event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      clearTimeout(timer.current)
      if (openRef.current !== null) set(key)
      else timer.current = setTimeout(() => set(key), OPEN_DELAY_MS)
    },
    /** The pointer left it, or the preview. */
    leave: (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      clearTimeout(timer.current)
      if (openRef.current !== null) timer.current = setTimeout(() => set(null), CLOSE_GRACE_MS)
    },
    /** The pointer is over the preview itself. */
    keep: () => clearTimeout(timer.current),
    close: () => {
      clearTimeout(timer.current)
      set(null)
    },
  }
}
