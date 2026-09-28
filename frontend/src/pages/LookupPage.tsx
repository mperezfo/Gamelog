import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { PencilIcon, PlusIcon, TrashIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { PageContainer } from '../components/PageContainer'
import { PlatformBadge } from '../components/PlatformBadge'
import { useFilterParams } from '../hooks/useFilterParams'
import { useGames } from '../hooks/useGames'
import { useCreateLookup, useDeleteLookup, useLookups, useUpdateLookup } from '../hooks/useLookups'
import type { Game } from '../types/game'
import type { Lookup, LookupKind } from '../types/lookup'

/** A default so a new platform doesn't start colorless. */
const DEFAULT_COLOR = '#787774'

/** GamesPage's filter param for each kind — singular, unlike the kind itself. */
const FILTER_PARAM: Record<LookupKind, string> = {
  genres: 'genre',
  developers: 'developer',
  publishers: 'publisher',
  platforms: 'platform',
}

type SortMode = 'count' | 'name'

interface LookupPageProps {
  kind: LookupKind
  title: string
}

/** The ids a game carries for one kind — a platform is a single id, the
 * other three are lists — normalised to an array so both shapes can be
 * counted the same way. */
function idsOf(kind: LookupKind, game: Game): number[] {
  switch (kind) {
    case 'genres':
      return (game.genres ?? []).map((g) => g.id)
    case 'developers':
      return (game.developers ?? []).map((d) => d.id)
    case 'publishers':
      return (game.publishers ?? []).map((p) => p.id)
    case 'platforms':
      return game.platform_id != null ? [game.platform_id] : []
  }
}

/**
 * The table page shared by genres, developers, publishers and platforms: they
 * are the same id/name/icon shape, so one page parametrised by `kind` covers
 * all four rather than four near-identical files.
 */
export function LookupPage({ kind, title }: LookupPageProps) {
  const list = useLookups(kind)
  const games = useGames()
  const [editing, setEditing] = useState<Lookup | 'new' | null>(null)
  // Kept in the URL, same as GamesPage's own sort — a link built or bookmarked
  // with one of these open reproduces the same order, and each of the four
  // routes this page serves (genres, developers, publishers, platforms) gets
  // its own independent `?sort=` since they're separate paths.
  //
  // An explicit click always writes its mode out in full — `?sort=count`
  // included — rather than treating "count" as the unwritten default the
  // way most filters here do. Only the truly unvisited state (no `sort` at
  // all) falls back to count; once a link carries `?sort=count`, it keeps
  // meaning count even if a future change picks a different default.
  const [filters, setFilter] = useFilterParams({ sort: '' })
  const sortMode: SortMode = filters.sort === 'name' ? 'name' : 'count'
  const setSortMode = (mode: SortMode) => setFilter('sort', mode)

  // How many of the signed-in account's own games carry each entry. Both the
  // list and the games it is tallied against are already this account's own
  // (see the backend's LookupRepository).
  const counts = useMemo(() => {
    const tally = new Map<number, number>()
    for (const game of games.data ?? []) {
      for (const id of idsOf(kind, game)) {
        tally.set(id, (tally.get(id) ?? 0) + 1)
      }
    }
    return tally
  }, [games.data, kind])

  const sorted = useMemo(() => {
    const items = [...(list.data ?? [])]
    if (sortMode === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      items.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name))
    }
    return items
  }, [list.data, sortMode, counts])

  return (
    <PageContainer>
      <div className="mb-5 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-ink-faint select-none">Sort by</span>
            <div className="flex h-8 items-center rounded-control bg-sunken">
              <button
                type="button"
                onClick={() => setSortMode('count')}
                aria-pressed={sortMode === 'count'}
                title="Sort by number of games"
                className={[
                  'h-full rounded-control px-2.5 text-xs font-medium transition-colors duration-75',
                  sortMode === 'count' ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_15_15/0.08)]' : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                Count
              </button>
              <button
                type="button"
                onClick={() => setSortMode('name')}
                aria-pressed={sortMode === 'name'}
                title="Sort alphabetically"
                className={[
                  'h-full rounded-control px-2.5 text-xs font-medium transition-colors duration-75',
                  sortMode === 'name' ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_15_15/0.08)]' : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                Name
              </button>
            </div>
          </div>
          <Button variant="primary" onClick={() => setEditing('new')}>
            <PlusIcon className="size-4" />
            New
          </Button>
        </div>
      </div>

      {list.isError && <Notice tone="error">{errorMessage(list.error)}</Notice>}
      {list.isPending && <p className="text-[13px] text-ink-faint">Loading…</p>}

      {editing === 'new' && (
        <div className="mb-4 rounded-control border border-line bg-sunken p-4">
          <LookupForm kind={kind} onDone={() => setEditing(null)} />
        </div>
      )}

      {list.data && (
        <ul className="flex flex-col">
          {list.data.length === 0 && !list.isPending && (
            <p className="py-6 text-[13px] text-ink-faint">Nothing here yet.</p>
          )}
          {sorted.map((item) =>
            editing !== 'new' && editing?.id === item.id ? (
              <li key={item.id} className="border-b border-line py-3 last:border-0">
                <LookupForm kind={kind} item={item} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <LookupRow key={item.id} kind={kind} item={item} count={counts.get(item.id) ?? 0} onEdit={() => setEditing(item)} />
            ),
          )}
        </ul>
      )}
    </PageContainer>
  )
}

