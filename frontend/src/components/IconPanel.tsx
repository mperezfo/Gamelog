import { Suspense, use, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { iconLabel } from '../lib/genreIcons'
import { COLUMN_WIDTH, COLUMNS } from '../lib/pickerGrid'
import { ColorSliders } from './ColorSliders'
import { PanelSearch } from './PickerParts'

type IconEntry = (typeof import('virtual:genre-icons'))['default'][number]

let index: Promise<IconEntry[]> | undefined

/** The icons the picker offers (see genreIconsPlugin in vite.config.ts), in
 * a chunk of their own that only the picker loads, and only once. */
function loadIcons(): Promise<IconEntry[]> {
  index ??= import('virtual:genre-icons').then((module) => module.default)
  return index
}

/** The first category, which repeats icons of the others: left out of a
 * search, so that no icon shows up twice. */
const SUGGESTED = 'Suggested'

interface IconPanelProps {
  /** The search, shared with the Emoji tab (see IconField). */
  search: string
  onSearch: (search: string) => void
  onPick: (name: string) => void
  /** The name of the icon the field has, if it has one. */
  selected: string | null
  /** The colour the icon is drawn in (#rrggbb), or empty for none. */
  color: string
  onColor: (color: string) => void
}

/**
 * The Icons tab of a genre's icon picker: Tabler's icons, as filtered by
 * genre-icons.config.ts, the hand-picked Suggested ones first and the rest by
 * category, each set apart by a line rather than named: an icon says what it
 * is in its tooltip. The same grid as the Emoji tab, searched by name and by
 * Tabler's tags, drawn in the colour picked under it, so that every icon
 * shows as it would.
 */
export function IconPanel({ search, onSearch, onPick, selected, color, onColor }: IconPanelProps) {
  const panel = useRef<HTMLDivElement>(null)
  const sliders = <ColorSliders value={color} onChange={onColor} />

  // From the search box, Down goes into the grid and Enter picks the first
  // icon found, as in the Emoji tab.
  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    const first = panel.current?.querySelector<HTMLButtonElement>('[data-position="0-0"]')
    if (!first) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      first.focus()
    } else if (event.key === 'Enter' && search.trim()) {
      event.preventDefault()
      first.click()
    }
  }

  return (
    <div ref={panel} className="flex min-h-0 flex-1 flex-col">
      <PanelSearch>
        <input
          type="text"
          placeholder="Search icons…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={searchKeys}
          aria-label="Search icons"
          data-autofocus=""
          autoFocus
          spellCheck={false}
          className="h-8 w-full rounded-control bg-field shadow-field px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </PanelSearch>
      <Suspense
        fallback={
          <>
            <p className="flex flex-1 items-center justify-center text-xs text-ink-faint">Loading…</p>
            {sliders}
          </>
        }
      >
        <IconGrid search={search} onPick={onPick} selected={selected} color={color} sliders={sliders} />
      </Suspense>
    </div>
  )
}

interface Row {
  /** The category the row belongs to; only its first row shows the name. */
  category: string
  first: boolean
  icons: IconEntry[]
}

/** The icons matching a search, in rows of the grid. Every word of the
 * search has to be in the icon's name or among its tags. */
function rowsFor(icons: IconEntry[], search: string): Row[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matching = words.length
    ? icons.filter(([name, category, tags]) => {
        if (category === SUGGESTED) return false
        const text = `${name} ${tags.toLowerCase()}`
        return words.every((word) => text.includes(word))
      })
    : icons

  const rows: Row[] = []
  let category = ''
  for (const icon of matching) {
    const last = rows.at(-1)
    if (icon[1] !== category || !last || last.icons.length === COLUMNS) {
      rows.push({ category: icon[1], first: icon[1] !== category, icons: [] })
      category = icon[1]
    }
    rows.at(-1)!.icons.push(icon)
  }
  return rows
}

interface Position {
  row: number
  column: number
}

