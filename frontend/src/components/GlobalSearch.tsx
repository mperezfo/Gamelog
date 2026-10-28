import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { useGames } from '../hooks/useGames'
import { useLookups } from '../hooks/useLookups'
import { usePreference } from '../hooks/useSession'
import { useShortcut } from '../hooks/useShortcut'
import { coverFocalStyle, preloadImage } from '../lib/cover'
import { fuzzySearch, type FuzzyMatch } from '../lib/fuzzy'
import type { SearchKind } from '../types/auth'
import { STATUS_DOT, STATUS_LABELS, type Game } from '../types/game'
import type { Lookup, LookupKind } from '../types/lookup'
import { CountryFlag } from './CountryFlag'
import { Emoji } from './Emoji'
import { HighlightMatch } from './HighlightMatch'
import { SearchIcon, XIcon } from './icons'
import { CoverImage } from './CoverImage'
import { PlatformBadge } from './PlatformBadge'

interface GlobalSearchProps {
  onSelect: (game: Game) => void
  /** A developer, publisher, platform or genre picked: the Games page
   * filtered to it. */
  onSelectLookup: (kind: LookupKind, item: Lookup) => void
}

/** How many games, and how many of the rest, the results list at most:
 * games come first, and the rest is a short group after them. */
const GAME_LIMIT = 8
const LOOKUP_LIMIT = 4

/** What a lookup row says it is. */
const KIND_LABEL: Record<LookupKind, string> = {
  developers: 'Developer',
  publishers: 'Publisher',
  platforms: 'Platform',
  genres: 'Genre',
}

/** One row of the results, a game or one of the four lists' records. */
type Result =
  | { type: 'game'; game: Game; match: FuzzyMatch }
  | { type: 'lookup'; kind: LookupKind; item: Lookup; match: FuzzyMatch }

/**
 * Fuzzy search over the whole library, sitting at the top of the sidebar so
 * it is reachable from any page. Shares the `['games', {}]` query with every
 * other view that lists the full library, so it costs nothing extra once
 * anything else has loaded it.
 */
