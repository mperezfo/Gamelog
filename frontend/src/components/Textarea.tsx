import { useId, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
}

/**
 * A labelled multi-line input, styled to match Field.
 *
 * It grows with what is typed in it, from `rows` lines up to its maximum
 * height, past which it scrolls, rather than showing the browser's resize
 * handle: that looks different in every browser and is hard to grab on a
 * phone.
 */
export function Textarea({ label, hint, className = '', ...props }: TextareaProps) {
  const id = useId()
  const ref = useRef<HTMLTextAreaElement>(null)

  // Measured from `auto`, which falls back to `rows`, so that it shrinks
  // again as text is deleted. Before paint, so it never shows a frame at
  // the old height. A change of width rewraps the text, so that is
  // measured again too.
  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    function fit() {
      if (!textarea) return
      // Collapsing it for a moment can shorten whatever scrolls around it,
      // which would pull a form scrolled to its end back up.
      const scrolled: [Element, number][] = []
      for (let element = textarea.parentElement; element; element = element.parentElement) {
        if (element.scrollTop > 0) scrolled.push([element, element.scrollTop])
      }
      textarea.style.height = 'auto'
      const border = textarea.offsetHeight - textarea.clientHeight
      textarea.style.height = `${textarea.scrollHeight + border}px`
      for (const [element, top] of scrolled) element.scrollTop = top
    }
    fit()
    let width = textarea.offsetWidth
    const observer = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return
      width = textarea.offsetWidth
      fit()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [props.value])

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      <textarea
        ref={ref}
        id={id}
        className={[
          'max-h-64 w-full resize-none rounded-control bg-field shadow-field px-2.5 py-2',
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
