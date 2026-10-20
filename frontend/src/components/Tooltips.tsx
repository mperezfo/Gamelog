import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Emoji } from './Emoji'

/** What Tailwind ellipsises. One of these that is actually cut short shows
 * its full text, with no attribute needed. */
const TRUNCATED = '.truncate, [class*="line-clamp-"]'

/** How long the pointer rests on something before its tooltip shows: about
 * what a browser waits for a `title`, so that passing over a button on the
 * way somewhere else does not flash one. */
const SHOW_DELAY_MS = 500

/** Once a tooltip has been seen, the next one shows at once if the pointer
 * reaches it within this long, so that running along a row of icon buttons
 * reads them off without a wait at each. */
const WARM_MS = 300

/** How long a finger rests on something before its tooltip shows. About
 * what a phone waits before treating a touch as a long press. */
const LONG_PRESS_MS = 500

/** How far a finger can drift, in pixels, before a long press becomes the
 * start of a scroll instead. */
const PRESS_SLOP = 10

/** Between the tooltip and what it is about. */
const GAP = 6

/** The least a tooltip keeps from the edges of the screen. */
const MARGIN = 8

interface Tip {
  anchor: HTMLElement
  text: string
}

/** A finger held on something with a tooltip. */
interface Press {
  anchor: HTMLElement
  x: number
  y: number
  timer: ReturnType<typeof setTimeout>
  /** Whether it lasted long enough to be a long press. */
  long: boolean
}

/**
 * The application's tooltips, in place of the browser's own `title` box,
 * which ignores the theme, looks different in every browser and takes its
 * time to show.
 *
 * An element asks for one with a `data-tooltip` attribute instead of a
 * `title`. Like useTapFeedback, this is one set of delegated listeners on
 * `document` rather than a wrapper around every element that has something
 * to say, so a tooltip is a single attribute wherever it is needed. It also
 * covers truncated text: anything with `truncate` or `line-clamp-*` that is
 * cut short shows its full text, the way it used to as a `title`.
 *
 * It shows for a mouse and for keyboard focus, which a `title` never did,
 * and on a touch screen for a long press: a tap is a press, there is nothing
 * to rest on, so a finger held still on something shows its tooltip instead,
 * without pressing it, until it lifts or moves off.
 *
 * Drawn into `document.body`, for the same reason as Dialog, and positioned
 * with `fixed` above the element, or below it where there is no room above.
 */
