import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { igdbPage } from '../api/metadata'
import { Button } from '../components/Button'
import { ColorField } from '../components/ColorField'
import { CountryField } from '../components/CountryField'
import { CountryFlag } from '../components/CountryFlag'
import { Emoji } from '../components/Emoji'
import { EmojiField } from '../components/EmojiField'
import { Field } from '../components/Field'
import { HighlightMatch } from '../components/HighlightMatch'
import { IgdbLink } from '../components/IgdbLink'
import { ExternalLinkIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { PageContainer } from '../components/PageContainer'
import { PlatformBadge } from '../components/PlatformBadge'
import { Popover } from '../components/Popover'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useFilterParams } from '../hooks/useFilterParams'
import { useGames } from '../hooks/useGames'
import { useIgdbNames, useMetadataCapabilities } from '../hooks/useMetadata'
import { useCreateLookup, useDeleteLookup, useLookups, useUpdateLookup } from '../hooks/useLookups'
import { useUnsavedChanges } from '../hooks/unsavedChanges'
import { useOffline } from '../hooks/useOffline'
import { useReloadScroll } from '../hooks/useReloadScroll'
import { fuzzyMatch } from '../lib/fuzzy'
import type { Game } from '../types/game'
import { LOOKUP_FILTER_PARAM, MAX_LOOKUP_NAME, type Lookup, type LookupKind } from '../types/lookup'

/** The IGDB records a developer, publisher or platform is linked to, and
 * what kind they are. Genres have none. */
function igdbLinksOf(kind: LookupKind, item: Lookup): { kind: IgdbLinkKind; ids: number[] } {
  if (kind === 'platforms') return { kind: 'platforms', ids: item.igdb_platform_ids ?? [] }
  if (kind === 'genres') return { kind: 'companies', ids: [] }
  return { kind: 'companies', ids: item.igdb_company_ids ?? [] }
}

type IgdbLinkKind = 'companies' | 'platforms'

/** One IGDB record of a kind, for the copy around the links. */
const IGDB_NOUN: Record<IgdbLinkKind, { one: string; many: string }> = {
  companies: { one: 'company', many: 'companies' },
  platforms: { one: 'platform', many: 'platforms' },
}

/** Developers and publishers have a country, where the other two have an
 * icon. */
function hasCountry(kind: LookupKind): boolean {
  return kind === 'developers' || kind === 'publishers'
}

/** A default so a new platform doesn't start colorless. */
const DEFAULT_COLOR = '#787774'

type SortMode = 'count' | 'name'

/**
 * The IGDB link of a row in the list. A record linked to a single IGDB
 * record opens its page straight away; one standing for several (Nintendo
 * and its EPD groups, say, or a "VR" platform) asks which, in a small menu
 * naming them as IGDB does, since the library keeps nothing but their ids.
 */
