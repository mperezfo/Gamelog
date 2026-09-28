import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

interface FilterPopoverProps {
  /** The button the popover hangs off of — also what a click on it, or on
   * the popover itself, should not count as "outside". */
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  width?: number
  children: ReactNode
}

/**
 * A small floating panel anchored under a trigger button, positioned with
 * `fixed` and a measured `left` rather than plain `absolute top-full`: the
 * triggers here (filter pills, the "+ Filter" button) can end up anywhere
 * along a wrapped row, and a popover wide enough to hold a search box and a
 * scrollable list would otherwise run off the right edge on a phone. Height
 * is bounded with `max-h-[40vh]` on the scrollable content instead of
 * flipping above the trigger when short on space below — simpler, and the
 * filter bar always sits near the top of the screen anyway.
 */
export function FilterPopover({ anchorRef, open, onClose, width = 224, children }: FilterPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    function place() {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
      setPosition({ top: rect.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRef, width])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, anchorRef])

  if (!open || !position) return null

  return (
    <div
      ref={popoverRef}
      style={{ top: position.top, left: position.left, width }}
      className="fixed z-30 overflow-hidden rounded-control border border-line bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
    >
      {children}
    </div>
  )
}