export function GlobalSearch({ onSelect, onSelectLookup }: GlobalSearchProps) {
  const games = useGames()
  const developers = useLookups('developers')
  const publishers = useLookups('publishers')
  const platforms = useLookups('platforms')
  const genres = useLookups('genres')
  const hidden = usePreference('search_hidden')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  // One list for the keyboard to move through: the games, then the rest,
  // leaving out the kinds the account chose not to search (see Account).
  // Without games, the rest has the room they would have taken.
  const results = useMemo((): Result[] => {
    const shown = (kind: SearchKind) => !hidden.includes(kind)
    const lookups = (
      [
        ['developers', developers.data],
        ['publishers', publishers.data],
        ['platforms', platforms.data],
        ['genres', genres.data],
      ] as const
    ).flatMap(([kind, items]) => (shown(kind) ? (items ?? []).map((item) => ({ kind, item })) : []))
    return [
      ...(shown('games') ? fuzzySearch(query, games.data ?? [], (game) => game.title, GAME_LIMIT) : []).map(
        ({ item, match }): Result => ({ type: 'game', game: item, match }),
      ),
      ...fuzzySearch(query, lookups, ({ item }) => item.name, shown('games') ? LOOKUP_LIMIT : GAME_LIMIT).map(
        ({ item, match }): Result => ({ type: 'lookup', ...item, match }),
      ),
    ]
  }, [query, hidden, games.data, developers.data, publishers.data, platforms.data, genres.data])
  const firstLookup = results.findIndex((result) => result.type === 'lookup')
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0))

  // Pressing "f" anywhere on the page focuses the search box.
  useShortcut('f', () => inputRef.current?.focus())

  function moveActiveIndex(index: number) {
    setActiveIndex(index)
    optionRefs.current[index]?.scrollIntoView({ block: 'nearest' })
  }

  function select(result: Result) {
    if (result.type === 'game') onSelect(result.game)
    else onSelectLookup(result.kind, result.item)
    setQuery('')
    setOpen(false)
    // The option's onMouseDown preempts the default focus move (so a click
    // doesn't blur the input mid-selection), which otherwise leaves the box
    // looking selected — ring and all — under the modal it just opened.
    inputRef.current?.blur()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      event.currentTarget.blur()
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveIndex((safeIndex + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveIndex((safeIndex - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(results[safeIndex])
    }
  }

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
      <input
        autoComplete="off"
        spellCheck={false}
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search…"
        aria-label="Search the library"
        aria-keyshortcuts="f"
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setQuery('')
        }}
        onKeyDown={handleKeyDown}
        className={[
          'peer h-8 w-full rounded-control bg-field shadow-field pl-7 text-sm text-ink',
          query ? 'pr-7' : 'pr-2.5 sm:pr-8',
          'placeholder:text-ink-faint outline-none transition-colors duration-75',
          'focus-visible:ring-2 focus-visible:ring-accent/40',
        ].join(' ')}
      />

      {/* Advertises the "f" shortcut on desktop, where there is a keyboard
          to press it with, and steps aside once the box has focus or the
          clear button needs the spot. It sits 7px from the top so that,
          counting its 1px bottom edge, it is centred on whole pixels. */}
      {!query && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-[7px] right-2 hidden h-[17px] min-w-[17px] items-center justify-center rounded-control border border-line px-1 font-sans text-[10.5px] leading-none font-normal text-ink-faint shadow-[0_1px_0_var(--color-line)] transition-opacity duration-100 peer-focus:opacity-0 sm:flex"
        >
          F
        </kbd>
      )}

      {query && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setQuery('')
            inputRef.current?.focus()
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
        >
          <XIcon className="size-3.5" />
        </button>
      )}

      {open && query.trim() && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-[min(30rem,calc(100dvh-6rem))] overflow-y-auto rounded-control border border-line bg-surface shadow-popover">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-ink-faint">Nothing matches &ldquo;{query}&rdquo;.</p>
          ) : (
            results.map((result, index) => (
              <div key={result.type === 'game' ? `game-${result.game.id}` : `${result.kind}-${result.item.id}`}>
                {/* The rest come as a group of their own after the games. */}
                {index === firstLookup && index > 0 && <div className="mx-3 my-1 border-t border-line" />}
                <button
                  ref={(el) => {
                    optionRefs.current[index] = el
                  }}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(result)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onPointerEnter={() => result.type === 'game' && preloadImage(result.game.cover_image_url)}
                  className={[
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors duration-75',
                    index === safeIndex ? 'bg-hover text-ink' : 'text-ink-muted',
                  ].join(' ')}
                >
                  {result.type === 'game' ? (
                    <GameResult game={result.game} match={result.match} />
                  ) : (
                    <LookupResult kind={result.kind} item={result.item} match={result.match} />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function GameResult({ game, match }: { game: Game; match: FuzzyMatch }) {
  return (
    <>
      <CoverImage
        url={game.cover_image_url}
        size="sm"
        className="h-8 w-6 rounded-[3px] bg-sunken"
        style={coverFocalStyle(game)}
        iconClassName="size-3.5"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">
          <HighlightMatch text={game.title} indices={match.indices} />
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-faint">
          <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[game.status]}`} aria-hidden="true" />
          {STATUS_LABELS[game.status]}
        </span>
      </span>
    </>
  )
}

/** A developer, publisher, platform or genre, drawn the way its own page
 * lists it (a platform as its badge, a genre with its icon, a company with
 * its flag), and what kind of record it is. */
function LookupResult({ kind, item, match }: { kind: LookupKind; item: Lookup; match: FuzzyMatch }) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {kind === 'platforms' ? (
          <PlatformBadge platform={item} highlight={match.indices} />
        ) : (
          <>
            {item.country && <CountryFlag code={item.country} />}
            {item.icon && (
              <span aria-hidden="true" className="shrink-0">
                <Emoji value={item.icon} />
              </span>
            )}
            <span className="truncate">
              <HighlightMatch text={item.name} indices={match.indices} />
            </span>
          </>
        )}
      </span>
      <span className="shrink-0 text-xs text-ink-faint">{KIND_LABEL[kind]}</span>
    </>
  )
}
