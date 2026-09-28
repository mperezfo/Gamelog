import { useId, type InputHTMLAttributes } from 'react'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** A line under the input, for a rule the user should know before typing. */
  hint?: string
}

/** A labelled text input. */
export function Field({ label, hint, className = '', ...props }: FieldProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      <input
        id={id}
        className={[
          'h-9 w-full rounded-control bg-sunken px-2.5',
          'text-sm text-ink placeholder:text-ink-faint',
          'outline-none transition-colors duration-75',
          'focus-visible:ring-2 focus-visible:ring-accent/40',
          'disabled:opacity-50',
          className,
        ].join(' ')}
        {...props}
      />
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}
