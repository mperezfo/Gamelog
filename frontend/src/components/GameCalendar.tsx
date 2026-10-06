import { useEffect, useMemo, useRef, useState } from 'react'

import { monthGrid, monthLabel, monthNames, weekdayLabels } from '../lib/calendar'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import type { Game } from '../types/game'
import { Button } from './Button'
import { Dropdown } from './Dropdown'
import { ChevronDownIcon, ChevronUpIcon } from './icons'
import { CoverOverlay } from './CoverOverlay'

type DateField = 'release_date' | 'logged_date'

const FIELD_LABELS: Record<DateField, string> = {
  release_date: 'Release dates',
  logged_date: 'Logged dates',
}

interface GameCalendarProps {
  games: Game[]
  onSelectGame: (game: Game) => void
}

const MAX_PER_DAY = 3
const MIN_YEAR = 1970
const MAX_YEAR = new Date().getFullYear() + 5

const MONTH_OPTIONS = monthNames().map((name, index) => ({ value: String(index), label: name }))

function startOfThisMonth(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function isValidYear(value: string): boolean {
  if (!/^\d{4}$/.test(value)) return false
  const year = Number(value)
  return year >= MIN_YEAR && year <= MAX_YEAR
}

/** A month grid, toggling between when a game came out and when you logged
 * it. Built by hand: a calendar is arithmetic on a handful of integers, not
 * worth a library for one view. */
export function GameCalendar({ games, onSelectGame }: GameCalendarProps) {
  const [field, setField] = useState<DateField>('release_date')
  const [month, setMonth] = useState(startOfThisMonth)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [yearDraft, setYearDraft] = useState(String(month.getFullYear()))
  const [yearInvalid, setYearInvalid] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function handleClick(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [pickerOpen])

  useEffect(() => {
    if (pickerOpen) {
      setYearDraft(String(month.getFullYear()))
      setYearInvalid(false)
    }
  }, [pickerOpen, month])

  function commitYearDraft() {
    if (!isValidYear(yearDraft)) {
      setYearInvalid(true)
      return
    }
    setYearInvalid(false)
    setMonth((m) => new Date(Number(yearDraft), m.getMonth(), 1))
  }

  function stepYear(delta: number) {
    const base = isValidYear(yearDraft) ? Number(yearDraft) : month.getFullYear()
    const year = Math.min(MAX_YEAR, Math.max(MIN_YEAR, base + delta))
    setYearDraft(String(year))
    setYearInvalid(false)
    setMonth((m) => new Date(year, m.getMonth(), 1))
  }

  const byDay = useMemo(() => {
    const map = new Map<string, Game[]>()
    for (const game of games) {
      const date = game[field]
      if (!date) continue
      const key = date.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(game)
      else map.set(key, [game])
    }
    return map
  }, [games, field])

  const cells = useMemo(() => monthGrid(month), [month])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-0.5 self-start rounded-control bg-sunken p-0.5">
        {(Object.keys(FIELD_LABELS) as DateField[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setField(value)}
            className={[
              'rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors duration-75',
              field === value ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_15_15/0.08)]' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            {FIELD_LABELS[value]}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="text-sm font-medium text-ink hover:text-accent"
          >
            {monthLabel(month)}
          </button>

          {pickerOpen && (
            <div className="absolute top-full left-0 z-10 mt-1 flex items-center gap-1.5 rounded-control bg-surface p-2 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
              <Dropdown
                aria-label="Month"
                value={String(month.getMonth())}
                onChange={(value) => setMonth((m) => new Date(m.getFullYear(), Number(value), 1))}
                options={MONTH_OPTIONS}
                className="h-8 rounded-control bg-sunken px-2 text-sm text-ink"
              />
              <div className="relative flex">
                <input
                  aria-label="Year"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={yearDraft}
                  onChange={(event) => {
                    setYearDraft(event.target.value.replace(/\D/g, ''))
                    setYearInvalid(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitYearDraft()
                    else if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      if (isValidYear(yearDraft)) stepYear(1)
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      if (isValidYear(yearDraft)) stepYear(-1)
                    }
                  }}
                  onBlur={commitYearDraft}
                  className={[
                    'h-8 w-20 rounded-control bg-sunken py-0 pl-2 pr-6 text-sm text-ink outline-none',
                    yearInvalid ? 'ring-1 ring-red-500' : '',
                  ].join(' ')}
                />
                <div className="absolute inset-y-0 right-1 flex flex-col justify-center">
                  <button
                    type="button"
                    aria-label="Next year"
                    tabIndex={-1}
                    disabled={!isValidYear(yearDraft)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => stepYear(1)}
                    className="flex h-3.5 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Previous year"
                    tabIndex={-1}
                    disabled={!isValidYear(yearDraft)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => stepYear(-1)}
                    className="flex h-3.5 w-4 items-center justify-center text-ink-faint hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setMonth(startOfThisMonth())}>
            Today
          </Button>
          <Button
            variant="ghost"
            className="px-2"
            aria-label="Previous month"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          >
            <ChevronUpIcon className="size-4 -rotate-90" />
          </Button>
          <Button
            variant="ghost"
            className="px-2"
            aria-label="Next month"
            onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          >
            <ChevronDownIcon className="size-4 -rotate-90" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-control border border-line bg-line text-xs">
        {weekdayLabels().map((label) => (
          <div key={label} className="bg-sunken px-1.5 py-1 text-center font-medium text-ink-faint">
            {label}
          </div>
        ))}

        {cells.map((cell) => {
          const dayGames = byDay.get(cell.key) ?? []
          const single = dayGames.length === 1
          return (
            <div
              key={cell.key}
              className={[
                'flex min-h-[70px] flex-col gap-0.5 bg-surface px-1 py-1 xl:min-h-[84px] 2xl:min-h-[108px]',
                cell.inMonth ? '' : 'opacity-40',
              ].join(' ')}
            >
              <span className={cell.isToday ? 'inline-flex size-4 items-center justify-center rounded-full bg-accent text-[11px] text-accent-ink' : 'text-[11px] text-ink-faint'}>
                {cell.date.getDate()}
              </span>
              {dayGames.slice(0, MAX_PER_DAY).map((game) => {
                const unreleased = isUnreleased(game)
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => onSelectGame(game)}
                    title={game.title}
                    className={`flex w-full items-center truncate overflow-hidden rounded-[3px] text-left font-medium transition-colors duration-75 hover:brightness-95 ${
                      single ? 'flex-col text-center' : 'gap-1 py-0.5 pr-1 pl-0.5 text-[11px]'
                    } ${game.platform?.color ? '' : 'bg-sunken text-ink hover:bg-hover'} ${unreleased ? UNRELEASED_RING : ''}`}
                    style={
                      game.platform?.color
                        ? { backgroundColor: `${game.platform.color}22`, color: game.platform.color }
                        : undefined
                    }
                  >
                    {game.cover_image_url ? (
                      <span className={single ? 'relative block w-full shrink-0 overflow-hidden' : 'contents'}>
                        <img
                          src={game.cover_image_url}
                          alt=""
                          className={`${single ? 'h-8 w-full object-cover xl:h-11 2xl:h-16' : 'size-3.5 shrink-0 rounded-[2px] object-cover'} ${unreleased ? UNRELEASED_IMAGE : ''}`}
                        />
                        {single && <CoverOverlay />}
                      </span>
                    ) : (
                      <span className={single ? 'h-8 w-full shrink-0 bg-black/10 xl:h-11 2xl:h-16' : 'size-3.5 shrink-0 rounded-[2px] bg-black/10'} />
                    )}
                    <span className={single ? 'w-full truncate px-1.5 py-0.5 text-[11px]' : 'truncate'}>{game.title}</span>
                  </button>
                )
              })}
              {dayGames.length > MAX_PER_DAY && (
                <span className="px-1 text-[10px] text-ink-faint">
                  +{dayGames.length - MAX_PER_DAY} more
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
