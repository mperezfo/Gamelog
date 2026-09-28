import { useId, type ReactNode, type SelectHTMLAttributes } from 'react'

import { ChevronDownIcon } from './icons'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: string
  children: ReactNode
}

/**
 * A labelled dropdown, styled to match Field.
 *
 * The native arrow is turned off (`appearance-none`) and redrawn as our own
 * icon rather than left to the browser: a browser's built-in one sits at a
 * fixed distance from the edge that padding doesn't reliably move — right on
 * Chromium, not at all on Firefox — so the gap around it never matched the
 * padding on the left. Drawing it ourselves makes the two sides symmetric
 * everywhere.
 *
 * Sizing and layout classes (`className`) land on the wrapper rather than on
 * the `<select>` itself, which just fills it — that is what lets a caller's
 * `h-8 w-auto` (see GamesPage's filter bar) still size the whole control the
 * way it did before the wrapper existed.
 */
export function Select({ label, hint, className = '', children, ...props }: SelectProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      <div className={['relative h-9 w-full', className].join(' ')}>
        <select
          id={id}
          className={[
            'h-full w-full appearance-none rounded-control bg-sunken pr-8 pl-2.5',
            'text-sm text-ink',
            'outline-none transition-colors duration-75',
            'focus-visible:ring-2 focus-visible:ring-accent/40',
            'disabled:opacity-50',
          ].join(' ')}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
      </div>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}
