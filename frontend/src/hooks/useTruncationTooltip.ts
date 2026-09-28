import { useEffect } from 'react'

const TRUNCATE_SELECTOR = '.truncate, [class*="line-clamp-"]'

/**
 * Shows the full text of a truncated (ellipsised) element as a native
 * tooltip on hover, anywhere in the app — one delegated listener instead of
 * a `title` prop threaded through every place that uses Tailwind's
 * `truncate` or `line-clamp-*`. The title is only set while the element is
 * actually overflowing, so untruncated text never grows an unwanted tooltip.
 */
export function useTruncationTooltip() {
  useEffect(() => {
    function handleMouseOver(event: MouseEvent) {
      if (!(event.target instanceof Element)) return
      const el = event.target.closest<HTMLElement>(TRUNCATE_SELECTOR)
      if (!el) return

      const isTruncated = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
      const text = el.textContent?.trim() ?? ''

      if (isTruncated && text) {
        if (el.title !== text) el.title = text
      } else if (el.title) {
        el.removeAttribute('title')
      }
    }

    document.addEventListener('mouseover', handleMouseOver)
    return () => document.removeEventListener('mouseover', handleMouseOver)
  }, [])
}
