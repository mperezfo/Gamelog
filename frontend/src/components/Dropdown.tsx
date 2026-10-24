import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'

import { ChevronDownIcon } from './icons'
import { OptionRow } from './OptionRow'
import { Popover } from './Popover'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  /** Shown after the label, on the trigger and in the list, and never cut:
   * the label truncates first (see OptionRow). */
  marker?: ReactNode
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
 * button and a list in a Popover under it.
 *
 * Keyboard: Arrow keys open it and move through it, Enter or Space picks,
 * Escape closes it and returns to the trigger, Tab leaves it. Focus only
 * goes back to the trigger after a keyboard pick: after a tap that would
 * paint the focus ring this component exists to avoid.
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find((option) => option.value === value)
  // Where focus lands on opening, so the arrow keys continue from there.
  // Focusing is harmless after a tap: a script focusing a button right
  // after a pointer press does not count as keyboard focus, so no ring
  // appears.
  const initial = selected?.value ?? options[0]?.value

  // The current choice in the middle of the list, for a long one such as
  // the years of the date picker. Before paint, so it never shows a frame
  // scrolled to the top.
  useLayoutEffect(() => {
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!open || !list || !row) return
    list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    } else if (event.key === 'Escape' && open) {
      // Before focus has moved into the list, which waits a frame for it
      // to be placed (see Popover), an Escape still closes the list alone.
      event.stopPropagation()
      setOpen(false)
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
    }
  }

  return (
    <>
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
          'group/trigger flex items-center justify-between gap-1.5 text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
          className,
        ].join(' ')}
      >
        <span className={`flex min-w-0 items-baseline gap-1 ${selected ? '' : 'text-ink-faint'}`}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
          {selected?.marker}
        </span>
        {chevron && (
          <ChevronDownIcon className="size-3.5 shrink-0 text-ink-faint transition-colors duration-75 group-hover/trigger:text-ink group-disabled/trigger:text-ink-faint" />
        )}
      </button>

      <Popover
        ref={listRef}
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        placement={align === 'right' ? 'bottom-end' : 'bottom-start'}
        role="listbox"
        id={listId}
        aria-label={ariaLabel}
        onKeyDown={handleListKeyDown}
        className={[
          'max-h-[min(40vh,var(--popover-available-height,40vh))] w-max min-w-(--popover-anchor-width)',
          'max-w-[min(20rem,80vw)] overflow-y-auto p-1',
        ].join(' ')}
      >
        {options.map((option) => (
          <OptionRow
            key={option.value}
            role="option"
            aria-selected={option.value === value}
            // Out of the Tab order: the arrow keys move through the list,
            // and Tab leaves it (see Popover).
            tabIndex={-1}
            data-autofocus={option.value === initial ? '' : undefined}
            label={option.label}
            marker={option.marker}
            active={option.value === value}
            onClick={(event) => {
              if (option.value !== value) onChange(option.value)
              // A keyboard "click" has no pointer position, which is how a
              // pick by Enter or Space is told from a tap.
              close(event.detail === 0)
            }}
          />
        ))}
      </Popover>
    </>
  )
}
