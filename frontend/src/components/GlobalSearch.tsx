import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { useGames } from '../hooks/useGames'
import { coverFocalStyle } from '../lib/cover'
import { fuzzySearch } from '../lib/fuzzy'
import { STATUS_DOT, STATUS_LABELS, type Game } from '../types/game'
import { HighlightMatch } from './HighlightMatch'
import { SearchIcon, XIcon } from './icons'
import { CoverOverlay } from './CoverOverlay'

interface GlobalSearchProps {
  onSelect: (game: Game) => void
}

/** Whether `element` is a place typing "f" should type an "f", not trigger the shortcut. */
function isTypingTarget(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLElement && element.isContentEditable) return true
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
}

/**
 * Fuzzy search over the whole library, sitting at the top of the sidebar so
 * it is reachable from any page. Shares the `['games', {}]` query with every
 * other view that lists the full library, so it costs nothing extra once
 * anything else has loaded it.
 */
export function GlobalSearch({ onSelect }: GlobalSearchProps) {
  const games = useGames()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const results = useMemo(
    () => fuzzySearch(query, games.data ?? [], (game) => game.title),
    [query, games.data],
  )
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0))

  // Pressing "f" anywhere on the page focuses the search box, as long as the
  // keystroke isn't meant for a text field the user is already typing into.
  useEffect(() => {
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'f' && event.key !== 'F') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(document.activeElement)) return
      event.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  function moveActiveIndex(index: number) {
    setActiveIndex(index)
    optionRefs.current[index]?.scrollIntoView({ block: 'nearest' })
  }

  function select(game: Game) {
    onSelect(game)
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
      select(results[safeIndex].item)
    }
  }

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search games…"
        aria-label="Search games"
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
          'h-8 w-full rounded-control bg-sunken pl-7 text-sm text-ink',
          query ? 'pr-7' : 'pr-2.5',
          'placeholder:text-ink-faint outline-none transition-colors duration-75',
          'focus-visible:ring-2 focus-visible:ring-accent/40',
        ].join(' ')}
      />

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
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-ink-faint">No games match &ldquo;{query}&rdquo;.</p>
          ) : (
            results.map(({ item: game, match }, index) => (
              <button
                key={game.id}
                ref={(el) => {
                  optionRefs.current[index] = el
                }}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(game)}
                onMouseEnter={() => setActiveIndex(index)}
                className={[
                  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors duration-75',
                  index === safeIndex ? 'bg-hover text-ink' : 'text-ink-muted',
                ].join(' ')}
              >
                {game.cover_image_url ? (
                  <div className="relative h-8 w-6 shrink-0 overflow-hidden rounded-[3px]">
                    <img
                      src={game.cover_image_url}
                      alt=""
                      className="size-full object-cover"
                      style={coverFocalStyle(game)}
                    />
                    <CoverOverlay />
                  </div>
                ) : (
                  <span className="h-8 w-6 shrink-0 rounded-[3px] bg-sunken" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate">
                    <HighlightMatch text={game.title} indices={match.indices} />
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                    <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[game.status]}`} aria-hidden="true" />
                    {STATUS_LABELS[game.status]}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
