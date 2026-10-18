import type { ReactNode } from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}

/**
 * An on/off setting, drawn in the app's own flat, square-ish style instead of
 * the browser's checkbox. The label is part of the button, so the whole line
 * toggles it, which is easier to hit on a phone.
 */
export function Switch({ checked, onChange, children }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 rounded-control text-xs text-ink-muted transition-colors duration-75 select-none hover:text-ink focus-visible:outline-none disabled:opacity-45"
    >
      <span
        aria-hidden="true"
        className={[
          'flex h-4 w-7 shrink-0 items-center rounded-control p-0.5 transition-colors duration-75',
          'group-focus-visible:ring-2 group-focus-visible:ring-accent/40',
          checked ? 'bg-accent' : 'bg-sunken ring-1 ring-line-strong ring-inset',
        ].join(' ')}
      >
        <span
          className={[
            'size-3 rounded-[2px] transition-transform duration-100',
            checked ? 'translate-x-3 bg-accent-ink' : 'bg-ink-faint',
          ].join(' ')}
        />
      </span>
      {children}
    </button>
  )
}
