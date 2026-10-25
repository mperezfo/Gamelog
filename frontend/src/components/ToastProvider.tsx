import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ToastContext, type Toast } from '../hooks/toast'
import { XIcon } from './icons'

/** How long a toast stays, in ms, unless it is pointed at or has focus. */
const DURATION_MS = 5000

/**
 * Shows one toast at a time (see toast), at the bottom of the screen.
 *
 * It goes away on its own after a few seconds, which a bar along its bottom
 * counts down, but never while the pointer is on it or focus is in it: the
 * countdown stops there and carries on once both have left. The region it
 * appears in is a live region from the start, so that a screen reader
 * announces each message as it arrives.
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
  // How much of its time the toast on screen has left, in ms.
  const remaining = useRef({ id: 0, ms: DURATION_MS })

  const show = useCallback((toast: Toast) => {
    currentRef.current?.onExpire?.()
    nextId.current += 1
    const next = { ...toast, id: nextId.current }
    currentRef.current = next
    remaining.current = { id: next.id, ms: DURATION_MS }
    setCurrent(next)
  }, [])

  const dismiss = useCallback(() => {
    currentRef.current = null
    setCurrent(null)
    setHovered(false)
    setFocused(false)
  }, [])

  const expire = useCallback(() => {
    const toast = currentRef.current
    if (!toast) return
    dismiss()
    toast.onExpire?.()
  }, [dismiss])

  // Counts down only while not paused, keeping what is left across a pause,
  // the way the bar's animation does.
  const paused = hovered || focused
  useEffect(() => {
    if (!current || paused) return
    const startedAt = performance.now()
    const timer = setTimeout(expire, remaining.current.ms)
    return () => {
      clearTimeout(timer)
      if (remaining.current.id === current.id) remaining.current.ms -= performance.now() - startedAt
    }
  }, [current, paused, expire])

  const value = useMemo(() => ({ show }), [show])

  return (
    <ToastContext value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[70] flex justify-center"
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
              'pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-control bg-tooltip py-2.5 pr-2.5 pl-4',
              // A hairline of its own, so that it stands out on a page as dark as
              // it is.
              'border border-white/10 text-sm text-tooltip-ink shadow-popover sm:w-auto sm:min-w-80',
              'animate-[gl-appear_150ms_ease-out] motion-reduce:animate-none',
            ].join(' ')}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{current.message}</span>
            {current.action && (
              <button
                type="button"
                onClick={() => {
                  const { action } = current
                  dismiss()
                  action?.onPress()
                }}
                className="h-8 shrink-0 rounded-control bg-accent px-3 font-medium text-accent-ink transition-colors duration-75 hover:bg-accent-strong"
              >
                {current.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={expire}
              aria-label="Dismiss"
              className="flex size-8 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity duration-75 hover:opacity-100"
            >
              <XIcon className="size-4" />
            </button>
            {/* The time left, running out from right to left. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent"
              style={{
                animation: `gl-countdown ${DURATION_MS}ms linear forwards`,
                animationPlayState: paused ? 'paused' : 'running',
              }}
            />
          </div>
        )}
      </div>
    </ToastContext>
  )
}
