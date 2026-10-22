import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/** Where a page was scrolled to when the tab unloaded, by address. Session
 * storage, so that it lasts as long as the tab and no longer. */
const KEY_PREFIX = 'gamelog.scroll:'

/** The page's address without the game panel (`?modal=`), which opens over
 * it and has no say in where the list underneath is scrolled. */
function storageKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete('modal')
  const query = params.toString()
  return `${KEY_PREFIX}${pathname}${query ? `?${query}` : ''}`
}

/**
 * Puts a long list back where it was after a reload.
 *
 * The browser's own scroll restoration cannot: it runs before the list has
 * loaded, while the page is still too short to scroll, and it only ever
 * knows about the window, never a container that scrolls inside the page.
 * So the position is written down as the page unloads and put back once
 * `ready` says the list is there, then forgotten.
 *
 * Only an unload writes it down, never a move to another page inside the
 * app, so a section reached from the sidebar still starts at its top.
 *
 * `scroller` is the element that scrolls, read when it is needed.
 */
export function useReloadScroll(scroller: () => HTMLElement | null | undefined, ready: boolean) {
  const { pathname, search } = useLocation()
  const key = storageKey(pathname, search)
  // Read through refs, so that the unload listener is added once.
  const keyRef = useRef(key)
  const scrollerRef = useRef(scroller)
  useEffect(() => {
    keyRef.current = key
    scrollerRef.current = scroller
  })

  useEffect(() => {
    function handlePageHide() {
      const top = scrollerRef.current()?.scrollTop ?? 0
      try {
        if (top > 0) sessionStorage.setItem(keyRef.current, String(Math.round(top)))
        else sessionStorage.removeItem(keyRef.current)
      } catch {
        // Storage can be blocked; a reload then starts at the top, as before.
      }
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [])

  // A passive effect rather than a layout one, so that it runs after the
  // shell has set a newly entered page to its top.
  const restored = useRef(false)
  useEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    let top: number | null = null
    try {
      const stored = sessionStorage.getItem(key)
      sessionStorage.removeItem(key)
      top = stored == null ? null : Number(stored)
    } catch {
      return
    }
    const element = scrollerRef.current()
    if (element && top != null && Number.isFinite(top)) element.scrollTop = top
  }, [ready, key])
}
