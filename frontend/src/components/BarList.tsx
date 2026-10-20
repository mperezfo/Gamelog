import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useEdgeFade } from '../hooks/useEdgeFade'
import { previewHandlers, type Highlight, type SetPreview, type Share } from '../lib/stats'
import type { Game } from '../types/game'
import { Emoji } from './Emoji'
import { GamesPreviewLink } from './GamesPreviewLink'
import { ChevronRightIcon } from './icons'

interface BarListProps {
  rows: Share[]
  /** The row picked out right now, hovered or pinned, to colour it in. */
  activeKey: string | null
  pinnedKey: string | null
  /** Pointing at a row (or reaching it with the keyboard) previews it; a
   * click pins it, which is the only way to pick one out on a touch screen. */
  onPreview: SetPreview
  onPin: (row: Highlight) => void
  /** How many rows fit before the list scrolls. Leave it out to show every
   * row. */
  visibleRows?: number
  /** The games the rows count, to preview a row's games while its link to
   * the Games page is pointed at, and what opens one of them. Leave them out
   * for no preview. */
  games?: Game[]
  onOpenGame?: (game: Game) => void
  /** What the preview says of each game beside its score (see
   * GamesPreview). */
  previewDetail?: (game: Game) => ReactNode
  /** And in what order it lists them (see GamesPreview). */
  previewOrder?: (a: Game, b: Game) => number
}

/** A row's height: the h-8 of its button and a pixel of padding above and
 * below (see the `ul` below for why the gap between rows is padding). */
const ROW_HEIGHT = 34

/**
 * A ranked list whose rows are their own bar: each one is filled behind its
 * text in proportion to the largest. Takes the place of a pie chart, which
 * cannot be read past a handful of slices, and of a separate legend, since
 * the name is right on its bar.
 */
export function BarList({
  rows,
  activeKey,
  pinnedKey,
  onPreview,
  onPin,
  visibleRows,
  games,
  onOpenGame,
  previewDetail,
  previewOrder,
}: BarListProps) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  const fadeRef = useEdgeFade('y')

  return (
    // No gap between rows: the space that separates them is each row's own
    // padding instead, so the pointer never crosses a sliver of nothing on
    // its way from one row to the next, which flickered the preview off and
    // back on.
    //
    // A long list scrolls inside itself, like a board column on the
    // dashboard, rather than growing the page or hiding its tail behind a
    // "Show all": the charts above stay where they are while it is read.
    <div
      ref={visibleRows != null ? fadeRef : undefined}
      className={visibleRows != null ? 'overflow-y-auto' : ''}
      style={visibleRows != null ? { maxHeight: visibleRows * ROW_HEIGHT } : undefined}
    >
      <ul className="flex flex-col">
        {rows.map((row) => {
          const active = row.key === activeKey
          const pinned = row.key === pinnedKey
          const tint = row.color ? ({ '--tint': row.color } as CSSProperties) : undefined

          return (
            // The row as a whole previews, link included, for the same reason.
            <li key={row.key} className="group flex items-center gap-0.5 py-px" style={tint} {...previewHandlers(row, onPreview)}>
              <button
                type="button"
                aria-pressed={pinned}
                onClick={() => onPin(row)}
                className={[
                  'relative flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left text-[13px] transition-colors duration-75',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
                  // The whole row lights up too: a short bar alone would be
                  // too small a mark of which row is picked.
                  active ? 'bg-hover' : '',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'absolute inset-y-0 left-0 rounded-control transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none',
                    active ? (row.color ? 'tint' : 'bg-accent-soft') : 'bg-sunken group-hover:bg-hover',
                  ].join(' ')}
                  style={{ width: `${Math.max((row.count / max) * 100, 1)}%` }}
                />
                <RowLabel row={row} />
                <span className="relative shrink-0 text-xs tabular-nums text-ink-muted">{row.count}</span>
              </button>
              {row.href &&
                (games && onOpenGame ? (
                  <GamesPreviewLink
                    to={row.href}
                    label={row.label}
                    games={games}
                    test={row.test}
                    detail={previewDetail}
                    order={previewOrder}
                    onOpenGame={onOpenGame}
                    tooltip="See these games"
                    aria-label={`See the games: ${row.label}`}
                    className={linkClass(pinned)}
                  >
                    <ChevronRightIcon className="size-4" />
                  </GamesPreviewLink>
                ) : (
                  <Link
                    to={row.href}
                    data-tooltip="See these games"
                    aria-label={`See the games: ${row.label}`}
                    className={linkClass(pinned)}
                  >
                    <ChevronRightIcon className="size-4" />
                  </Link>
                ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The arrow to a row's games on the Games page. */
function linkClass(pinned: boolean): string {
  return [
    'flex size-8 shrink-0 items-center justify-center rounded-control text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink',
    // With a mouse, only on the row under it, pinned or not. A touch screen
    // has no hover to bring it up, so there it shows on the pinned row, the
    // one a tap picked.
    'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100',
    pinned ? '' : 'pointer-coarse:invisible',
  ].join(' ')
}

/** A platform's colour as a dot, a genre's emoji, or just the name. The row
 * for games with none ("No platform") reads quieter. */
function RowLabel({ row }: { row: Share }) {
  const lookup = row.lookup
  return (
    <span className={`relative flex min-w-0 flex-1 items-center gap-1.5 ${row.none ? 'text-ink-faint' : 'text-ink'}`}>
      {row.color && <span className="tint-fill size-2 shrink-0 rounded-full" aria-hidden="true" />}
      {lookup?.icon && (
        <span className="shrink-0" aria-hidden="true">
          <Emoji value={lookup.icon} />
        </span>
      )}
      <span className="truncate">
        <Emoji value={row.label} />
      </span>
    </span>
  )
}
