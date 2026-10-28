import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

/** How far a step slides as it comes in or goes out. */
const OFFSET = '1.5rem'

type Direction = 'forward' | 'back'

interface MenuStepsProps {
  /** Which step is showing. A change slides the new one in. */
  step: string
  /** How deep `step` is: a deeper step comes in from the right, a shallower
   * one from the left. */
  depth: number
  /** Draws a step: the one showing, and the one going out while it slides
   * away, which keeps its state for as long as it is there. */
  renderStep: (step: string) => ReactNode
}

/**
 * A menu in steps, such as "+ Filter" on Games: a list of fields, then the
 * values of the one picked. Moving forward, the new step slides in from the
 * right and the old one out to the left; going back, the other way round.
 * The menu takes the size of the new step as it does, rather than jumping
 * to it.
 *
 * The size is measured, since Firefox has no `interpolate-size` to animate
 * to `auto`: the old size is pinned, then the new one, and the box goes back
 * to `auto` once there. With reduced motion a step simply replaces the
 * other.
 *
 * Focus is the steps' own business (each focuses itself as it appears, see
 * FilterBar); a step that comes back while still going out, which does not
 * appear again, gets it here.
 */
export function MenuSteps({ step, depth, renderStep }: MenuStepsProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Null direction: nothing to animate (the first step, or reduced motion).
  const [current, setCurrent] = useState<{ step: string; depth: number; direction: Direction | null }>({
    step,
    depth,
    direction: null,
  })
  const [leaving, setLeaving] = useState<string | null>(null)

  if (step !== current.step) {
    setCurrent({ step, depth, direction: reduceMotion ? null : depth < current.depth ? 'back' : 'forward' })
    setLeaving(reduceMotion ? null : current.step)
  }

  const boxRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  // The size of the box while it is not on its way to another, which is
  // where the next change starts from.
  const settled = useRef<DOMRect | null>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => {
      if (!box.style.height) settled.current = box.getBoundingClientRect()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || current.direction === null) return
    const element = currentRef.current
    if (element && !element.contains(document.activeElement)) element.focus({ preventScroll: true })

    // Halfway to another size, from wherever it has got to.
    const from = box.style.height ? box.getBoundingClientRect() : settled.current
    box.style.width = ''
    box.style.height = ''
    const to = box.getBoundingClientRect()
    if (!from || (from.width === to.width && from.height === to.height)) return
    box.style.width = `${from.width}px`
    box.style.height = `${from.height}px`
    // Read back, so that the old size is where the transition starts.
    void box.offsetHeight
    box.style.width = `${to.width}px`
    box.style.height = `${to.height}px`
  }, [current.step, current.direction])

  return (
    <div
      ref={boxRef}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return
        event.currentTarget.style.width = ''
        event.currentTarget.style.height = ''
      }}
      style={{ '--gl-step-offset': current.direction === 'back' ? `-${OFFSET}` : OFFSET } as CSSProperties}
      className="relative overflow-hidden transition-[width,height] duration-150 ease-out"
    >
      {leaving !== null && (
        <div
          key={leaving}
          inert
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setLeaving(null)
          }}
          className="absolute inset-x-0 top-0 animate-[gl-step-out_150ms_ease-out_forwards]"
        >
          {renderStep(leaving)}
        </div>
      )}
      <div
        key={current.step}
        ref={currentRef}
        tabIndex={-1}
        className={['outline-none', current.direction ? 'animate-[gl-step-in_150ms_ease-out]' : ''].join(' ')}
      >
        {renderStep(current.step)}
      </div>
    </div>
  )
}

/** A row of a menu in steps that opens another step: the chevron on its
 * right says so, the counterpart of MenuStepBack's arrow. */
export function MenuStepRow({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={[
        'flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm text-ink-muted',
        'transition-colors duration-75 hover:bg-hover hover:text-ink',
        className,
      ].join(' ')}
    >
      <span className="truncate">{children}</span>
      <ChevronRightIcon className="size-4 shrink-0 text-ink-faint" />
    </button>
  )
}

/** The head of a step deeper than the first: what it is, and the way back. */
export function MenuStepBack({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1 border-b border-line py-2.5 pr-2.5 pl-2 text-left text-[13px] font-medium text-ink-muted transition-colors duration-75 hover:text-ink"
    >
      <ChevronLeftIcon className="size-4 shrink-0" />
      {children}
    </button>
  )
}
