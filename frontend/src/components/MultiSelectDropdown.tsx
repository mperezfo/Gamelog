import { useEffect, useRef, useState } from 'react'

import type { Lookup } from '../types/lookup'
import { CheckIcon, PlusIcon, XIcon } from './icons'

interface MultiSelectDropdownProps {
  label: string
  options: Lookup[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  /** Lets the query itself become a new option when nothing matches it —
   * e.g. a developer or publisher that doesn't exist yet. Created without an
   * icon: this is a quick add, not the full lookup form. */
  onCreate?: (name: string) => Promise<Lookup>
}

/**
 * A searchable dropdown rather than a wall of chips: developers and
 * publishers can run into the hundreds (an imported library easily does),
 * where every name shown at once stops being a picker and starts being a
 * list to scroll past. Genres stay chips (see ChipMultiSelect) — there are a
 * few dozen of those at most, short enough to scan in one go.
 */
export function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onChange,
  placeholder = 'Select…',
  onCreate,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = options.filter((o) => selectedIds.includes(o.id))
  const trimmedQuery = query.trim()
  const filtered = options.filter((o) => o.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
  const exactMatch = options.some((o) => o.name.toLowerCase() === trimmedQuery.toLowerCase())
  const canCreate = Boolean(onCreate) && trimmedQuery !== '' && !exactMatch

  function select(id: number) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
    // Closes rather than staying open for another pick: picking one
    // developer or publisher is the common case, and reopening for a second
    // one is one click away.
    setQuery('')
    setOpen(false)
  }

  function remove(id: number) {
    onChange(selectedIds.filter((x) => x !== id))
  }

  async function create() {
    if (!onCreate || !trimmedQuery) return
    setCreating(true)
    try {
      const created = await onCreate(trimmedQuery)
      onChange([...selectedIds, created.id])
      setQuery('')
      setOpen(false)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5" ref={containerRef}>
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-control bg-sunken px-2 py-1.5 text-left"
      >
        {selected.length === 0 && <span className="px-0.5 text-sm text-ink-faint">{placeholder}</span>}
        {selected.map((option) => (
          <span
            key={option.id}
            className="inline-flex items-center gap-1 rounded-[4px] bg-hover px-1.5 py-0.5 text-xs font-medium text-ink"
          >
            {option.name}
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation()
                remove(option.id)
              }}
              className="text-ink-faint hover:text-ink"
            >
              <XIcon className="size-3" />
            </span>
          </span>
        ))}
      </button>

      {open && (
        <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-control bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="max-h-52 overflow-y-auto border-t border-line p-1">
            {filtered.length === 0 && !canCreate && <p className="px-2 py-2 text-xs text-ink-faint">No matches.</p>}
            {filtered.map((option) => {
              const active = selectedIds.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => select(option.id)}
                  className={[
                    'flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm transition-colors duration-75',
                    active ? 'text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
                  ].join(' ')}
                >
                  <span className="truncate">{option.name}</span>
                  {active && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
                </button>
              )
            })}
            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void create()}
                className="flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-sm text-accent transition-colors duration-75 hover:bg-hover disabled:opacity-50"
              >
                <PlusIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {creating ? 'Creating…' : `Create "${trimmedQuery}"`}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