export function Tooltips() {
  const id = useId()
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // What the pointer is over or has focus, whether or not its tooltip is
    // showing yet: a click hides a tooltip, but it should not come back
    // until the pointer has moved on to something else.
    let current: HTMLElement | null = null
    let shown: Tip | null = null
    let hiddenAt = -Infinity
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let press: Press | null = null

    function show(anchor: HTMLElement) {
      const text = textFor(anchor)
      if (!text) return
      describe(null)
      shown = { anchor, text }
      describe(shown)
      setTip(shown)
      if (!frame) frame = requestAnimationFrame(follow)
    }

    function hide() {
      clearTimeout(timer)
      if (!shown) return
      describe(null)
      shown = null
      hiddenAt = performance.now()
      setTip(null)
    }

    function schedule(anchor: HTMLElement) {
      clearTimeout(timer)
      current = anchor
      if (shown || performance.now() - hiddenAt < WARM_MS) show(anchor)
      else timer = setTimeout(() => show(anchor), SHOW_DELAY_MS)
    }

    // The tooltip as an accessible description of its element, the way a
    // `title` was, while it shows. Left out where it would only repeat what
    // the element is already called.
    function describe(tip: Tip | null) {
      if (tip) {
        const { anchor, text } = tip
        if (anchor.hasAttribute('aria-describedby')) return
        if (text === anchor.getAttribute('aria-label') || text === visibleText(anchor).trim()) return
        anchor.setAttribute('aria-describedby', id)
        anchor.dataset.tooltipDescribed = ''
      } else if (shown && 'tooltipDescribed' in shown.anchor.dataset) {
        shown.anchor.removeAttribute('aria-describedby')
        delete shown.anchor.dataset.tooltipDescribed
      }
    }

    // Every frame while a tooltip shows, so that it moves with its element
    // and goes away with it, or as soon as there is nothing left to say (a
    // collapsed sidebar that expands drops its labels, for one).
    function follow() {
      frame = 0
      if (!shown) return
      const { anchor } = shown
      const text = anchor.isConnected ? textFor(anchor) : ''
      if (!text) {
        current = null
        hide()
        return
      }
      if (text !== shown.text) {
        shown = { anchor, text }
        setTip(shown)
      }
      if (tipRef.current) place(anchor, tipRef.current)
      frame = requestAnimationFrame(follow)
    }

    // Hit-tested rather than taken from the event's target: a browser sends
    // no pointer events to a disabled button, only to whatever holds it, and
    // a disabled button is often the one with the most to explain (Identify
    // without IGDB credentials, say).
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      const anchor = anchorFor(document.elementFromPoint(event.clientX, event.clientY))
      if (anchor === current) return
      if (anchor) {
        schedule(anchor)
      } else {
        current = null
        hide()
      }
    }

    function handlePointerOut(event: PointerEvent) {
      // Off the page altogether.
      if (event.relatedTarget) return
      current = null
      hide()
    }

    // Pressing something hides its tooltip without warming up the next one:
    // the pointer is busy, not reading. Not while a finger is holding
    // something, though: a browser simulating touch (Firefox's responsive
    // mode) sends the mouse's own pointer events along with the touch.
    function handlePointerDown() {
      if (press) return
      hide()
      hiddenAt = -Infinity
    }

    // A long press is read from touch events rather than pointer events:
    // every touch screen sends them, and so does a desktop browser
    // simulating one, whose pointer events can still say "mouse".
    function handleTouchStart(event: TouchEvent) {
      endPress()
      hide()
      hiddenAt = -Infinity
      if (event.touches.length !== 1) return
      const { clientX, clientY } = event.touches[0]
      const anchor = anchorFor(document.elementFromPoint(clientX, clientY))
      if (!anchor) return
      const started: Press = {
        anchor,
        x: clientX,
        y: clientY,
        long: false,
        timer: setTimeout(() => {
          started.long = true
          current = anchor
          show(anchor)
        }, LONG_PRESS_MS),
      }
      press = started
    }

    // A finger that drifts before the press is long enough is scrolling;
    // one that moves off what it is holding after that is done reading.
    function handleTouchMove(event: TouchEvent) {
      if (!press || event.touches.length !== 1) return
      const { clientX, clientY } = event.touches[0]
      if (!press.long) {
        if (Math.hypot(clientX - press.x, clientY - press.y) > PRESS_SLOP) endPress()
        return
      }
      if (!press.anchor.contains(document.elementFromPoint(clientX, clientY))) {
        current = null
        hide()
      }
    }

    function handleTouchEnd(event: TouchEvent) {
      if (!press) return
      // A long press only ever showed a tooltip: the click the browser sends
      // as the finger lifts would press the button as well. Cancelling the
      // touch's end is what keeps it from sending one; swallowing it is for
      // a browser that sends it anyway.
      if (press.long && event.type === 'touchend') {
        if (event.cancelable) event.preventDefault()
        swallowClick()
      }
      endPress()
      current = null
      hide()
    }

    function endPress() {
      if (!press) return
      clearTimeout(press.timer)
      press = null
    }

    let swallowTimer: ReturnType<typeof setTimeout> | undefined
    function swallow(event: MouseEvent) {
      event.preventDefault()
      event.stopPropagation()
      stopSwallowing()
    }
    function swallowClick() {
      window.addEventListener('click', swallow, true)
      // In case no click comes, so that the next real one is not lost.
      clearTimeout(swallowTimer)
      swallowTimer = setTimeout(stopSwallowing, 600)
    }
    function stopSwallowing() {
      window.removeEventListener('click', swallow, true)
      clearTimeout(swallowTimer)
    }

    // Holding a link or a picture brings up the browser's own menu for it,
    // which would cover the tooltip.
    function handleContextMenu(event: MouseEvent) {
      if (press) event.preventDefault()
    }

    function handleFocusIn(event: FocusEvent) {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(':focus-visible')) return
      const anchor = anchorFor(event.target)
      if (anchor) schedule(anchor)
    }

    function handleFocusOut(event: FocusEvent) {
      if (!current || !(event.target instanceof Node) || !current.contains(event.target)) return
      current = null
      hide()
    }

    function reset() {
      endPress()
      current = null
      hide()
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerout', handlePointerOut)
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true })
    // Not passive, to be able to cancel the end of a long press.
    document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false })
    document.addEventListener('touchcancel', handleTouchEnd, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    document.addEventListener('scroll', reset, { capture: true, passive: true })
    window.addEventListener('blur', reset)
    window.addEventListener('resize', reset)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerout', handlePointerOut)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('touchstart', handleTouchStart, { capture: true })
      document.removeEventListener('touchmove', handleTouchMove, { capture: true })
      document.removeEventListener('touchend', handleTouchEnd, { capture: true })
      document.removeEventListener('touchcancel', handleTouchEnd, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('scroll', reset, { capture: true })
      window.removeEventListener('blur', reset)
      window.removeEventListener('resize', reset)
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      endPress()
      stopSwallowing()
      describe(null)
    }
  }, [id])

  // Before paint, so that a tooltip never shows a frame in the corner of the
  // screen before it is moved next to its element.
  useLayoutEffect(() => {
    if (tip && tipRef.current) place(tip.anchor, tipRef.current)
  }, [tip])

  if (!tip) return null

  return createPortal(
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className={[
        'pointer-events-none fixed top-0 left-0 z-[80] w-max max-w-[min(18rem,calc(100vw-16px))]',
        'rounded-control bg-tooltip px-2 py-1 text-xs leading-snug font-medium break-words text-tooltip-ink',
        'shadow-tooltip',
        // Only a tooltip that appears from nothing fades in: moving to the
        // next element keeps the same one, which just follows.
        'animate-[gl-appear_100ms_ease-out] motion-reduce:animate-none',
      ].join(' ')}
    >
      <Emoji value={tip.text} />
    </div>,
    document.body,
  )
}

/** The nearest element, from `target` up, that has something to show. */
function anchorFor(target: EventTarget | null): HTMLElement | null {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node instanceof HTMLElement && textFor(node)) return node
  }
  return null
}

function textFor(element: HTMLElement): string {
  if (element.dataset.tooltip) return element.dataset.tooltip
  if (!element.matches(TRUNCATED)) return ''
  const truncated = element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
  return truncated ? visibleText(element).trim() : ''
}

/** The text of an element as it reads, emoji included: one drawn as an
 * image (see Emoji) is only in its `alt`, which `textContent` leaves out. */
function visibleText(node: Node): string {
  if (node instanceof HTMLImageElement) return node.alt
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  return Array.from(node.childNodes, visibleText).join('')
}

/** Centred above `anchor`, or below it where there is no room above, and
 * kept clear of the sides of the screen. */
function place(anchor: HTMLElement, tooltip: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const width = tooltip.offsetWidth
  const height = tooltip.offsetHeight
  const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN)
  const above = rect.top - GAP - height
  const top = above >= MARGIN ? above : rect.bottom + GAP
  tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
}
