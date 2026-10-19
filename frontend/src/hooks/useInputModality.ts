import { useEffect } from 'react'

/** The keys that move focus about. Anything else, a modifier on its own
 * above all, says nothing about whether the person is finding their way
 * around with the keyboard. */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/**
 * Marks `<html>` with `data-input="keyboard"` while focus is being moved
 * with the keyboard, and takes the mark off again at the first press of a
 * mouse, pen or finger. index.css only draws focus rings under that mark.
 *
 * `:focus-visible` alone is not enough: Chromium starts matching it on
 * whatever is focused at any key at all, so a button that was clicked lit
 * up its ring as soon as Super, Ctrl or Alt+Tab was pressed, and stayed lit.
 *
 * One listener pair for the whole app, like useScrollbarFade.
 */
export function useInputModality(): void {
  useEffect(() => {
    const root = document.documentElement

    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || !NAVIGATION_KEYS.has(event.key)) return
      root.dataset.input = 'keyboard'
    }

    function handlePointerDown() {
      delete root.dataset.input
    }

    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [])
}
