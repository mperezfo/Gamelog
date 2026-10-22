import { useEffect, useRef } from 'react'

/** Sent on the window when the sidebar's link to the page already open is
 * clicked again. */
const SCROLL_TO_TOP = 'gamelog:scroll-to-top'

/** Asks whatever scrolls the current page to go back to its top, the way a
 * second tap on a tab does in most apps. */
export function requestScrollToTop() {
  window.dispatchEvent(new Event(SCROLL_TO_TOP))
}

/**
 * Scrolls `scroller` back to its top whenever requestScrollToTop asks: the
 * shell's `main` for most pages, or a page's own region, such as the Games
 * list under its filters. Smoothly, unless the system asks for less motion.
 *
 * `scroller` is read when it is needed.
 */
export function useScrollToTop(scroller: () => HTMLElement | null | undefined) {
  // Read through a ref, so that the listener is added once.
  const scrollerRef = useRef(scroller)
  useEffect(() => {
    scrollerRef.current = scroller
  })

  useEffect(() => {
    function handleScrollToTop() {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      scrollerRef.current()?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
    }
    window.addEventListener(SCROLL_TO_TOP, handleScrollToTop)
    return () => window.removeEventListener(SCROLL_TO_TOP, handleScrollToTop)
  }, [])
}
