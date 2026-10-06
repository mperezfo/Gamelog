import { useId } from 'react'

import { Dropdown, type DropdownOption } from './Dropdown'

interface SelectProps<T extends string> {
  label: string
  hint?: string
  value: T
  onChange: (value: T) => void
  options: DropdownOption<T>[]
  disabled?: boolean
  /** Sizing and layout classes, landing on the wrapper so a caller's
   * `w-auto` sizes the whole control. */
  className?: string
  align?: 'left' | 'right'
}

/** A labelled dropdown, styled to match Field. See Dropdown for why this is
 * not a native `<select>`. */
export function Select<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  disabled,
  className = '',
  align,
}: SelectProps<T>) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
          {label}
        </label>
      )}
      <div className={['h-9 w-full', className].join(' ')}>
        <Dropdown
          id={id}
          value={value}
          onChange={onChange}
          options={options}
          disabled={disabled}
          align={align}
          className="h-9 w-full rounded-control bg-sunken px-2.5 text-sm text-ink transition-colors duration-75"
        />
      </div>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}