function IgdbLinks({ kind, ids }: { kind: IgdbLinkKind; ids: number[] }) {
  const capabilities = useMetadataCapabilities()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const named = useIgdbNames(kind, ids, open)

  if (ids.length === 1 || !capabilities.data?.identify) {
    return <IgdbLink kind={kind} id={ids[0]} className="shrink-0 text-ink-faint" />
  }

  // Named as IGDB does once the names are in; by id until then, or if IGDB
  // cannot be reached.
  const names = new Map((named.data ?? []).map((record) => [record.id, record.name]))

  return (
    <span className="inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-tooltip={`Linked to ${ids.length} IGDB ${IGDB_NOUN[kind].many}`}
        aria-label={`Linked to ${ids.length} IGDB ${IGDB_NOUN[kind].many}`}
        aria-expanded={open}
        className="inline-flex text-ink-faint transition-colors duration-75 hover:text-ink"
      >
        <ExternalLinkIcon className="size-3" />
      </button>
      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        aria-label={`IGDB ${IGDB_NOUN[kind].many}`}
        className="flex w-max max-w-[min(20rem,70vw)] flex-col p-1"
      >
        {ids.map((id) => (
          <a
            key={id}
            href={igdbPage(kind, id)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 text-sm text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink"
          >
            <span className="truncate">
              {names.get(id) ?? `${IGDB_NOUN[kind].one} ${id}`}
            </span>
            <ExternalLinkIcon className="size-3 shrink-0 text-ink-faint" />
          </a>
        ))}
      </Popover>
    </span>
  )
}

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
  useDocumentTitle(title)
  const list = useLookups(kind)
  const games = useGames()
  const offline = useOffline()
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
  const [filters, setFilter] = useFilterParams({ sort: '', q: '' })
  const sortMode: SortMode = filters.sort === 'name' ? 'name' : 'count'
  const setSortMode = (mode: SortMode) => setFilter('sort', mode)

  // Local and written back debounced, for the reason GamesPage gives for
  // its own search box; `q` only seeds it, so a reload keeps the search.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 150)

  useEffect(() => {
    setFilter('q', debouncedSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

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

  // What the search matched in each name, to draw it bold. While there is a
  // search the list is ranked by how well each name matches it (the name
  // starting with it first, see fuzzyMatch), and the chosen sort only breaks
  // ties: otherwise a weak match with more games would come before the
  // obvious one. The row being edited stays whatever is typed, so a search
  // never takes a form out from under its changes.
  const shown = useMemo(() => {
    const out: { item: Lookup; indices: number[]; score: number }[] = []
    for (const item of sorted) {
      const match = fuzzyMatch(debouncedSearch, item.name)
      if (match) out.push({ item, indices: match.indices, score: match.score })
      else if (editing !== 'new' && editing?.id === item.id) out.push({ item, indices: [], score: -Infinity })
    }
    // A stable sort: equal scores keep the sorted order.
    if (debouncedSearch.trim()) out.sort((a, b) => b.score - a.score)
    return out
  }, [sorted, debouncedSearch, editing])

  // The page scrolls the shell's own `main` (see AppShell), found from
  // inside it. The order of the list depends on the games as well, when it
  // is by count.
  const pageRef = useRef<HTMLHeadingElement>(null)
  useReloadScroll(() => pageRef.current?.closest('main'), list.data != null && games.data != null)

  return (
    <PageContainer>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 ref={pageRef} className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-ink-faint select-none">Sort by</span>
            <div className="flex h-8 items-center rounded-control bg-sunken">
              <button
                type="button"
                onClick={() => setSortMode('count')}
                aria-pressed={sortMode === 'count'}
                data-tooltip="Sort by number of games"
                className={[
                  'h-full rounded-control px-2.5 text-xs font-medium transition-colors duration-75',
                  sortMode === 'count' ? 'bg-surface text-ink shadow-thumb' : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                Count
              </button>
              <button
                type="button"
                onClick={() => setSortMode('name')}
                aria-pressed={sortMode === 'name'}
                data-tooltip="Sort alphabetically"
                className={[
                  'h-full rounded-control px-2.5 text-xs font-medium transition-colors duration-75',
                  sortMode === 'name' ? 'bg-surface text-ink shadow-thumb' : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                Name
              </button>
            </div>
          </div>
          <Button variant="primary" onClick={() => setEditing('new')} disabled={offline}>
            <PlusIcon className="size-4" />
            New
          </Button>
        </div>
      </div>

      {/* Kept in reach at the top of a long list as it scrolls. */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 bg-canvas px-4 py-2">
        <div className="relative sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Field
            label=""
            aria-label={`Search ${title.toLowerCase()}`}
            autoComplete="off"
            spellCheck={false}
            placeholder={`Search ${title.toLowerCase()}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`pl-7 ${search ? 'pr-9' : ''}`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {list.isError && !offline && <Notice tone="error">{errorMessage(list.error)}</Notice>}
      {list.isPending && <p className="text-[13px] text-ink-faint">Loading…</p>}

      {editing === 'new' && (
        <div className="mb-4 rounded-control border border-line bg-raised p-4">
          <LookupForm kind={kind} onDone={() => setEditing(null)} />
        </div>
      )}

      {list.data && (
        <ul className="flex flex-col">
          {list.data.length === 0 && !list.isPending && (
            <p className="py-6 text-[13px] text-ink-faint">Nothing here yet.</p>
          )}
          {list.data.length > 0 && shown.length === 0 && (
            <p className="py-6 text-[13px] text-ink-faint">
              No {title.toLowerCase()} match “{debouncedSearch.trim()}”.
            </p>
          )}
          {shown.map(({ item, indices }) =>
            editing !== 'new' && editing?.id === item.id ? (
              <li key={item.id} className="border-b border-line py-3 last:border-0">
                <LookupForm kind={kind} item={item} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <LookupRow
                key={item.id}
                kind={kind}
                item={item}
                highlight={indices}
                count={counts.get(item.id) ?? 0}
                onEdit={() => setEditing(item)}
              />
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
  highlight,
  count,
  onEdit,
}: {
  kind: LookupKind
  item: Lookup
  /** Characters of the name the search matched. */
  highlight: number[]
  count: number
  onEdit: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteLookup(kind)
  const offline = useOffline()
  const links = igdbLinksOf(kind, item)

  return (
    <li className="group border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-3 py-2.5">
        {/* On the baseline, so that the count and the IGDB mark, smaller
            than the name, line up with its letters rather than its box. A
            platform's badge is a box of its own, centred instead. */}
        <span className={['flex min-w-0 gap-2', kind === 'platforms' ? 'items-center' : 'items-baseline'].join(' ')}>
          {kind === 'platforms' ? (
            <span className="flex min-w-0 items-center gap-1">
              <PlatformBadge platform={item} highlight={highlight} />
              {links.ids.length > 0 && <IgdbLinks kind={links.kind} ids={links.ids} />}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              {item.icon && <span aria-hidden="true"><Emoji value={item.icon} /></span>}
              {item.country && <CountryFlag code={item.country} />}
              {/* The link to IGDB hangs off the name itself, the way an
                  external link is usually marked, rather than trailing the
                  count. */}
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate">
                  <HighlightMatch text={item.name} indices={highlight} />
                </span>
                {links.ids.length > 0 && <IgdbLinks kind={links.kind} ids={links.ids} />}
              </span>
            </span>
          )}
          {count > 0 ? (
            <Link
              to={`/games?${LOOKUP_FILTER_PARAM[kind]}=${encodeURIComponent(item.slug)}`}
              className="shrink-0 text-xs text-ink-faint underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink-faint"
            >
              {count}
            </Link>
          ) : (
            <span className="shrink-0 text-xs text-ink-faint">{count}</span>
          )}
        </span>

        <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button variant="ghost" className="px-2" data-tooltip="Rename" aria-label={`Rename ${item.name}`} onClick={onEdit} disabled={offline}>
            <PencilIcon />
          </Button>
          <Button
            variant="danger"
            className="px-2"
            data-tooltip="Delete"
            aria-label={`Delete ${item.name}`}
            onClick={() => setConfirming(true)}
            disabled={offline}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 pb-3 sm:max-w-[420px]">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Deleting <span className="font-medium text-ink"><Emoji value={item.name} /></span> is refused while any
            game still uses it.
          </p>
          {remove.isError && <Notice tone="error">{errorMessage(remove.error)}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="danger"
              className="border border-danger/30"
              disabled={remove.isPending || offline}
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
  const [country, setCountry] = useState(item?.country ?? '')
  const [color, setColor] = useState(item?.color ?? DEFAULT_COLOR)
  const links = item ? igdbLinksOf(kind, item) : { kind: 'companies' as const, ids: [] }
  // IGDB links to forget on Save, struck through until then.
  const [unlinking, setUnlinking] = useState<number[]>([])

  // A form opened and left as it was is as disposable as no form at all.
  useUnsavedChanges(
    name !== (item?.name ?? '') ||
      icon !== (item?.icon ?? '') ||
      country !== (item?.country ?? '') ||
      color !== (item?.color ?? DEFAULT_COLOR) ||
      unlinking.length > 0,
  )

  const create = useCreateLookup(kind)
  const update = useUpdateLookup(kind)
  const saving = create.isPending || update.isPending
  const error = create.error ?? update.error
  const offline = useOffline()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const input = hasCountry(kind)
      ? { name: name.trim(), country: country || null }
      : { name: name.trim(), icon: icon.trim() || null, color: kind === 'platforms' ? color : null }

    if (item) {
      update.mutate({ id: item.id, input, unlink: unlinking }, { onSuccess: onDone })
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
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
          maxLength={MAX_LOOKUP_NAME}
          className="flex-1"
        />
        {kind === 'platforms' ? (
          <ColorField label="Color" value={color} onChange={setColor} />
        ) : hasCountry(kind) ? (
          <CountryField label="Country" value={country} onChange={setCountry} />
        ) : (
          <EmojiField label="Icon" value={icon} onChange={setIcon} />
        )}
      </div>
      {item && kind !== 'genres' && (
        // A link is made, or moved, from a game's Identify: here it can only
        // be dropped, on Save like the rest of the form.
        //
        // Inline rather than a flex row, so that the ids read as part of the
        // sentence. Each id is a small pill, like the filter pills on Games,
        // so that its × plainly belongs to it.
        <p className="text-xs leading-relaxed text-ink-faint">
          {links.ids.length > 0 ? (
            <>
              Linked to IGDB as {links.ids.length === 1 ? IGDB_NOUN[links.kind].one : IGDB_NOUN[links.kind].many}
              {links.ids.map((id) => {
                const dropped = unlinking.includes(id)
                return (
                  <Fragment key={id}>
                    {' '}
                    <span className="inline-flex h-[18px] items-center rounded-control bg-sunken pr-px pl-1 leading-[14px]">
                      {dropped ? (
                        <s className="tabular-nums decoration-ink-faint">{id}</s>
                      ) : (
                        <IgdbLink kind={links.kind} id={id} className="text-ink-muted tabular-nums [&_svg]:-translate-y-px">
                          {id}
                        </IgdbLink>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setUnlinking((current) => (dropped ? current.filter((x) => x !== id) : [...current, id]))
                        }
                        data-tooltip={dropped ? 'Keep this link' : 'Unlink when saved'}
                        aria-label={dropped ? `Keep the link to ${id}` : `Unlink from ${id}`}
                        className={`flex h-3.5 items-center justify-center rounded-full transition-colors duration-75 hover:bg-hover hover:text-ink ${dropped ? 'px-1' : 'w-3.5'}`}
                      >
                        {dropped ? 'Undo' : <XIcon className="size-2.5" />}
                      </button>
                    </span>
                  </Fragment>
                )
              })}
            </>
          ) : (
            'Not linked to IGDB'
          )}
        </p>
      )}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={saving || offline || !name.trim()}>
          {saving ? 'Saving…' : item ? 'Save' : 'Create'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}
