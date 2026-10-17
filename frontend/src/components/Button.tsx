import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

/**
 * Flat, small, square-ish. Nothing here has a gradient or a shadow: a button
 * reads as a button because of its weight and its hover, not its decoration.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink enabled:hover:bg-accent-strong',
  secondary: 'bg-sunken text-ink enabled:hover:bg-hover',
  ghost: 'text-ink-muted enabled:hover:bg-hover enabled:hover:text-ink',
  danger: 'text-danger enabled:hover:bg-danger-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Stretches the button, which is how it wants to look on a phone. */
  block?: boolean
}

export function Button({
  variant = 'secondary',
  block = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-control px-3',
        'text-sm font-medium transition-colors duration-75',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        // Still under the pointer when disabled, so that the not-allowed
        // cursor (index.css) shows, but without the hover.
        'disabled:opacity-45',
        VARIANTS[variant],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...props}
    />
  )
}
