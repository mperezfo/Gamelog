import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ToastContext, type Toast } from '../hooks/toast'
import { XIcon } from './icons'

/** How long a toast stays, in ms, unless it is pointed at or has focus. */
const DURATION_MS = 5000

/**
 * Shows one toast at a time (see toast), at the bottom of the screen.
 *
 * It goes away on its own after a few seconds, but never while the pointer
 * is on it or focus is in it: the wait starts over once both have left. The
 * region it appears in is a live region from the start, so that a screen
 * reader announces each message as it arrives.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Toast & { id: number }) | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const nextId = useRef(0)
  // The toast on screen, for show() to expire it without depending on it.
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  })

  const show = useCallback((toast: Toast) => {
    currentRef.current?.onExpire?.()
    nextId.current += 1
    const next = { ...toast, id: nextId.current }
    currentRef.current = next
    setCurrent(next)
  }, [])

  const expire = useCallback(() => {
    const toast = currentRef.current
    if (!toast) return
    currentRef.current = null
    setCurrent(null)
    setHovered(false)
    setFocused(false)
    toast.onExpire?.()
  }, [])

  const paused = hovered || focused
  useEffect(() => {
    if (!current || paused) return
    const timer = setTimeout(expire, DURATION_MS)
    return () => clearTimeout(timer)
  }, [current, paused, expire])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[70] flex justify-center"
      >
        {current && (
          <div
            key={current.id}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
            }}
            className={[
              'pointer-events-auto flex max-w-full items-center gap-3 rounded-control bg-tooltip py-1.5 pr-1.5 pl-3',
              'text-[13px] text-tooltip-ink shadow-popover',
              'animate-[gl-appear_150ms_ease-out] motion-reduce:animate-none',
            ].join(' ')}
          >
            <span className="min-w-0 truncate">{current.message}</span>
            {current.action && (
              <button
                type="button"
                onClick={() => {
                  const { action } = current
                  currentRef.current = null
                  setCurrent(null)
                  setHovered(false)
                  setFocused(false)
                  action?.onPress()
                }}
                className="shrink-0 rounded-control px-2 py-1 font-semibold text-accent transition-colors duration-75 hover:bg-white/10"
              >
                {current.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={expire}
              aria-label="Dismiss"
              className="flex size-6 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity duration-75 hover:opacity-100"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </ToastContext>
  )
}
