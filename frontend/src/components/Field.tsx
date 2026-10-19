import { useId, useRef, type InputHTMLAttributes, type RefObject } from 'react'

import { ChevronDownIcon, ChevronUpIcon } from './icons'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** A line under the input, for a rule the user should know before typing. */
  hint?: string
}

/** A labelled text input. */
export function Field({ label, hint, className = '', ...props }: FieldProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const number = props.type === 'number'

  const input = (
    <input
      id={id}
      ref={inputRef}
      className={[
        'h-9 w-full rounded-control bg-sunken px-2.5',
        'text-sm text-ink placeholder:text-ink-faint',
        'outline-none transition-colors duration-75',
        'focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50',
        number ? NUMBER_CLASSES : '',
        className,
      ].join(' ')}
      {...props}
    />
  )

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      {/* Only a number input gets a positioned wrapper, for Stepper. On any
          other input it would paint over whatever a caller lays on top of
          it, such as the icon in the Games search box. */}
      {number ? (
        <div className="relative">
          {input}
          <Stepper input={inputRef} />
        </div>
      ) : (
        input
      )}
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

/*
 * The browser's own spin buttons are a boxed widget that ignores the theme
 * (and differs between Chromium and Firefox), so they are hidden and Stepper
 * draws a pair of chevrons in their place. Room for those is only made where
 * Stepper shows.
 */
const NUMBER_CLASSES = [
  '[appearance:textfield]',
  '[&::-webkit-inner-spin-button]:appearance-none',
  '[&::-webkit-outer-spin-button]:appearance-none',
  'pointer-fine:pr-7',
].join(' ')

/**
 * Up and down chevrons for a number input, in the same faint ink as the
 * Dropdown arrow.
 *
 * Only for a mouse: a phone brings up a numeric keyboard and never showed
 * spin buttons, and two halves of a 36px control would be too small to tap.
 * They are left out of the tab order since the arrow keys already step the
 * input, and pressing one does not take focus away from it.
 */
function Stepper({ input }: { input: RefObject<HTMLInputElement | null> }) {
  function step(direction: 1 | -1) {
    const node = input.current
    if (!node || node.disabled) return
    if (direction === 1) node.stepUp()
    else node.stepDown()
    // stepUp() changes the value without an input event, which is what
    // React's onChange listens for.
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Each button is half the height of the input, so either is easy to hit,
  // but the chevrons are drawn towards the middle so they read as one pair.
  const button =
    'flex flex-1 justify-center text-ink-faint transition-colors duration-75 hover:text-ink disabled:opacity-50 disabled:hover:text-ink-faint'

  return (
    <div className="absolute inset-y-0 right-0 hidden w-7 flex-col pointer-fine:flex">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Increase"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(1)}
        className={`${button} items-end`}
      >
        <ChevronUpIcon className="size-3 translate-y-px" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Decrease"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => step(-1)}
        className={`${button} items-start`}
      >
        <ChevronDownIcon className="size-3 -translate-y-px" />
      </button>
    </div>
  )
}