function LookupRow({
  kind,
  item,
  count,
  onEdit,
}: {
  kind: LookupKind
  item: Lookup
  count: number
  onEdit: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteLookup(kind)

  return (
    <li className="group border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          {kind === 'platforms' ? (
            <PlatformBadge platform={item} />
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              <span className="truncate">{item.name}</span>
            </span>
          )}
          {count > 0 ? (
            <Link
              to={`/games?${FILTER_PARAM[kind]}=${encodeURIComponent(item.slug)}`}
              className="shrink-0 text-xs text-ink-faint underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink-faint"
            >
              {count}
            </Link>
          ) : (
            <span className="shrink-0 text-xs text-ink-faint">{count}</span>
          )}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button variant="ghost" className="px-2" title="Rename" aria-label={`Rename ${item.name}`} onClick={onEdit}>
            <PencilIcon />
          </Button>
          <Button
            variant="danger"
            className="px-2"
            title="Delete"
            aria-label={`Delete ${item.name}`}
            onClick={() => setConfirming(true)}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 pb-3 sm:max-w-[420px]">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Deleting <span className="font-medium text-ink">{item.name}</span> is refused while any
            game still uses it.
          </p>
          {remove.isError && <Notice tone="error">{errorMessage(remove.error)}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="border border-danger/30"
              disabled={remove.isPending}
              onClick={() => remove.mutate(item.id, { onSuccess: () => setConfirming(false) })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function LookupForm({
  kind,
  item,
  onDone,
}: {
  kind: LookupKind
  item?: Lookup
  onDone: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [icon, setIcon] = useState(item?.icon ?? '')
  const [color, setColor] = useState(item?.color ?? DEFAULT_COLOR)

  const create = useCreateLookup(kind)
  const update = useUpdateLookup(kind)
  const saving = create.isPending || update.isPending
  const error = create.error ?? update.error

  function submit(event: FormEvent) {
    event.preventDefault()
    const input = { name, icon: icon || null, color: kind === 'platforms' ? color : null }

    if (item) {
      update.mutate({ id: item.id, input }, { onSuccess: onDone })
    } else {
      create.mutate(input, { onSuccess: onDone })
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:max-w-[360px]">
      <div className="flex gap-3">
        <Field
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
          className="flex-1"
        />
        {kind === 'platforms' ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-muted">Color</label>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-11 cursor-pointer rounded-control border border-line-strong bg-sunken p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </div>
        ) : (
          <Field
            label="Icon"
            placeholder="🗺️"
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            className="w-16"
          />
        )}
      </div>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : item ? 'Save' : 'Create'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}