function IconGrid({
  search,
  onPick,
  selected,
  color,
  sliders,
}: Omit<IconPanelProps, 'onSearch' | 'onColor'> & { sliders: ReactNode }) {
  const icons = use(loadIcons())
  const rows = useMemo(() => rowsFor(icons, search), [icons, search])
  const viewport = useRef<HTMLDivElement>(null)
  // The icon the keyboard is on, the one Tab lands on in the grid.
  const [focused, setFocused] = useState<Position>({ row: 0, column: 0 })

  const current = rows[focused.row] && rows[focused.row].icons[focused.column] ? focused : { row: 0, column: 0 }

  function focusAt(position: Position) {
    setFocused(position)
    const button = viewport.current?.querySelector<HTMLButtonElement>(
      `[data-position="${position.row}-${position.column}"]`,
    )
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest' })
  }

  function move(event: KeyboardEvent<HTMLElement>) {
    const { row, column } = current
    const step: Record<string, () => Position | null> = {
      ArrowLeft: () => (column > 0 ? { row, column: column - 1 } : row > 0 ? { row: row - 1, column: rows[row - 1].icons.length - 1 } : null),
      ArrowRight: () =>
        column < rows[row].icons.length - 1 ? { row, column: column + 1 } : row < rows.length - 1 ? { row: row + 1, column: 0 } : null,
      ArrowUp: () => (row > 0 ? { row: row - 1, column: Math.min(column, rows[row - 1].icons.length - 1) } : null),
      ArrowDown: () =>
        row < rows.length - 1 ? { row: row + 1, column: Math.min(column, rows[row + 1].icons.length - 1) } : null,
      Home: () => ({ row, column: 0 }),
      End: () => ({ row, column: rows[row].icons.length - 1 }),
    }
    const next = step[event.key]?.()
    if (step[event.key]) event.preventDefault()
    if (next) focusAt(next)
  }

  // The field's own icon in view as the picker opens, without moving focus
  // from the search box.
  const [opened] = useState(selected)
  useLayoutEffect(() => {
    if (opened) viewport.current?.querySelector(`[data-name="${opened}"]`)?.scrollIntoView({ block: 'center' })
  }, [opened])

  return (
    <>
      {/* The scrollbar's gutter on both sides, so that the grid stays in the
          middle, as in the Emoji tab. */}
      <div
        ref={viewport}
        role="grid"
        aria-label="Icons"
        onKeyDown={move}
        className="relative flex-1 overflow-y-auto pt-1 pb-1.5 outline-none select-none"
        style={{ scrollbarGutter: 'stable both-edges' }}
      >
        {rows.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-ink-faint">No icon found.</p>
        )}
        {rows.map((row, rowIndex) => (
          <div key={`${row.category}-${rowIndex}`} role="row">
            {/* A category starts after a line, not under its name. */}
            {row.first && rowIndex > 0 && <div className={`${COLUMN_WIDTH} my-1.5 h-px bg-line`} />}
            <div className={`${COLUMN_WIDTH} flex scroll-my-1.5`}>
              {row.icons.map(([name, , , drawing], column) => {
                const isFocused = rowIndex === current.row && column === current.column
                return (
                  <button
                    key={name}
                    type="button"
                    role="gridcell"
                    data-name={name}
                    data-position={`${rowIndex}-${column}`}
                    tabIndex={isFocused ? 0 : -1}
                    aria-label={iconLabel(name)}
                    data-tooltip={iconLabel(name)}
                    aria-selected={name === selected}
                    onClick={() => onPick(name)}
                    onFocus={() => setFocused({ row: rowIndex, column })}
                    className={[
                      'flex size-[2.125rem] items-center justify-center rounded-control text-ink-muted outline-none',
                      'hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40',
                      name === selected ? 'bg-sunken text-ink' : '',
                    ].join(' ')}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="size-5"
                      style={color ? { color } : undefined}
                      // The drawing comes from the build (genreIconsPlugin),
                      // never from anything a user typed.
                      dangerouslySetInnerHTML={{ __html: drawing }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {sliders}
    </>
  )
}
