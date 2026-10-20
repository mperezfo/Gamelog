import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'

import { errorMessage } from '../api/client'
import { BarList } from '../components/BarList'
import { Dropdown } from '../components/Dropdown'
import { ChevronLeftIcon, XIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { PlayedChart } from '../components/PlayedChart'
import { ScoreHistogram } from '../components/ScoreHistogram'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useFilterParams } from '../hooks/useFilterParams'
import { useGameModal } from '../hooks/useGameModal'
import { useGames } from '../hooks/useGames'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useOffline } from '../hooks/useOffline'
import { formatScore } from '../lib/format'
import { daysAfterRelease } from '../lib/releaseAge'
import {
  averageScore,
  breakdown,
  byTimeAfterRelease,
  formatAfterRelease,
  formatYears,
  inYear,
  monthLabel,
  monthBuckets,
  playedGames,
  playedYears,
  releaseAge,
  scoreBins,
  yearBuckets,
  type BreakdownKind,
  type Highlight,
} from '../lib/stats'
import type { Game } from '../types/game'

/** Rows of the breakdown before it scrolls, below `lg`, where it sits on its
 * own above Scores rather than beside it. From `lg` up the column beside it
 * decides instead (see useAlignedRows). */
const STACKED_ROWS = 8

/** What a game's line says in the preview of a breakdown row: the month it
 * was played in, and the year too unless the page is about one. */
function loggedMonth(year: string) {
  return (game: Game) => (game.logged_date ? monthLabel(game.logged_date, !year) : null)
}

/** And in the preview of an age band: how long after its release. */
function timeAfterRelease(game: Game) {
  const days = daysAfterRelease(game)
  return days == null ? null : formatAfterRelease(days)
}

const BREAKDOWN_LABELS: Record<BreakdownKind, string> = {
  platforms: 'Platforms',
  genres: 'Genres',
  developers: 'Developers',
  publishers: 'Publishers',
}

/**
 * What has been played, over time and by what, from the library the app
 * already holds.
 *
 * Few charts, each doing more than one job: everything below the time chart
 * is also a way to pick out a slice of it. Pointing at a platform, a genre,
 * a range of scores or how old games were when played paints that slice
 * inside every bar and averages it in the score strip; a click keeps it
 * there. The period picker narrows the whole page to one year, which turns
 * the chart's years into that year's months.
 */
