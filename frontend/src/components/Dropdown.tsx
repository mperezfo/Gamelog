import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react'

import { ChevronDownIcon } from './icons'
import { OptionRow } from './OptionRow'

export interface DropdownOption<T extends string> {
  value: T
  label: string
}

interface DropdownProps<T extends string> {
  id?: string
  value: T
  onChange: (value: T) => void
  options: DropdownOption<T>[]
  /** Shown, dimmed, while `value` matches none of the options. */
  placeholder?: string
  'aria-label'?: string
  disabled?: boolean
  /** Sizes and colours the trigger button; its layout is fixed. */
  className?: string
  /** Which edge of the trigger the list lines up with, for a trigger near
   * the right edge of a screen whose list is wider than it is. */
  align?: 'left' | 'right'
  /** The small arrow on the trigger. Off for a trigger that sits inside a
   * larger control, which already reads as one. */
  chevron?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * Our own replacement for a native `<select>`, in the style of the filter
 * popovers on the Games page.
 *
 * A native select hands the picking over to the operating system, which on a
 * phone is a separate sheet this app cannot style, cannot give tap feedback
 * to, and which leaves the select itself ringed as if it were keyboard
 * focused once it closes. This one is ordinary markup instead: a trigger
 * button and a list under it.
 *
 * The list is `absolute` under the trigger rather than `fixed` like
 * FilterPopover: it is used inside the game modal, which is a transformed
 * element, and a transformed ancestor makes `fixed` position against itself
 * instead of the viewport.
 *
 * Keyboard: Arrow keys open it and move through it, Enter or Space picks,
 * Escape closes it and returns to the trigger. Focus only goes back to the
 * trigger after a keyboard pick: after a tap that would paint the focus ring
 * this component exists to avoid.
 */
export function Dropdown<T extends string>({
  id,
  value,
  onChange,
  options,
  placeholder = '',
  'aria-label': ariaLabel,
  disabled,
  className = '',
  align = 'left',
  chevron = true,
  ref,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  // Opens with the current choice (or the first row) focused, so the arrow
  // keys continue from there. Focusing is harmless after a tap: a script
  // focusing a button right after a pointer press does not count as keyboard
  // focus, so no ring appears.
  useEffect(() => {
    if (!open) return
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? rows?.[0]
    row?.focus({ preventScroll: false })
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    const index = rows.indexOf(document.activeElement as HTMLElement)

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        rows[Math.min(rows.length - 1, index + 1)]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        rows[Math.max(0, index - 1)]?.focus()
        break
      case 'Home':
        event.preventDefault()
        rows[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        rows[rows.length - 1]?.focus()
        break
      case 'Escape':
        // Not the modal's business: Escape closes the list first, and only
        // a second press reaches whatever is underneath.
        event.stopPropagation()
        close(true)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        ref={(node) => {
          triggerRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        className={[
          'flex items-center justify-between gap-1.5 text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
          className,
        ].join(' ')}
      >
        <span className={`truncate ${selected ? '' : 'text-ink-faint'}`}>{selected?.label ?? placeholder}</span>
        {chevron && <ChevronDownIcon className="size-3.5 shrink-0 text-ink-faint" />}
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          onKeyDown={handleListKeyDown}
          className={[
            'absolute top-full z-20 mt-1 max-h-[40vh] w-max min-w-full max-w-[min(20rem,80vw)] overflow-y-auto p-1',
            'rounded-control border border-line bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)]',
            align === 'right' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {options.map((option) => (
            <OptionRow
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              label={option.label}
              active={option.value === value}
              onClick={(event) => {
                if (option.value !== value) onChange(option.value)
                // A keyboard "click" has no pointer position, which is how a
                // pick by Enter or Space is told from a tap.
                close(event.detail === 0)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
