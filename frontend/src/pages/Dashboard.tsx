import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { errorMessage } from '../api/client'
import { Button } from '../components/Button'
import { GameCard } from '../components/GameCard'
import { GameCoverCard } from '../components/GameCoverCard'
import { Gallery } from '../components/Gallery'
import { PlusIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { GameCalendar } from '../components/GameCalendar'
import { UpcomingRelease } from '../components/UpcomingRelease'
import { useEdgeFade } from '../hooks/useEdgeFade'
import { useGameModal } from '../hooks/useGameModal'
import { useGames, useUpdateGame } from '../hooks/useGames'
import { compareForBoard, sameDateGroup } from '../lib/gameSort'
import { GAME_STATUSES, STATUS_DOT, STATUS_LABELS, type Game, type GameStatus } from '../types/game'

const TOP_RATED_COUNT = 10

/**
 * Where most of the time on this application goes: the whole library at a
 * glance, and the fastest path to editing any one game in it.
 */
export function Dashboard() {
  const games = useGames()
  const updateGame = useUpdateGame()

  const modal = useGameModal()
  const [activeGame, setActiveGame] = useState<Game | undefined>(undefined)
  // Which column to highlight as the drop target. Tracked separately from
  // dnd-kit's own per-column isOver (which only lights up when the pointer
  // is over the column's own empty space, not over one of its cards) so the
  // whole column reads as the target regardless of where in it the pointer
  // is. This never touches a SortableContext's items, just a status value,
  // so — unlike an earlier attempt at a live reordering preview — it cannot
  // fight dnd-kit's own internal transform bookkeeping.
  const [hoveredColumn, setHoveredColumn] = useState<GameStatus | null>(null)

  /** Where a same-column reorder would land, for the blue line drawn between
   * cards during a drag — `beforeId: null` means "at the end of the
   * column". Only ever set while hovering a valid reorder target (same
   * column, same tie group as the dragged card, see sameDateGroup); a drag
   * that would just change status, or that crosses into a different date
   * tie group, clears it instead; the whole column is already highlighted
   * for those via `hoveredColumn`. */
  const [dropIndicator, setDropIndicator] = useState<{ status: GameStatus; beforeId: number | null } | null>(null)

  // The library board is only capped to the calendar's height from `xl` up,
  // where the two sit side by side (see the comment further down) — below
  // that they stack, and each keeps its own natural height instead.
  //
  // This is measured and applied in plain pixels rather than through CSS
  // alone (`items-stretch` etc.) on purpose: stretching only ever grows a
  // shorter flex item up to match a taller one, it never shrinks the taller
  // one down — and CSS Grid's own row tracks size to a row's tallest item's
  // *content* height by default regardless, so nothing about this layout
  // naturally caps the four board columns to the calendar's height without
  // a real, resolved pixel number.
  const rowRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const [calendarHeight, setCalendarHeight] = useState<number | null>(null)
  // Distance from the top of the row to the top of the column grid — i.e.
  // the height the "Library" heading itself takes up, which each column's
  // available height has to be reduced by.
  const [headerOffset, setHeaderOffset] = useState(0)
  const [isWideLayout, setIsWideLayout] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)')
    const update = () => setIsWideLayout(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    // Refs are still null on the very first render: the whole board is
    // behind `!games.isPending` (see below), so there is nothing to measure
    // until that flips and the elements actually mount.
    const calendarEl = calendarRef.current
    if (!calendarEl) return

    function measure() {
      setCalendarHeight(calendarEl!.getBoundingClientRect().height)
      if (rowRef.current && gridRef.current) {
        setHeaderOffset(gridRef.current.getBoundingClientRect().top - rowRef.current.getBoundingClientRect().top)
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(calendarEl)
    if (gridRef.current) observer.observe(gridRef.current)
    return () => observer.disconnect()
  }, [games.isPending])

  const boardColumnHeight =
    isWideLayout && calendarHeight != null ? Math.max(calendarHeight - headerOffset, 0) : undefined

  // Drag-and-drop fights the browser's own touch scrolling on a coarse
  // (touch) pointer — the board ends up either impossible to scroll or
  // dragging cards by accident. Rather than tune activation constraints
  // around that, it is simplest to just not offer dragging at all when
  // there is no fine pointer to use it with.
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setIsTouchDevice(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // A small activation distance so a plain click still opens the panel: only
  // a real drag (pointer actually moving) starts one.
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  // Omitted entirely on touch devices — see `isTouchDevice` above.
  const sensors = useSensors(isTouchDevice ? undefined : pointerSensor)

  const all = useMemo(() => games.data ?? [], [games.data])

  const topRated = useMemo(
    () =>
      all
        .filter((g) => g.score != null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, TOP_RATED_COUNT),
    [all],
  )

  const bestPerGenre = useMemo(() => {
    const best = new Map<number, { name: string; game: Game }>()
    for (const game of all) {
      if (game.score == null) continue
      for (const genre of game.genres ?? []) {
        const current = best.get(genre.id)
        if (!current || (game.score ?? 0) > (current.game.score ?? 0)) {
          best.set(genre.id, { name: genre.name, game })
        }
      }
    }
    return Array.from(best.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [all])

  const byStatus = useMemo(() => {
    const groups: Record<GameStatus, Game[]> = { wishlist: [], pending: [], playing: [], played: [] }
    for (const game of all) groups[game.status].push(game)
    for (const status of GAME_STATUSES) groups[status].sort(compareForBoard)
    return groups
  }, [all])

  /** Which column an id (a card's, or a column's own drop-target id) belongs
   * to. */
  function containerOf(id: number | string): GameStatus | undefined {
    if (typeof id === 'string' && id.startsWith('column-')) {
      return id.slice('column-'.length) as GameStatus
    }
    return GAME_STATUSES.find((status) => byStatus[status].some((g) => g.id === id))
  }

  function saveGame(game: Game, changes: Partial<Pick<Game, 'status' | 'position'>>) {
    updateGame.mutate({
      id: game.id,
      input: {
        title: game.title,
        status: changes.status ?? game.status,
        position: changes.position ?? game.position,
        score: game.score,
        tagline: game.tagline,
        notes: game.notes,
        cover_image_url: game.cover_image_url,
        release_date: game.release_date,
        logged_date: game.logged_date,
        platform_id: game.platform_id,
        genre_ids: (game.genres ?? []).map((g) => g.id),
        developer_ids: (game.developers ?? []).map((d) => d.id),
        publisher_ids: (game.publishers ?? []).map((p) => p.id),
      },
    })
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveGame(all.find((g) => g.id === event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    const next = event.over ? (containerOf(event.over.id) ?? null) : null
    setHoveredColumn((current) => (current === next ? current : next))
  }

  /** The pointer's live vertical position, derived from where the drag
   * started (`activatorEvent`, a PointerEvent — the only sensor in use is
   * PointerSensor) plus how far it has moved since (`delta`).
   *
   * Used instead of the dragged card's own rect for above/below math: that
   * rect's height is the dragged card's — full cover art and all when it has
   * one — so comparing it against a target's midpoint made the threshold
   * swing with whichever card happened to be dragged, and made landing at
   * the very top of a column (where there is no card above to grab the
   * midpoint from) unreliable specifically for image cards. The pointer
   * itself has no height to distort the comparison. */
  function pointerY(event: DragMoveEvent | DragEndEvent): number | null {
    const activator = event.activatorEvent
    if (!(activator instanceof PointerEvent)) return null
    return activator.clientY + event.delta.y
  }

  /** Where a drop right now would insert `dragged` — the single source of
   * truth for both the live blue-line preview (handleDragMove) and the
   * actual commit (handleDragEnd). Deliberately not restricted to the
   * dragged card's own column: dragging straight into another column and
   * landing at a precise spot in one motion is the whole point — a second
   * drag, just to reorder within the column it just arrived in, is exactly
   * what this avoids.
   *
   * Taking `pointer` as a parameter rather than reading it off `active`
   * itself is what lets handleDragEnd reuse this: recomputing fresh from
   * the drop event's own final position, instead of trusting whatever the
   * last onDragMove call happened to leave in state, is what keeps a drop
   * accurate even on the rare pointer sequence that jumps straight to its
   * final position without a move event in between. */
  function resolveDropIndicator(
    dragged: Game,
    over: { id: number | string; rect: { top: number; height: number } } | null | undefined,
    pointer: number | null,
  ): { status: GameStatus; beforeId: number | null } | null {
    if (!over) return null

    const status = containerOf(over.id)
    if (!status) return null

    const target = all.find((g) => g.id === over.id)
    const column = byStatus[status]

    if (target && target.id === dragged.id) {
      // Hovering dragged's own placeholder: `SortableGameCard` keeps it in
      // the layout (just invisible) while dragging rather than removing it,
      // so dragging back over its own original spot collides with itself,
      // not a neighboring card. Treating that as "hovering empty space"
      // (below) would always resolve to "drop at the end" — landing there
      // should instead put it right back where it already is, before
      // whatever card originally followed it.
      const draggedIndex = column.findIndex((g) => g.id === dragged.id)
      const nextGame = column[draggedIndex + 1]
      return nextGame ? { status, beforeId: nextGame.id } : { status, beforeId: null }
    }

    if (!target) {
      // Hovering the column's own empty space rather than a card. Only
      // worth a "drop at the end" cue if dragged's tie group actually has
      // members here to land after — otherwise there is no reorder to
      // preview, just a plain status change once dropped.
      const hasGroupHere = column.some((g) => g.id !== dragged.id && sameDateGroup(g, dragged))
      return hasGroupHere ? { status, beforeId: null } : null
    }

    // Reordering only ever breaks a tie: a target already sitting on a
    // different logged date stays there no matter where the pointer lands.
    if (!sameDateGroup(dragged, target)) return null
    if (pointer == null) return null

    const targetIndex = column.findIndex((g) => g.id === target.id)
    const pointerIsAboveTarget = pointer < over.rect.top + over.rect.height / 2
    const beforeId = pointerIsAboveTarget ? target.id : (column[targetIndex + 1]?.id ?? null)
    return { status, beforeId }
  }

  /** Recomputes the drop-line preview on every pointer move, not just when
   * `over` changes (onDragOver) — the target card stays the same as the
   * pointer crosses its own vertical midpoint, but which side of it the
   * card would land on flips, and that has to track the pointer live. */
  function handleDragMove(event: DragMoveEvent) {
    const dragged = all.find((g) => g.id === event.active.id)
    setDropIndicator(dragged ? resolveDropIndicator(dragged, event.over, pointerY(event)) : null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveGame(undefined)
    setHoveredColumn(null)
    setDropIndicator(null)

    const { active, over } = event
    if (!over) return

    const dragged = all.find((g) => g.id === active.id)
    if (!dragged) return

    const destStatus = containerOf(over.id)
    if (!destStatus) return

    // Recomputed fresh from this event's own position rather than read back
    // from state — see resolveDropIndicator's doc comment.
    const indicator = resolveDropIndicator(dragged, over, pointerY(event))

    // No usable reorder cue for this drop (a different tie group, or an
    // empty column with no matching group to land among) — status is the
    // only thing decided here; position settles on its own via the date
    // sort, same as dropping anywhere in a column normally would.
    if (!indicator || indicator.status !== destStatus) {
      if (destStatus !== dragged.status) saveGame(dragged, { status: destStatus })
      return
    }

    // The destination tie group with dragged inserted exactly where the
    // drop-line indicator showed it landing — the same computation whether
    // dragged already belonged here (an ordinary same-column reorder) or is
    // arriving fresh from another column, which is what lets one drag both
    // change status and land in the right spot at once.
    const group = byStatus[destStatus].filter((g) => g.id !== dragged.id && sameDateGroup(g, dragged))
    const insertAt = indicator.beforeId == null ? group.length : group.findIndex((g) => g.id === indicator.beforeId)
    const ordered = [...group.slice(0, insertAt), dragged, ...group.slice(insertAt)]

    // A bulk import (or anything else that leaves every game in a group on
    // the same position, most commonly 0) breaks the plain midpoint move
    // below: averaging two equal neighbors' positions reproduces the same
    // value, so the drag silently fails to change anything. Detecting that
    // and renumbering the whole group to plain 0..n-1 — the order this very
    // drag just produced — fixes it in one pass and, since every position
    // in the group is then distinct, keeps future drags in it cheap again.
    const hasCollision = new Set(ordered.map((g) => g.position)).size !== ordered.length
    if (hasCollision) {
      ordered.forEach((g, index) => {
        if (g.id === dragged.id) saveGame(g, { status: destStatus, position: index })
        else if (g.position !== index) saveGame(g, { position: index })
      })
      return
    }

    const droppedAt = ordered.findIndex((g) => g.id === dragged.id)
    const prev = ordered[droppedAt - 1]
    const next = ordered[droppedAt + 1]
    const position =
      prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1 : next ? next.position - 1 : 0

    saveGame(dragged, { status: destStatus, position })
  }

  return (
    <div className="flex flex-col gap-8 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Dashboard</h1>
        <Button variant="primary" onClick={modal.openNew}>
          <PlusIcon className="size-4" />
          New game
        </Button>
      </div>

      {games.isError && <Notice tone="error">{errorMessage(games.error)}</Notice>}

      {!games.isPending && (
        <>
          <Section title="Coming up">
            <UpcomingRelease games={all} onSelectGame={modal.openGame} />
          </Section>

          {/* Side by side from `xl` up, like the Notion board this replaces.
              On a wide screen, extra room past both panels' preferred
              widths (`xl:basis-[...]` below) is split evenly between them —
              both carry a plain `xl:grow`, so the board keeps gaining
              columns' worth of breathing room and the calendar keeps
              gaining cell size together, rather than one soaking up every
              extra pixel while the other sits pinned at its basis.

              Shrinking works differently, and deliberately so:
              library gives up width first, all the way down to
              `xl:min-w-[520px]` (roughly what four legible columns need),
              before the calendar loses anything past its own preferred
              width. Only once library is already pinned at that floor does
              the calendar start shrinking too, down to `xl:min-w-[320px]`
              — enough that its month grid still functions. That ordering
              comes from `xl:basis-[720px] xl:shrink-[3]` on library against
              `xl:basis-[420px] xl:shrink` on the calendar: flexbox assigns
              shrinkage in proportion to basis × shrink-factor, so library's
              much larger share absorbs nearly all of it until it is
              clamped at its floor, at which point the algorithm redirects
              the rest to the calendar, the only item left that can still
              give up space.

              The four status columns are always laid out `lg:grid-cols-4`
              from `lg` up regardless of how much width the flex row above
              actually gives this side — Tailwind's grid-cols utilities key
              off the viewport, not this container — so on a narrow *xl*
              window (the two sit side by side, but there isn't much row
              left after the sidebar) the columns need their own floor
              or they get squeezed arbitrarily thin, to the point titles are
              unreadable; `xl:min-w-[520px]` on the wrapper is that floor.

              From `xl` up each of the four columns is also capped to
              `boardColumnHeight` — the calendar's measured height, minus the
              "Library" heading — so the board reaches all the way down to
              the calendar's bottom edge and scrolls internally instead of
              stopping short (a gap) or growing to fit every pending game (no
              scrolling at all, just a very tall page). See the comment by
              `boardColumnHeight` above for why this has to be a real,
              measured pixel value rather than CSS alignment alone. */}
          <div ref={rowRef} className="flex flex-col gap-8 xl:flex-row xl:items-start">
            <div className="min-w-0 xl:min-w-[520px] xl:basis-[720px] xl:shrink-[3] xl:grow">
              <Section title="Library">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  // dnd-kit's default auto-scroll hunts for the nearest
                  // scrollable ancestor of whatever the pointer is over —
                  // which, mid-drag, is often a column's own internal
                  // scroll area (`BoardColumn`'s `overflow-y-auto`), not
                  // the page. That produced a disorienting, hard-to-predict
                  // scroll jump during ordinary drags that had nothing to
                  // do with reaching a viewport edge. Every column is
                  // already height-capped to fit the calendar (see
                  // `boardColumnHeight`), so nothing here actually needs
                  // auto-scrolling — off.
                  autoScroll={false}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => {
                    setActiveGame(undefined)
                    setHoveredColumn(null)
                    setDropIndicator(null)
                  }}
                >
                  <div ref={gridRef} className="grid grid-cols-1 gap-x-4 gap-y-5 min-[480px]:grid-cols-2 lg:grid-cols-4">
                    {GAME_STATUSES.map((status) => (
                      <div
                        key={status}
                        className="flex min-w-0 flex-col gap-1.5"
                        style={boardColumnHeight != null ? { height: boardColumnHeight } : undefined}
                      >
                        <p className="flex items-center gap-1.5 px-1.5 text-xs font-medium text-ink-faint">
                          <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
                          {STATUS_LABELS[status]} · {byStatus[status].length}
                        </p>
                        <SortableContext
                          items={byStatus[status].map((g) => g.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <BoardColumn status={status} isHovered={hoveredColumn === status}>
                            {byStatus[status].length === 0 ? (
                              <Empty>Nothing here.</Empty>
                            ) : (
                              byStatus[status].map((game) => (
                                <Fragment key={game.id}>
                                  {dropIndicator?.status === status && dropIndicator.beforeId === game.id && (
                                    <DropIndicator />
                                  )}
                                  <SortableGameCard
                                    game={game}
                                    draggable={!isTouchDevice}
                                    compact={status === 'wishlist' || status === 'pending'}
                                    onClick={() => modal.openGame(game)}
                                  />
                                </Fragment>
                              ))
                            )}
                            {dropIndicator?.status === status && dropIndicator.beforeId === null && <DropIndicator />}
                          </BoardColumn>
                        </SortableContext>
                      </div>
                    ))}
                  </div>

                  <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
                    {activeGame && (
                      <div className="w-64 rotate-2 scale-105 opacity-95 shadow-[0_16px_32px_rgba(0,0,0,0.28)]">
                        <GameCard game={activeGame} onClick={() => {}} />
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
              </Section>
            </div>

            <div ref={calendarRef} className="w-full min-w-0 xl:min-w-[320px] xl:basis-[420px] xl:shrink xl:grow">
              <Section title="Calendar">
                <GameCalendar games={all} onSelectGame={modal.openGame} />
              </Section>
            </div>
          </div>

          <Section title="Top rated">
            {topRated.length === 0 ? (
              <Empty>Score a game to see it here.</Empty>
            ) : (
              <Gallery>
                {topRated.map((game) => (
                  <GameCoverCard
                    key={game.id}
                    game={game}
                    onClick={() => modal.openGame(game)}
                    className="w-40 shrink-0"
                  />
                ))}
              </Gallery>
            )}
          </Section>

          <Section title="Best of each genre">
            {bestPerGenre.length === 0 ? (
              <Empty>No scored games with a genre yet.</Empty>
            ) : (
              <Gallery>
                {bestPerGenre.map(({ name, game }) => (
                  <GameCoverCard key={name} game={game} onClick={() => modal.openGame(game)} caption={name} />
                ))}
              </Gallery>
            )}
          </Section>
        </>
      )}

    </div>
  )
}

/** A status column's drop target — its own droppable, so a column with no
 * cards (or space below the last one) still accepts a drag.
 *
 * Highlighting comes from `isHovered` (Dashboard's own dragOver tracking)
 * rather than this hook's own `isOver`: that one only lights up over the
 * column's empty space, not over any of its cards, which left most of a full
 * column dead for the purpose of showing it as the drop target. */
function DropIndicator() {
  return <div aria-hidden="true" className="h-0.5 shrink-0 rounded-full bg-accent" />
}

function BoardColumn({
  status,
  isHovered,
  children,
}: {
  status: GameStatus
  isHovered: boolean
  children: ReactNode
}) {
  const { setNodeRef } = useDroppable({ id: `column-${status}`, data: { status } })
  const fadeRef = useEdgeFade('y')
  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        fadeRef(node)
      }}
      className={[
        'flex max-h-80 flex-col gap-1.5 overflow-y-auto rounded-control p-1 transition-colors duration-150 lg:max-h-[540px] xl:max-h-[720px] xl:min-h-0 xl:flex-1',
        isHovered ? 'bg-hover ring-2 ring-accent/30' : '',
      ].join(' ')}
    >
      {children}
    </div>
  )
}

/** Wraps GameCard with drag-and-drop: the card itself stays purely visual.
 *
 * `draggable` is false on touch devices (see `isTouchDevice` in Dashboard):
 * dragging fights the browser's own touch scrolling there, so cards fall
 * back to being plain, non-draggable list items. `touch-none` is skipped
 * along with the drag handlers themselves — it exists only to keep a touch
 * drag from also scrolling the page, and would otherwise block scrolling
 * the column entirely once dragging itself is gone. */
function SortableGameCard({
  game,
  draggable,
  compact,
  onClick,
}: {
  game: Game
  draggable: boolean
  compact?: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: game.id,
    data: { status: game.status },
    disabled: !draggable,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={[draggable ? 'touch-none' : '', isDragging ? 'opacity-0' : ''].join(' ')}
      {...(draggable ? attributes : undefined)}
      {...(draggable ? listeners : undefined)}
    >
      <GameCard game={game} onClick={onClick} compact={compact} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-3 text-xs text-ink-faint">{children}</p>
}
