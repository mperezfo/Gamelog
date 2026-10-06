import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'

import { MONTH_ABBREVIATIONS } from '../lib/format'
import type { DateFormat } from '../types/auth'
import { useDateFormat } from '../hooks/useSession'
import { Dropdown } from './Dropdown'
import { CalendarIcon } from './icons'

interface DateFieldProps {
  label: string
  /** yyyy-mm-dd, or empty for no date. */
  value: string
  onChange: (value: string) => void
}

type SegmentKind = 'd' | 'm' | 'y'

/** Which order day/month/year are typed in, and what separates them —
 * matching how the account's date format reads: "31 Dec 2023" is day,
 * month, year, space-separated; the three numeric formats are slash-
 * separated in whichever order they name. */
const SEGMENT_ORDER: Record<DateFormat, SegmentKind[]> = {
  long: ['d', 'm', 'y'],
  ymd: ['y', 'm', 'd'],
  dmy: ['d', 'm', 'y'],
  mdy: ['m', 'd', 'y'],
}

const SEPARATOR: Record<DateFormat, string> = { long: '', ymd: '/', dmy: '/', mdy: '/' }

const SEGMENT_LENGTH: Record<SegmentKind, number> = { d: 2, m: 2, y: 4 }
const SEGMENT_MAX: Record<SegmentKind, number> = { d: 31, m: 12, y: 9999 }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

const MONTH_OPTIONS = MONTH_ABBREVIATIONS.map((abbr, index) => ({ value: pad2(index + 1), label: abbr }))

/**
 * A date field built from three plain number inputs (day, month, year —
 * ordered to match the account's date format) rather than one
 * `<input type="date">`.
 *
 * A native date input was tried first, its own text hidden behind a span
 * showing the date in the chosen format instead — the browser always
 * renders a date input's text in the OS locale, format setting or not, so
 * hiding it was the only way to show anything else. But hiding it took the
 * browser's own highlight of the segment currently being typed with it,
 * which made editing hard to follow — and the segment a click landed on
 * still followed the browser's own (locale) order, not this field's, so a
 * click on what displayed as the day could start editing the month. Three
 * real inputs fix both at once: each carries the normal text selection
 * highlight on focus, and their left-to-right order is simply whichever
 * order they were rendered in.
 *
 * 'long' writes its month as a name ("Dec"), not a number, so its month
 * segment is a Dropdown of the same twelve abbreviations formatDate uses
 * (see MONTH_ABBREVIATIONS) instead of a text box — the only place this
 * field's three segments aren't all the same shape.
 */
