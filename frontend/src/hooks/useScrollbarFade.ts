import { useEffect } from 'react'

/** How long a scrollbar stays revealed after the last scroll event, once the
 * pointer isn't what's keeping it visible (see index.css's `:hover` rule,
 * which covers that case on its own). */
const FADE_DELAY_MS = 900

/**
 * Marks whatever was just scrolled with `.gl-scrolling`, briefly, so its
 * scrollbar can fade in for that even without the pointer over it — a
 * keyboard scroll (Page Down) or a programmatic one has no hover to key off.
 *
 * One listener for the whole app rather than one per scroll container: a
 * `scroll` event doesn't bubble, but it does reach a capturing listener on
 * `document` regardless of which element fired it, so this is the only place
 * this needs to be wired up.
 */
export function useScrollbarFade(): void {
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

    function handleScroll(event: Event) {
      const target = event.target
      if (!(target instanceof Element)) return

      target.classList.add('gl-scrolling')
      const existing = timers.get(target)
      if (existing) clearTimeout(existing)
      timers.set(
        target,
        setTimeout(() => target.classList.remove('gl-scrolling'), FADE_DELAY_MS),
      )
    }

    document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', handleScroll, { capture: true })
  }, [])
}
