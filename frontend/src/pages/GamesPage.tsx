import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'

import { errorMessage } from '../api/client'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { DataTable } from '../components/DataTable'
import { Field } from '../components/Field'
import { FilterBar, type FilterField, type FilterOption } from '../components/FilterBar'
import { GameCoverCard } from '../components/GameCoverCard'
import { GamesStats } from '../components/GamesStats'
import { GenreTag } from '../components/GenreTag'
import { IgdbLink } from '../components/IgdbLink'
import { GridIcon, PlusIcon, SearchIcon, TableIcon, XIcon } from '../components/icons'
import { Notice } from '../components/Notice'
import { Pill } from '../components/Pill'
import { PlatformBadge } from '../components/PlatformBadge'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useGameModal } from '../hooks/useGameModal'
import { useDateFormat, useDefaultGamesView } from '../hooks/useSession'
import { useGames } from '../hooks/useGames'
import { useOffline } from '../hooks/useOffline'
import { useLookups } from '../hooks/useLookups'
import { useReloadScroll } from '../hooks/useReloadScroll'
import { useScrollToTop } from '../hooks/useScrollToTop'
import { STATUS_LABELS, type Game } from '../types/game'
import type { Lookup } from '../types/lookup'
import { dateRange, dateRangeSpan, formatDate, formatScore, yearOf } from '../lib/format'
import { preloadImage } from '../lib/cover'
import { parseRange } from '../lib/range'
import { AGE_UNITS, boundDays, describeAgeRange, inAgeRange } from '../lib/releaseAge'
import { UNKNOWN_COUNTRY, countryName, countryOrUnknown } from '../lib/countries'
import { foldCase, fuzzyMatch } from '../lib/fuzzy'
import { UNRELEASED_IMAGE, UNRELEASED_RING, isUnreleased } from '../lib/upcoming'
import { useFilterParams } from '../hooks/useFilterParams'
import { Emoji } from '../components/Emoji'

const DEFAULT_SORT_FIELD = 'title'

/** Every field a game can be missing, and how to tell it's missing — the
 * options behind the "Missing" filter below. Checked against `games.data`
 * client-side, same as every other GamesPage filter. */
const MISSING_FIELDS: Record<string, { label: string; test: (game: Game) => boolean }> = {
  cover: { label: 'No cover image', test: (g) => !g.cover_image_url },
  // Only games that have a cover count: without one there is nothing to crop,
  // and "No cover image" already covers them.
  portrait_crop: {
    label: 'No portrait crop',
    test: (g) =>
      !!g.cover_image_url && g.cover_focal_x == null && g.cover_focal_y == null && g.cover_zoom == null,
  },
  release_date: { label: 'No release date', test: (g) => !g.release_date },
  score: { label: 'No score', test: (g) => g.score == null },
  tagline: { label: 'No tagline', test: (g) => !g.tagline },
  notes: { label: 'No notes', test: (g) => !g.notes },
  platform: { label: 'No platform', test: (g) => !g.platform },
  genres: { label: 'No genres', test: (g) => !g.genres || g.genres.length === 0 },
  developers: { label: 'No developers', test: (g) => !g.developers || g.developers.length === 0 },
  publishers: { label: 'No publisher', test: (g) => !g.publishers || g.publishers.length === 0 },
  // Games never identified through the game form's Identify button.
  igdb: { label: 'No IGDB link', test: (g) => g.igdb_id == null },
}

/** Every country the companies of a kind are from, by name, for a country
 * filter's options; and "Unknown" last, when some of them have none set. */
