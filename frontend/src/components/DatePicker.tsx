import type { ChangeEvent } from 'react'

import { DayPicker, type ChevronProps, type DropdownProps } from 'react-day-picker'

import { dayKey } from '../lib/calendar'
import { Dropdown } from './Dropdown'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon } from './icons'

interface DatePickerProps {
  /** yyyy-mm-dd, or empty for no date. */
  value: string
  /** yyyy-mm-dd, or empty once cleared. */
  onPick: (value: string) => void
}

/** How far back and ahead the month and year dropdowns reach. */
const FIRST_YEAR = 1970
const YEARS_AHEAD = 10

/**
 * A month calendar to pick a day from, in place of the browser's own date
 * picker, which looks different in every browser (and on a phone is an
 * operating system sheet) and ignores the theme.
 *
 * Built on react-day-picker, which brings the keyboard handling of a date
 * grid (arrows, Page Up/Down for months, Home/End for the week); everything
 * it draws is styled here, and its month and year dropdowns are the app's
 * own Dropdown rather than native selects. Weeks start on Monday, as in
 * GameCalendar.
 */
export function DatePicker({ value, onPick }: DatePickerProps) {
  const selected = value ? parseDay(value) : undefined
  const today = new Date()

  return (
    <div className="flex flex-col gap-2 p-3">
      <DayPicker
        mode="single"
        required
        selected={selected}
        onSelect={(date) => onPick(dayKey(date))}
        defaultMonth={selected ?? today}
        weekStartsOn={1}
        captionLayout="dropdown"
        startMonth={new Date(FIRST_YEAR, 0)}
        endMonth={new Date(today.getFullYear() + YEARS_AHEAD, 11)}
        showOutsideDays
        fixedWeeks
        autoFocus
        components={{ Chevron, Dropdown: CaptionDropdown }}
        classNames={{
          root: 'text-sm text-ink',
          months: 'relative',
          month: 'flex flex-col gap-2',
          month_caption: 'flex h-8 items-center',
          dropdowns: 'flex items-center gap-0.5',
          nav: 'absolute top-0 right-0 z-10 flex h-8 items-center gap-0.5',
          button_previous: NAV_BUTTON,
          button_next: NAV_BUTTON,
          month_grid: 'border-collapse',
          weekdays: '',
          weekday: 'size-9 p-0 text-[11px] font-medium text-ink-faint',
          week: '',
          day: 'size-9 p-0 text-center',
          day_button: [
            'size-9 rounded-control text-sm transition-colors duration-75',
            'hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          ].join(' '),
          // Like GameCalendar's: today's number in the accent colour.
          today: 'font-semibold text-accent',
          selected: '[&>button]:bg-accent [&>button]:font-semibold [&>button]:text-accent-ink [&>button]:hover:bg-accent-strong',
          outside: 'text-ink-faint',
          disabled: 'opacity-40',
          hidden: 'invisible',
        }}
      />

      <div className="flex items-center justify-between border-t border-line pt-2">
        <button type="button" onClick={() => onPick(dayKey(today))} className={FOOTER_BUTTON}>
          Today
        </button>
        {value && (
          <button type="button" onClick={() => onPick('')} className={FOOTER_BUTTON}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

const NAV_BUTTON = [
  'flex size-7 items-center justify-center rounded-control text-ink-muted transition-colors duration-75',
  'enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
].join(' ')

const FOOTER_BUTTON = [
  'rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors duration-75',
  'hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
].join(' ')

/** A yyyy-mm-dd string as a local date, the same day wherever it is read. */
function parseDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function Chevron({ orientation }: ChevronProps) {
  const Glyph =
    orientation === 'left'
      ? ChevronLeftIcon
      : orientation === 'right'
        ? ChevronRightIcon
        : orientation === 'up'
          ? ChevronUpIcon
          : ChevronDownIcon
  return <Glyph className="size-4" />
}

/**
 * The month and year dropdowns of the caption, as the app's own Dropdown.
 * DayPicker hands over what a native select would get, and reads the pick
 * back off `event.target.value`, which is all this passes it.
 */
function CaptionDropdown({ options = [], value, onChange, disabled, 'aria-label': ariaLabel }: DropdownProps) {
  return (
    <Dropdown
      aria-label={ariaLabel}
      value={String(value)}
      onChange={(next) => onChange?.({ target: { value: next } } as ChangeEvent<HTMLSelectElement>)}
      options={options.filter((option) => !option.disabled).map((option) => ({ value: String(option.value), label: option.label }))}
      disabled={disabled}
      className="h-8 rounded-control px-1.5 text-sm font-medium text-ink transition-colors duration-75 enabled:hover:bg-hover"
    />
  )
}
