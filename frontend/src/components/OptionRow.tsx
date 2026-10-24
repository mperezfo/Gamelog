import type { ComponentProps, ReactNode } from 'react'

import { CheckIcon } from './icons'
import { Emoji } from './Emoji'

interface OptionRowProps extends Omit<ComponentProps<'button'>, 'children'> {
  label: string
  /** Something after the label that is never cut, such as NewMark: the
   * label truncates first. */
  marker?: ReactNode
  /** The current choice: shown with a check, and not dimmed like the rest. */
  active: boolean
}

/** One row of a pick-one-or-several list: the label, and a check when it is
 * chosen. Shared by the filter popovers and the Dropdown, so every list in
 * the app reads and feels the same. */
export function OptionRow({ label, marker, active, className = '', ...props }: OptionRowProps) {
  return (
    <button
      type="button"
      className={[
        'flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm transition-colors duration-75',
        'focus-visible:bg-hover focus-visible:outline-none',
        active ? 'text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
        className,
      ].join(' ')}
      {...props}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        <span className="truncate">
          <Emoji value={label} />
        </span>
        {marker}
      </span>
      {active && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
    </button>
  )
}
