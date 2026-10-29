import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'

interface MenuStepsProps {
  /** Which step is showing. A change fades the new one in. */
  step: string
  /** Draws a step: the one showing, and the one going out while it fades
   * away, which keeps its state for as long as it is there. */
  renderStep: (step: string) => ReactNode
}

/**
 * A menu in steps, such as "+ Filter" on Games: a list of fields, then the
 * values of the one picked. The old step fades out, then the new one fades
 * in, never the two at once, which would read as two lists on top of each
 * other; meanwhile the menu takes the height of the new step rather than
 * jumping to it.
 *
 * The height is measured, since Firefox has no `interpolate-size` to
 * animate to `auto`: the box always has the height of the step showing, in
 * pixels, kept up to date as that step grows or shrinks (a search narrowing
 * a list, say), so that a new step is a change from one height to another
 * like any other. With reduced motion a step simply replaces the other.
 *
 * Focus is the steps' own business (each focuses itself as it appears, see
 * FilterBar); a step that comes back while still going out, which does not
 * appear again, gets it here.
 */
export function MenuSteps({ step, renderStep }: MenuStepsProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  // Not animated: the first step, or any step with reduced motion.
  const [current, setCurrent] = useState({ step, animated: false })
  const [leaving, setLeaving] = useState<string | null>(null)

  if (step !== current.step) {
    setCurrent({ step, animated: !reduceMotion })
    setLeaving(reduceMotion ? null : current.step)
  }

  const boxRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  // The box takes the height of the step showing, and keeps it: measured as
  // the step appears, before it is painted, and again whenever it changes
  // size. The step itself is never held to the box, which only clips, so
  // its own height is always the one to go to. The transition does the rest,
  // from wherever the box has got to.
  useLayoutEffect(() => {
    const box = boxRef.current
    const element = currentRef.current
    if (!box || !element) return
    if (current.animated && !element.contains(document.activeElement)) element.focus({ preventScroll: true })

    const fit = () => {
      box.style.height = `${element.getBoundingClientRect().height}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [current.step, current.animated])

  return (
    <div
      ref={boxRef}
      className="relative overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none"
    >
      {leaving !== null && (
        <div
          key={leaving}
          inert
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setLeaving(null)
          }}
          className="absolute inset-x-0 top-0 animate-[gl-step-out_50ms_ease-in_forwards]"
        >
          {renderStep(leaving)}
        </div>
      )}
      <div
        key={current.step}
        ref={currentRef}
        tabIndex={-1}
        className={['outline-none', current.animated ? 'animate-[gl-step-in_90ms_ease-out_50ms_both]' : ''].join(' ')}
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
