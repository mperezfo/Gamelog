import type { ComponentProps } from 'react'

import { CheckIcon } from './icons'

interface OptionRowProps extends Omit<ComponentProps<'button'>, 'children'> {
  label: string
  /** The current choice: shown with a check, and not dimmed like the rest. */
  active: boolean
}

/** One row of a pick-one-or-several list: the label, and a check when it is
 * chosen. Shared by the filter popovers and the Dropdown, so every list in
 * the app reads and feels the same. */
export function OptionRow({ label, active, className = '', ...props }: OptionRowProps) {
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
      <span className="truncate">{label}</span>
      {active && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
    </button>
  )
}