export function DateField({ label, value, onChange }: DateFieldProps) {
  const id = useId()
  const dateFormat = useDateFormat()
  const order = SEGMENT_ORDER[dateFormat]
  const separator = SEPARATOR[dateFormat]
  const monthIsName = dateFormat === 'long'

  const splitValue = (v: string) => (v ? (v.split('-') as [string, string, string]) : ['', '', ''])
  const [[initialYear, initialMonth, initialDay]] = useState(() => splitValue(value))
  const [day, setDay] = useState(initialDay)
  const [month, setMonth] = useState(initialMonth)
  const [year, setYear] = useState(initialYear)

  // Re-splits the segments whenever `value` changes for a reason other than
  // our own typing — switching to another game, the calendar picker, a
  // discard. `syncedFrom` is what tells the two apart: commit() (below)
  // advances it to match the value it just sent up, so the props round-trip
  // back here without re-splitting over a segment mid-keystroke; anything
  // else changing `value` leaves it stale and this fires. The initial split
  // above already covers the very first render, so this only ever fires for
  // a later change.
  //
  // Done during render rather than in an effect — React's own documented
  // way to adjust state for a prop change — so the segments never paint a
  // stale value for a frame first.
  const [syncedFrom, setSyncedFrom] = useState(value)
  if (value !== syncedFrom) {
    setSyncedFrom(value)
    const [y, m, d] = splitValue(value)
    setYear(y)
    setMonth(m)
    setDay(d)
  }

  const dayRef = useRef<HTMLInputElement>(null)
  const monthRef = useRef<HTMLInputElement>(null)
  const monthSelectRef = useRef<HTMLButtonElement>(null)
  const yearRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const refs: Record<SegmentKind, RefObject<HTMLInputElement | null>> = { d: dayRef, m: monthRef, y: yearRef }

  /** Writes a date out once all three segments are complete, or clears it
   * once all three are empty — a partial combination (typing the day, not
   * the month yet) commits nothing either way. */
  function commit(next: Record<SegmentKind, string>) {
    if (next.d.length === 2 && next.m.length === 2 && next.y.length === 4) {
      onChange(`${next.y}-${next.m}-${next.d}`)
    } else if (next.d === '' && next.m === '' && next.y === '') {
      onChange('')
    }
  }

  function focusSegment(kind: SegmentKind) {
    const el = kind === 'm' && monthIsName ? monthSelectRef.current : refs[kind].current
    el?.focus()
    if (el instanceof HTMLInputElement) el.select()
  }

  const SETTERS: Record<SegmentKind, (v: string) => void> = { d: setDay, m: setMonth, y: setYear }
  const VALUES: Record<SegmentKind, string> = { d: day, m: month, y: year }

  function handleSegmentInput(kind: SegmentKind, raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, SEGMENT_LENGTH[kind])
    SETTERS[kind](digits)

    const next = { d: day, m: month, y: year, [kind]: digits } as Record<SegmentKind, string>
    commit(next)

    // Auto-advance once a segment is as long as it can be, so typing a full
    // date never needs the mouse or a manual Tab.
    if (digits.length === SEGMENT_LENGTH[kind]) {
      const index = order.indexOf(kind)
      const clamped =
        kind === 'y' ? digits : String(Math.max(1, Math.min(SEGMENT_MAX[kind], Number(digits)))).padStart(2, '0')
      if (clamped !== digits) {
        SETTERS[kind](clamped)
        commit({ ...next, [kind]: clamped })
      }
      const nextKind = order[index + 1]
      if (nextKind) focusSegment(nextKind)
    }
  }

  function handleMonthNameChange(raw: string) {
    setMonth(raw)
    commit({ d: day, m: raw, y: year })
    const index = order.indexOf('m')
    const nextKind = order[index + 1]
    if (nextKind) focusSegment(nextKind)
  }

  /** Zero-pads a segment left with a single digit in it once it loses focus
   * — typing "3" and tabbing or clicking away without a second digit left
   * it as "3" forever, which never satisfies commit()'s two-digit check
   * (see above), so the date silently never saved. Only day/month need
   * this: year commits at four digits and isn't padded.
   *
   * Reads the segment's value off the blur event itself rather than off
   * `VALUES[kind]`/component state: typing a segment's second digit calls
   * focusSegment() to auto-advance in the same tick, and that focus() call
   * fires this segment's blur *synchronously*, before React has re-rendered
   * with the just-typed digit — so the closure here still has the state
   * from before that keystroke, one digit short, and would wrongly treat a
   * completed two-digit segment ("12") as a lone "1" and pad it down to
   * "01". The DOM input's own value is never stale like that: the browser
   * already wrote the second keystroke into it before either the change or
   * the blur handler ran. */
  function handleSegmentBlur(kind: SegmentKind, event: FocusEvent<HTMLInputElement>) {
    if (kind === 'y') return
    const raw = event.currentTarget.value
    if (raw.length !== 1) return
    const padded = raw.padStart(2, '0')
    SETTERS[kind](padded)
    commit({ d: day, m: month, y: year, [kind]: padded })
  }

  function handleSegmentKeyDown(kind: SegmentKind) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      const index = order.indexOf(kind)
      if (event.key === 'Backspace' && VALUES[kind] === '' && index > 0) {
        focusSegment(order[index - 1])
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault()
        focusSegment(order[index - 1])
      } else if (event.key === 'ArrowRight' && index < order.length - 1) {
        event.preventDefault()
        focusSegment(order[index + 1])
      }
    }
  }

  const PLACEHOLDER: Record<SegmentKind, string> = { d: 'DD', m: 'MM', y: 'YYYY' }
  const WIDTH: Record<SegmentKind, string> = { d: 'w-6', m: 'w-6', y: 'w-9' }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-ink-muted">{label}</label>
      <div className="relative flex h-9 items-center gap-1 rounded-control bg-sunken pr-8 pl-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40">
        {order.map((kind, index) => (
          <span key={kind} className="flex items-center gap-1">
            {index > 0 && separator && <span className="text-sm text-ink-faint">{separator}</span>}

            {kind === 'm' && monthIsName ? (
              <Dropdown
                id={kind === order[0] ? id : undefined}
                ref={monthSelectRef}
                aria-label={`${label}, month`}
                value={month}
                onChange={handleMonthNameChange}
                options={MONTH_OPTIONS}
                placeholder="MMM"
                chevron={false}
                className="w-9 text-sm text-ink"
              />
            ) : (
              <input
                id={kind === order[0] ? id : undefined}
                ref={refs[kind]}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={PLACEHOLDER[kind]}
                value={VALUES[kind]}
                onChange={(event) => handleSegmentInput(kind, event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={handleSegmentKeyDown(kind)}
                onBlur={(event) => handleSegmentBlur(kind, event)}
                className={[
                  WIDTH[kind],
                  'bg-transparent text-center text-sm text-ink outline-none placeholder:text-ink-faint',
                ].join(' ')}
              />
            )}
          </span>
        ))}

        <button
          type="button"
          onClick={() => pickerRef.current?.showPicker?.()}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-faint transition-colors duration-75 hover:text-ink-muted"
          aria-label={`Open the date picker for ${label}`}
        >
          <CalendarIcon className="size-3.5" />
        </button>

        {/* A real date input, kept for its picker alone: clicking the icon
            above calls showPicker() on it, and its own change feeds back
            into the three segments so a pick from the calendar updates them
            exactly as typing would. Visually hidden rather than removed
            from layout, which is what keeps showPicker() working — some
            browsers refuse it on a display:none element. */}
        <input
          ref={pickerRef}
          type="date"
          value={value}
          onChange={(event) => {
            const next = event.target.value
            if (!next) {
              setDay('')
              setMonth('')
              setYear('')
              onChange('')
              return
            }
            const [y, m, d] = next.split('-')
            setYear(y)
            setMonth(m)
            setDay(d)
            onChange(next)
          }}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full opacity-0"
        />
      </div>
    </div>
  )
}
