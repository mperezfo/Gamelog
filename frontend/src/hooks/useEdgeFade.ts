import { useCallback } from 'react'

/** Fades a scroll container's edges out instead of cutting the content at
 * the boundary flush — only on whichever side there is currently more to
 * scroll to, so a fully-scrolled edge (nothing hidden past it) stays crisp.
 * `axis` picks which pair of edges to track: `'y'` for top/bottom, `'x'` for
 * left/right.
 *
 * The mask is written straight onto the element's `style` from the scroll
 * handler, rather than through `useState` + a render: going through React
 * for something driven directly by the scroll event added a visible frame
 * or two of lag between the fade and the scroll position it is meant to
 * track.
 *
 * Returns a callback ref: React calls it with the element when it mounts, and
 * calls what it returns when it goes. */
export function useEdgeFade(axis: 'x' | 'y') {
  return useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const node = element
    const fadePx = 16

    function update() {
      const atStart = axis === 'y' ? node.scrollTop <= 0 : node.scrollLeft <= 0
      const atEnd =
        axis === 'y'
          ? node.scrollTop + node.clientHeight >= node.scrollHeight - 1
          : node.scrollLeft + node.clientWidth >= node.scrollWidth - 1

      const maskImage =
        atStart && atEnd
          ? ''
          : `linear-gradient(${axis === 'y' ? 'to bottom' : 'to right'}, ${[
              atStart ? 'black' : `transparent, black ${fadePx}px`,
              atEnd ? 'black' : `black calc(100% - ${fadePx}px), transparent`,
            ].join(', ')})`

      node.style.maskImage = maskImage
      node.style.webkitMaskImage = maskImage
    }

    update()
    node.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => {
      node.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [axis])
}
