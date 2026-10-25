import { useEffect, useRef } from 'react'

import { isTypingTarget } from '../lib/keyboard'

/**
 * A single-letter keyboard shortcut, pressed anywhere on the page: `F` to
 * search, `N` to create something.
 *
 * It stays out of the way of everything else a key can mean: typing in a
 * field, a combination with a modifier, and anything already open on top of
 * the page (a popover, a dialog), whose keys are its own. `enabled` covers
 * what only the page knows about, such as its own panel being open, or being
 * offline where the action would be disabled anyway.
 */
export function useShortcut(key: string, onPress: () => void, enabled = true) {
  // The latest callback, without the listener being added again each render.
  const pressRef = useRef(onPress)
  useEffect(() => {
    pressRef.current = onPress
  })

  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== key || event.repeat || event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(document.activeElement)) return
      if (document.querySelector('[data-popover], [role="dialog"]')) return
      event.preventDefault()
      pressRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [key, enabled])
}