function countryOptions(companies: Lookup[]): FilterOption[] {
  const countries = new Set(companies.map(countryOrUnknown))
  const unknown = countries.delete(UNKNOWN_COUNTRY)
  const options = Array.from(countries, (code) => ({ value: code, label: countryName(code) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
  return unknown ? [...options, { value: UNKNOWN_COUNTRY, label: 'Unknown' }] : options
}

/** Every year present in `dates`, newest first, for a year filter's options. */
function uniqueYears(dates: (string | null)[]): string[] {
  const years = new Set(dates.map(yearOf).filter(Boolean))
  return Array.from(years).sort((a, b) => Number(b) - Number(a))
}

/**
 * The raw, Notion-like view of the library: every game, one row each, sorted
 * and filtered on columns rather than browsed by status or date.
 */
export function GamesPage() {
  useDocumentTitle('Games')
  const games = useGames()
  const genres = useLookups('genres')
  const developers = useLookups('developers')
  const publishers = useLookups('publishers')
  const platforms = useLookups('platforms')
  const dateFormat = useDateFormat()
  const defaultView = useDefaultGamesView()

  // Every filter, the search text and the view mode live in the URL (see
  // useFilterParams) rather than in local state: reloading the page, or
  // following a link somebody else built by hand (say, "metroidvanias in
  // grid view"), reproduces exactly this screen. `view` defaults to '' here
  // rather than to a concrete layout: an empty URL is what falls back to the
  // signed-in account's own preference below, while an explicit `?view=` —
  // typed by hand or set by clicking a toggle — always wins.
  const [filters, setFilter, setFilters] = useFilterParams({
    q: '',
    exact: '',
    status: '',
    genre: '',
    developer: '',
    publisher: '',
    developerCountry: '',
    publisherCountry: '',
    platform: '',
    missing: '',
    releaseYear: '',
    playedYear: '',
    playedAfter: '',
    view: '',
    sort: '',
    sortDir: '',
  })
  const {
    status,
    genre: genreSlug,
    developer: developerSlug,
    publisher: publisherSlug,
    developerCountry,
    publisherCountry,
    platform: platformSlug,
    missing,
    releaseYear,
    playedYear,
    playedAfter,
  } = filters
  const exactMatch = filters.exact === '1'
  const view = filters.view === 'grid' || filters.view === 'table' ? filters.view : defaultView

  // Sorting lives in the URL rather than component state, same as every
  // other filter here — the point being that it survives a switch between
  // table and grid view (both read the same sorted `rows` below) instead of
  // resetting to title order every time, which is what a `useState` scoped
  // to <DataTable> used to do.
  const sortField = filters.sort || DEFAULT_SORT_FIELD
  const sortDesc = filters.sortDir === 'desc'
  const sorting: SortingState = useMemo(() => [{ id: sortField, desc: sortDesc }], [sortField, sortDesc])
  const setSorting = useCallback(
    (updater: SortingState | ((old: SortingState) => SortingState)) => {
      const [next] = typeof updater === 'function' ? updater(sorting) : updater
      setFilters({
        sort: next && next.id !== DEFAULT_SORT_FIELD ? next.id : '',
        sortDir: next?.desc ? 'desc' : '',
      })
    },
    [sorting, setFilters],
  )

  const modal = useGameModal()
  const offline = useOffline()

  // The search box is local state, not `filters.q` directly: a value bound
  // straight to the URL snaps back to it on every re-render, and a fast
  // typist outruns how quickly a search-param update round-trips through
  // the router — dropping characters. Typed text is source of truth locally;
  // `filters.q` only seeds it once (so a reload or a hand-built link still
  // works) and is written back debounced, same as the filtering below.
  const [search, setSearch] = useState(filters.q)
  const debouncedSearch = useDebouncedValue(search, 150)

  useEffect(() => {
    setFilter('q', debouncedSearch)
    // Only the debounced value should push to the URL — filters.q itself is
    // deliberately not a dependency, or a change to any *other* filter
    // (which also updates `filters`) would re-fire this and re-set `q` to
    // whatever it already is, which is harmless but pointless churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  const releaseYears = useMemo(
    () => uniqueYears((games.data ?? []).map((g) => g.release_date)),
    [games.data],
  )
  const playedYears = useMemo(
    () => uniqueYears((games.data ?? []).map((g) => g.logged_date)),
    [games.data],
  )

  // Every field the "+ Filter" button can add, in the order it lists them
  // (and the order active pills render in). Genre, developer, publisher and
  // platform are `multi`: a game can carry several of each, and matching
  // "any of" the picked values is what the rows filter above does for them.
  const filterFields = useMemo<FilterField[]>(
    () => [
      { key: 'status', label: 'Status', kind: 'single', options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })) },
      { key: 'genre', label: 'Genre', kind: 'multi', options: (genres.data ?? []).map((g) => ({ value: g.slug, label: g.name })) },
      { key: 'developer', label: 'Developer', kind: 'multi', options: (developers.data ?? []).map((d) => ({ value: d.slug, label: d.name })) },
      { key: 'publisher', label: 'Publisher', kind: 'multi', options: (publishers.data ?? []).map((p) => ({ value: p.slug, label: p.name })) },
      { key: 'developerCountry', label: 'Developer country', kind: 'multi', options: countryOptions(developers.data ?? []) },
      { key: 'publisherCountry', label: 'Publisher country', kind: 'multi', options: countryOptions(publishers.data ?? []) },
      { key: 'platform', label: 'Platform', kind: 'multi', options: (platforms.data ?? []).map((p) => ({ value: p.slug, label: p.name })) },
      { key: 'releaseYear', label: 'Release year', kind: 'single', options: releaseYears.map((year) => ({ value: year, label: year })) },
      { key: 'playedYear', label: 'Played year', kind: 'single', options: playedYears.map((year) => ({ value: year, label: year })) },
      {
        key: 'playedAfter',
        label: 'Played after release',
        kind: 'range',
        options: AGE_UNITS,
        summary: describeAgeRange,
        compare: (a, b) => boundDays(a) - boundDays(b),
      },
      {
        key: 'missing',
        label: 'Missing',
        kind: 'single',
        options: Object.entries(MISSING_FIELDS).map(([value, { label }]) => ({ value, label })),
      },
    ],
    [genres.data, developers.data, publishers.data, platforms.data, releaseYears, playedYears],
  )

  // Genre, developer, publisher and platform filters hold a comma-joined
  // list of slugs rather than one — a game can carry several genres or
  // developers, and matching "any of" the selected values (not "all of") is
  // what makes multi-selecting them useful.
  const genreSlugs = useMemo(() => (genreSlug ? genreSlug.split(',') : []), [genreSlug])
  const developerSlugs = useMemo(() => (developerSlug ? developerSlug.split(',') : []), [developerSlug])
  const publisherSlugs = useMemo(() => (publisherSlug ? publisherSlug.split(',') : []), [publisherSlug])
  const platformSlugs = useMemo(() => (platformSlug ? platformSlug.split(',') : []), [platformSlug])
  const developerCountries = useMemo(() => (developerCountry ? developerCountry.split(',') : []), [developerCountry])
  const publisherCountries = useMemo(() => (publisherCountry ? publisherCountry.split(',') : []), [publisherCountry])
  const playedAfterRange = useMemo(() => parseRange(playedAfter), [playedAfter])

  const rows = useMemo(() => {
    const needle = foldCase(debouncedSearch.trim())
    return (games.data ?? []).filter((game) => {
      if (needle) {
        const matches = exactMatch ? foldCase(game.title).includes(needle) : fuzzyMatch(debouncedSearch, game.title) != null
        if (!matches) return false
      }
      if (status && game.status !== status) return false
      if (genreSlugs.length && !game.genres?.some((g) => genreSlugs.includes(g.slug))) return false
      if (developerSlugs.length && !game.developers?.some((d) => developerSlugs.includes(d.slug))) return false
      if (publisherSlugs.length && !game.publishers?.some((p) => publisherSlugs.includes(p.slug))) return false
      if (developerCountries.length && !game.developers?.some((d) => developerCountries.includes(countryOrUnknown(d)))) return false
      if (publisherCountries.length && !game.publishers?.some((p) => publisherCountries.includes(countryOrUnknown(p)))) return false
      if (platformSlugs.length && !(game.platform && platformSlugs.includes(game.platform.slug))) return false
      if (missing && !MISSING_FIELDS[missing]?.test(game)) return false
      if (releaseYear && yearOf(game.release_date) !== releaseYear) return false
      if (playedYear && yearOf(game.logged_date) !== playedYear) return false
      if (playedAfterRange && !inAgeRange(game, playedAfterRange)) return false
      return true
    })
  }, [
    games.data,
    debouncedSearch,
    exactMatch,
    status,
    genreSlugs,
    developerSlugs,
    publisherSlugs,
    developerCountries,
    publisherCountries,
    platformSlugs,
    missing,
    releaseYear,
    playedYear,
    playedAfterRange,
  ])

  const stats = useMemo(() => {
    const scored = rows.filter((game) => game.score != null)
    const average = scored.length
      ? scored.reduce((sum, game) => sum + (game.score ?? 0), 0) / scored.length
      : null
    return {
      count: rows.length,
      average,
      releaseSpan: dateRangeSpan(rows.map((g) => g.release_date), dateFormat),
      releaseRange: dateRange(rows.map((g) => g.release_date), dateFormat),
      loggedSpan: dateRangeSpan(rows.map((g) => g.logged_date), dateFormat),
      loggedRange: dateRange(rows.map((g) => g.logged_date), dateFormat),
    }
  }, [rows, dateFormat])

  const columns = useMemo<ColumnDef<Game, unknown>[]>(
    () => [
      {
        accessorKey: 'title',
        header: 'Title',
        size: 260,
        cell: (info) => {
          const game = info.row.original
          const unreleased = isUnreleased(game)
          return (
            <span className="flex min-w-0 items-center gap-2.5">
              <CoverImage
                url={game.cover_image_url}
                size="sm"
                className={`h-9 w-7 rounded-[3px] bg-sunken ${unreleased ? UNRELEASED_RING : ''}`}
                imageClassName={unreleased ? UNRELEASED_IMAGE : ''}
                iconClassName="size-3.5"
              />
              {/* The IGDB mark right after the name, the way an external
                  link is usually marked, and only on a game linked to it,
                  so that the unlinked ones stand out by its absence. */}
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-medium"><Emoji value={game.title} /></span>
                {game.igdb_id != null && (
                  <IgdbLink
                    kind="games"
                    id={game.igdb_id}
                    aria-label={`View ${game.title} on IGDB`}
                    className="-m-1.5 shrink-0 p-1.5 text-ink-faint"
                  />
                )}
              </span>
            </span>
          )
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        cell: (info) => STATUS_LABELS[info.getValue() as Game['status']],
      },
      {
        accessorKey: 'score',
        header: 'Score',
        size: 80,
        cell: (info) => formatScore(info.getValue() as number | null),
      },
      {
        id: 'platform',
        header: 'Platform',
        size: 130,
        accessorFn: (game) => game.platform?.name ?? '',
        cell: (info) => <PlatformBadge platform={info.row.original.platform} />,
      },
      {
        id: 'genres',
        header: 'Genres',
        size: 220,
        accessorFn: (game) => (game.genres ?? []).map((g) => g.name).join(', '),
        cell: (info) => {
          const genres = info.row.original.genres ?? []
          if (genres.length === 0) return null
          return (
            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
              {genres.map((genre) => (
                <GenreTag key={genre.id} genre={genre} />
              ))}
            </span>
          )
        },
      },
      {
        id: 'developers',
        header: 'Developers',
        size: 200,
        accessorFn: (game) => (game.developers ?? []).map((d) => d.name).join(', '),
        cell: (info) => {
          const developers = info.row.original.developers ?? []
          if (developers.length === 0) return null
          return (
            <span className="flex flex-wrap gap-1">
              {developers.map((d) => (
                <Pill key={d.id} country={d.country}>
                  {d.name}
                </Pill>
              ))}
            </span>
          )
        },
      },
      {
        id: 'publishers',
        header: 'Publisher',
        size: 200,
        accessorFn: (game) => (game.publishers ?? []).map((p) => p.name).join(', '),
        cell: (info) => {
          const publishers = info.row.original.publishers ?? []
          if (publishers.length === 0) return null
          return (
            <span className="flex flex-wrap gap-1">
              {publishers.map((p) => (
                <Pill key={p.id} country={p.country}>
                  {p.name}
                </Pill>
              ))}
            </span>
          )
        },
      },
      {
        accessorKey: 'release_date',
        header: 'Release date',
        size: 130,
        cell: (info) => formatDate(info.getValue() as string | null, dateFormat),
      },
      {
        accessorKey: 'logged_date',
        header: 'Logged date',
        size: 130,
        cell: (info) => formatDate(info.getValue() as string | null, dateFormat),
      },
    ],
    [dateFormat],
  )

  // One sorted order shared by both views: the table renders it through
  // `table` directly, and the grid reads `sortedRows` off the same instance
  // so the two stay identical when switching between them.
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const sortedRows = table.getRowModel().rows.map((row) => row.original)

  // The list scrolls in a region of its own, under the filters.
  const listRef = useRef<HTMLDivElement>(null)
  useReloadScroll(() => listRef.current, games.data != null)
  useScrollToTop(() => listRef.current)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <div className="relative order-1 min-w-0 flex-1 sm:order-none sm:flex-none">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Field
            label=""
            aria-label="Search games"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search games…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`h-9 w-full pl-7 sm:w-56 ${search ? 'pr-[4.5rem]' : 'pr-10'}`}
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              type="button"
              onClick={() => setFilter('exact', exactMatch ? '' : '1')}
              aria-label="Exact match"
              aria-pressed={exactMatch}
              data-tooltip="Exact match"
              className={[
                'flex h-5 items-center justify-center rounded-[4px] px-1 text-[10px] font-semibold transition-colors duration-75',
                exactMatch ? 'bg-accent-soft text-accent' : 'text-ink-faint hover:bg-hover hover:text-ink-muted',
              ].join(' ')}
            >
              Aa
            </button>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="flex size-5 items-center justify-center rounded-full text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <FilterBar fields={filterFields} values={filters} onChange={(key, value) => setFilter(key as keyof typeof filters, value)} />

        <div className="order-5 ml-auto flex items-center gap-0.5 rounded-control bg-sunken p-0.5 sm:order-none">
          <button
            type="button"
            onClick={() => setFilter('view', 'table')}
            aria-label="Table view"
            aria-pressed={view === 'table'}
            className={[
              'flex size-7 items-center justify-center rounded-[3px] transition-colors duration-75',
              view === 'table' ? 'bg-surface text-ink shadow-thumb' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            <TableIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setFilter('view', 'grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={[
              'flex size-7 items-center justify-center rounded-[3px] transition-colors duration-75',
              view === 'grid' ? 'bg-surface text-ink shadow-thumb' : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            <GridIcon className="size-4" />
          </button>
        </div>

        <Button variant="primary" className="order-6 sm:order-none" onClick={modal.openNew} disabled={offline}>
          <PlusIcon className="size-4" />
          New game
        </Button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-persistent px-4 py-3 sm:px-6">
        {games.isError && !offline && <Notice tone="error">{errorMessage(games.error)}</Notice>}
        {games.isPending && <p className="text-[13px] text-ink-faint">Loading…</p>}
        {games.data && view === 'table' && (
          <DataTable
            table={table}
            onRowClick={modal.openGame}
            onRowPointerEnter={(game) => preloadImage(game.cover_image_url)}
            emptyMessage="No games match these filters."
          />
        )}
        {games.data && view === 'grid' && (
          <>
            {sortedRows.length === 0 ? (
              <p className="px-1 py-6 text-[13px] text-ink-faint">No games match these filters.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
                {sortedRows.map((game) => (
                  <GameCoverCard
                    key={game.id}
                    game={game}
                    onClick={() => modal.openGame(game)}
                    caption={game.platform?.name}
                    className="w-full"
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <GamesStats stats={stats} />
    </div>
  )
}