export function Stats() {
  useDocumentTitle('Stats')
  const games = useGames()
  const offline = useOffline()
  const modal = useGameModal()
  const [filters, setFilter] = useFilterParams({ year: '' })
  const [kind, setKind] = useState<BreakdownKind>('platforms')
  const [preview, setPreview] = useState<Highlight | null>(null)
  const [pinned, setPinned] = useState<Highlight | null>(null)
  const active = preview ?? pinned

  const all = useMemo(() => games.data ?? [], [games.data])
  const played = useMemo(() => playedGames(all), [all])
  const years = useMemo(() => playedYears(played), [played])
  // A year from an old link that has nothing in it any more reads as "all
  // time" rather than as an empty page.
  const year = years.includes(filters.year) ? filters.year : ''
  const scoped = useMemo(() => inYear(played, year), [played, year])

  const buckets = useMemo(() => (year ? monthBuckets(scoped) : yearBuckets(played)), [year, scoped, played])
  const rows = useMemo(() => breakdown(scoped, kind, year), [scoped, kind, year])
  const bins = useMemo(() => scoreBins(scoped), [scoped])
  const age = useMemo(() => releaseAge(scoped, year), [scoped, year])
  const average = averageScore(scoped)

  const backlog = useMemo(() => {
    const count = (status: string) => all.filter((game) => game.status === status).length
    return { playing: count('playing'), pending: count('pending'), wishlist: count('wishlist') }
  }, [all])

  const periodOptions = [
    { value: '', label: 'All time' },
    ...years.map((y) => ({ value: y, label: y })),
  ]

  function togglePin(highlight: Highlight) {
    setPinned((current) => (current?.key === highlight.key ? null : highlight))
  }

  const selection = { activeKey: active?.key ?? null, pinnedKey: pinned?.key ?? null, onPreview: setPreview, onPin: togglePin }

  const wide = useMediaQuery('(min-width: 1024px)')
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)
  const breakdownStartRef = useRef<HTMLDivElement>(null)
  const ageStartRef = useRef<HTMLDivElement>(null)
  const alignment = useAlignedRows(
    { leftColumn: leftColumnRef, rightColumn: rightColumnRef, breakdownStart: breakdownStartRef, ageStart: ageStartRef },
    wide ? age.bands.length : 0,
    // The columns only exist once there is something played to show, and
    // the age list only once something has a release date.
    `${games.isPending}:${played.length > 0}:${age.median != null}`,
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Stats</h1>
        {years.length > 0 && (
          <Dropdown
            aria-label="Period"
            value={year}
            onChange={(value) => setFilter('year', value)}
            options={periodOptions}
            align="right"
            className="h-8 rounded-control px-2 text-sm font-medium text-ink transition-colors duration-75 enabled:hover:bg-hover"
          />
        )}
      </div>

      {games.isError && !offline && <Notice tone="error">{errorMessage(games.error)}</Notice>}

      {!games.isPending && (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Figure label={year ? `Played in ${year}` : 'Played'} value={scoped.length} />
            <Figure
              label="Average score"
              value={formatScore(average)}
              tooltip={year ? `All time: ${formatScore(averageScore(played))}` : undefined}
            />
            <Figure label="Playing now" value={backlog.playing} />
            <Figure
              label="Backlog"
              value={backlog.pending + backlog.wishlist}
              tooltip={`${backlog.pending} pending, ${backlog.wishlist} on the wishlist`}
            />
          </dl>

          {played.length === 0 ? (
            <Empty>Mark a game as played to see what you have played here.</Empty>
          ) : (
            <>
              <Section
                title={year ? `Played in ${year}` : 'Played per year'}
                aside={
                  <div className="flex min-w-0 items-center gap-1">
                    {pinned && (
                      <button
                        type="button"
                        onClick={() => setPinned(null)}
                        aria-label={`Stop showing ${pinned.label}`}
                        className="flex h-7 min-w-0 items-center gap-1 rounded-control bg-sunken px-2 text-xs text-ink-muted transition-colors duration-75 hover:text-ink"
                      >
                        <span className="truncate">{pinned.label}</span>
                        <XIcon className="size-3.5 shrink-0" />
                      </button>
                    )}
                    {year && (
                      <button
                        type="button"
                        onClick={() => setFilter('year', '')}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-control px-1.5 text-xs text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
                      >
                        <ChevronLeftIcon className="size-3.5" />
                        All years
                      </button>
                    )}
                  </div>
                }
              >
                <PlayedChart
                  buckets={buckets}
                  year={year}
                  onOpenGame={modal.openGame}
                  highlight={active}
                  onSelect={year ? undefined : (key) => setFilter('year', key)}
                />
              </Section>

              <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
                <div ref={leftColumnRef} className="lg:col-span-3">
                  <Section title="Breakdown">
                    <div className="flex items-center gap-0.5 self-start overflow-x-auto rounded-control bg-sunken p-0.5">
                      {(Object.keys(BREAKDOWN_LABELS) as BreakdownKind[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={kind === value}
                          onClick={() => {
                            setKind(value)
                            setPreview(null)
                          }}
                          className={[
                            'shrink-0 rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors duration-75',
                            kind === value ? 'bg-surface text-ink shadow-thumb' : 'text-ink-faint hover:text-ink-muted',
                          ].join(' ')}
                        >
                          {BREAKDOWN_LABELS[value]}
                        </button>
                      ))}
                    </div>
                    <div>
                      <div ref={breakdownStartRef} style={{ height: alignment?.breakdownOffset }} aria-hidden="true" />
                      {/* Keyed by kind so a new tab starts scrolled to the top. */}
                      <BarList
                        key={kind}
                        rows={rows}
                        visibleRows={alignment?.rows ?? STACKED_ROWS}
                        games={scoped}
                        onOpenGame={modal.openGame}
                        previewDetail={loggedMonth(year)}
                        {...selection}
                      />
                    </div>
                  </Section>
                </div>

                <div ref={rightColumnRef} className="flex flex-col gap-8 lg:col-span-2">
                  <Section title="Scores">
                    <ScoreHistogram bins={bins} average={average} {...selection} />
                  </Section>

                  {age.median != null && (
                    <Section title="Age when played">
                      <p className="text-xs text-ink-muted">Usually played {formatYears(age.median)} after release.</p>
                      {/* A scale rather than a ranking: every band shows, in
                          order, rather than the top few. */}
                      <div>
                        <div ref={ageStartRef} style={{ height: alignment?.ageOffset }} aria-hidden="true" />
                        <BarList
                          rows={age.bands}
                          games={scoped}
                          onOpenGame={modal.openGame}
                          previewDetail={timeAfterRelease}
                          previewOrder={byTimeAfterRelease}
                          {...selection}
                        />
                      </div>
                    </Section>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

interface Alignment {
  /** Pixels added above the breakdown list, and above the age list. One of
   * the two is always 0. */
  breakdownOffset: number
  ageOffset: number
  /** Breakdown rows that end exactly where the last age band does. */
  rows: number
}

/**
 * Lines the breakdown up with the column beside it from `lg` up: its last
 * visible row ends exactly where the last age band does, and every row of
 * one list sits level with a row of the other.
 *
 * Both lists are made of rows of the same height, but nothing about the
 * sections above them (the tabs on one side; Scores and a line of summary
 * on the other) puts them a whole number of rows apart. So the shorter of
 * the two possible nudges, a few pixels, goes above one list or the other,
 * and the breakdown then shows as many rows as reach the bottom of the age
 * list, scrolling for the rest.
 *
 * Measured rather than worked out from the classes, like the dashboard's
 * board against its calendar: the sections' heights come from type, and
 * type is the font's to decide. Each list's start is an empty element of
 * its own whose top is where the list would begin with no nudge, and whose
 * height is the nudge, so measuring never reads back its own adjustment.
 *
 * `ageRows` is 0 below `lg`, where the columns stack and there is nothing
 * to line up with.
 */
function useAlignedRows(
  refs: {
    leftColumn: RefObject<HTMLDivElement | null>
    rightColumn: RefObject<HTMLDivElement | null>
    breakdownStart: RefObject<HTMLDivElement | null>
    ageStart: RefObject<HTMLDivElement | null>
  },
  ageRows: number,
  mounted: string,
): Alignment | null {
  const [alignment, setAlignment] = useState<Alignment | null>(null)
  const { leftColumn, rightColumn, breakdownStart, ageStart } = refs

  useLayoutEffect(() => {
    const left = leftColumn.current
    const right = rightColumn.current
    if (ageRows === 0 || !left || !right) return

    function measure() {
      const breakdownTop = breakdownStart.current?.getBoundingClientRect().top
      const ageTop = ageStart.current?.getBoundingClientRect().top
      const rowHeight = ageStart.current?.parentElement?.querySelector('li')?.getBoundingClientRect().height
      if (breakdownTop == null || ageTop == null || !rowHeight) {
        setAlignment(null)
        return
      }

      // How far past a whole number of rows the age list starts, measured
      // from the breakdown's first row; then whichever nudge is smaller.
      const past = (((ageTop - breakdownTop) % rowHeight) + rowHeight) % rowHeight
      const breakdownOffset = past <= rowHeight / 2 ? past : 0
      const ageOffset = past <= rowHeight / 2 ? 0 : rowHeight - past
      const ageBottom = ageTop + ageOffset + ageRows * rowHeight
      const rows = Math.max(Math.round((ageBottom - breakdownTop - breakdownOffset) / rowHeight), 1)

      setAlignment((current) =>
        current &&
        current.rows === rows &&
        Math.abs(current.breakdownOffset - breakdownOffset) < 0.5 &&
        Math.abs(current.ageOffset - ageOffset) < 0.5
          ? current
          : { breakdownOffset, ageOffset, rows },
      )
    }

    measure()
    // Either column changing size (a font arriving, the window narrowing
    // and text wrapping) can move where the lists start.
    const observer = new ResizeObserver(measure)
    observer.observe(left)
    observer.observe(right)
    return () => observer.disconnect()
  }, [leftColumn, rightColumn, breakdownStart, ageStart, ageRows, mounted])

  // Left over from the last time the columns sat side by side, and of no
  // use now that they stack.
  return ageRows === 0 ? null : alignment
}

function Figure({ label, value, tooltip }: { label: string; value: ReactNode; tooltip?: string }) {
  return (
    <div className="flex flex-col gap-1" data-tooltip={tooltip}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight text-ink tabular-nums">{value}</dd>
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-3 text-xs text-ink-faint">{children}</p>
}
