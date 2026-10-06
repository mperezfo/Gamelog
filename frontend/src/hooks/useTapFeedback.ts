import { useEffect } from 'react'

/** What counts as tappable. Anything else that is clickable (a table row, a
 * `div` with an `onClick`) opts in with a `data-tap-target` attribute; a
 * button that should stay silent opts out with `data-no-tap`. */
const TARGETS = 'button, a[href], summary, [role="button"], [role="option"], [role="menuitem"], [data-tap-target]'
const INERT = ':disabled, [aria-disabled="true"], [data-no-tap]'

/** How long a touch waits before its ripple shows, unless it ends first.
 * Most touches that start on a list or a gallery are the beginning of a
 * scroll, and those end in a `pointercancel` well inside this window, so a
 * scroll does not flash a ripple on everything it started over. */
const SCROLL_GRACE_MS = 70
const GROW_MS = 380
const FADE_MS = 300

interface Press {
  element: HTMLElement
  started: boolean
  startedAt: number
  grow: number
  startTimer: ReturnType<typeof setTimeout> | undefined
  endTimer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Touch feedback for everything tappable, in one place.
 *
 * Tailwind gates every `hover:` utility behind `@media (hover: hover)`, so on
 * a phone the hover styles that make a button feel alive on a desktop never
 * apply, and a tap changes nothing until the next screen. This puts a ripple
 * in their place: it marks the pressed element with `data-tap`, and
 * index.css draws and animates it.
 *
 * Like useScrollbarFade, this is one delegated listener on `document` rather
 * than a prop on every button. A mouse is ignored on purpose: it has the
 * hover styles already, and a ripple on every desktop click would be noise.
 */
export function useTapFeedback(): void {
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let press: Press | null = null

    function start(current: Press, x: number, y: number) {
      const { element } = current
      const rect = element.getBoundingClientRect()
      const originX = x - rect.left
      const originY = y - rect.top

      element.style.setProperty('--tap-x', `${originX}px`)
      element.style.setProperty('--tap-y', `${originY}px`)
      // The radius that just reaches the farthest corner, so the ripple
      // covers the whole element wherever it was touched.
      element.style.setProperty('--tap-max', `${Math.hypot(Math.max(originX, rect.width - originX), Math.max(originY, rect.height - originY))}px`)
      element.style.setProperty('--tap-grow', `${current.grow}ms`)
      element.style.setProperty('--tap-fade', `${FADE_MS}ms`)
      element.dataset.tap = 'down'
      current.started = true
      current.startedAt = performance.now()
    }

    function clear(element: HTMLElement) {
      delete element.dataset.tap
      for (const name of ['--tap-x', '--tap-y', '--tap-max', '--tap-grow', '--tap-fade']) {
        element.style.removeProperty(name)
      }
    }

    function abandon(current: Press) {
      clearTimeout(current.startTimer)
      clearTimeout(current.endTimer)
      clear(current.element)
    }

    /** Lets the ripple finish growing, then fades it out and tidies up. A
     * quick tap would otherwise jump straight to the faded-out state. */
    function release(current: Press) {
      const remaining = Math.max(0, current.grow - (performance.now() - current.startedAt))
      current.endTimer = setTimeout(() => {
        current.element.dataset.tap = 'up'
        current.endTimer = setTimeout(() => clear(current.element), FADE_MS)
      }, remaining)
    }

    function handleDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      if (!(event.target instanceof Element)) return

      const element = event.target.closest<HTMLElement>(TARGETS)
      if (!element || element.matches(INERT)) return

      if (press) abandon(press)

      const current: Press = {
        element,
        started: false,
        startedAt: 0,
        grow: reducedMotion.matches ? 0 : GROW_MS,
        startTimer: undefined,
        endTimer: undefined,
      }
      press = current
      current.startTimer = setTimeout(() => start(current, event.clientX, event.clientY), SCROLL_GRACE_MS)
    }

    function handleUp(event: PointerEvent) {
      const current = press
      if (!current || !event.isPrimary) return
      press = null

      clearTimeout(current.startTimer)
      if (!current.started) start(current, event.clientX, event.clientY)
      release(current)
    }

    function handleCancel(event: PointerEvent) {
      const current = press
      if (!current || !event.isPrimary) return
      press = null

      // The browser took the gesture over, which in practice means a scroll.
      // Before the ripple showed, that is a touch that never was a tap.
      if (!current.started) {
        abandon(current)
        return
      }
      release(current)
    }

    document.addEventListener('pointerdown', handleDown, { passive: true })
    document.addEventListener('pointerup', handleUp, { passive: true })
    document.addEventListener('pointercancel', handleCancel, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', handleDown)
      document.removeEventListener('pointerup', handleUp)
      document.removeEventListener('pointercancel', handleCancel)
      if (press) abandon(press)
    }
  }, [])
}
