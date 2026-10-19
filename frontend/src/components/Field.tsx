import { useId, useRef, useState, type InputHTMLAttributes, type RefObject } from 'react'

import { validityMessage } from '../lib/validity'
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, EyeOffIcon } from './icons'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** A line under the input, for a rule the user should know before typing. */
  hint?: string
}

/**
 * A labelled text input.
 *
 * What is wrong with it, once a submit has been refused, shows under it in
 * place of the hint (see useInlineValidation for why the browser's own
 * bubble never does), and follows the typing from then on until it is put
 * right.
 */
export function Field({ label, hint, className = '', onChange, onInvalid, ...props }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(false)
  const number = props.type === 'number'
  const password = props.type === 'password'
  const message = error || hint

  const input = (
    <input
      id={id}
      ref={inputRef}
      aria-invalid={error ? true : undefined}
      aria-describedby={message ? messageId : undefined}
      onChange={(event) => {
        if (error) setError(event.currentTarget.validity.valid ? '' : validityMessage(event.currentTarget))
        onChange?.(event)
      }}
      onInvalid={(event) => {
        setError(validityMessage(event.currentTarget))
        onInvalid?.(event)
      }}
      className={[
        'h-9 w-full rounded-control bg-sunken px-2.5',
        'text-sm text-ink placeholder:text-ink-faint',
        'outline-none transition-colors duration-75',
        error
          ? 'ring-1 ring-danger focus-visible:ring-2 focus-visible:ring-danger/40'
          : 'focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50',
        number ? NUMBER_CLASSES : '',
        password ? 'pr-9' : '',
        className,
      ].join(' ')}
      {...props}
      type={password && revealed ? 'text' : props.type}
    />
  )

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      {/* Only a number or password input gets a positioned wrapper, for the
          buttons laid over it. On any other input it would paint over
          whatever a caller lays on top of it, such as the icon in the Games
          search box. */}
      {number || password ? (
        <div className="relative">
          {input}
          {number && <Stepper input={inputRef} />}
          {password && (
            <RevealButton revealed={revealed} disabled={props.disabled} onToggle={() => setRevealed((r) => !r)} />
          )}
        </div>
      ) : (
        input
      )}
      {message && (
        <p id={messageId} className={`text-xs ${error ? 'text-danger' : 'text-ink-faint'}`}>
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * Shows the password as plain text and back, the same in every browser:
 * Edge would otherwise draw an eye of its own (hidden in index.css) and the
 * rest none at all. Pressing it leaves focus, and the caret, in the input.
 */
function RevealButton({ revealed, disabled, onToggle }: { revealed: boolean; disabled?: boolean; onToggle: () => void }) {
  const label = revealed ? 'Hide password' : 'Show password'
  const Glyph = revealed ? EyeOffIcon : EyeIcon

  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      aria-pressed={revealed}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-control text-ink-faint transition-colors duration-75 enabled:hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
    >
      <Glyph className="size-4" />
    </button>
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
