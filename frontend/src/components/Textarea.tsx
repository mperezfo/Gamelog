import { useId, type TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

/** A labelled multi-line input, styled to match Field. */
export function Textarea({ label, hint, className = '', ...props }: TextareaProps) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      <textarea
        id={id}
        className={[
          'w-full rounded-control bg-sunken px-2.5 py-2',
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
