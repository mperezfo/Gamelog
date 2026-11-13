import { useRef, useState } from 'react'

import { foldCase } from '../lib/fuzzy'
import type { CompanyLink, NewLookup } from '../types/game'
import { MAX_LOOKUP_NAME, type Lookup } from '../types/lookup'
import { CheckIcon, PlusIcon, XIcon } from './icons'
import { CountryFlag } from './CountryFlag'
import { Emoji } from './Emoji'
import { NewMark } from './NewMark'
import { Popover } from './Popover'

interface MultiSelectDropdownProps {
  label: string
  options: Lookup[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  /** Records to create when the form is saved, shown as chips marked "new"
   * next to the selected ones. */
  pending?: NewLookup[]
  /** Lets the query itself become a new option when nothing matches it (a
   * developer or publisher that doesn't exist yet), added to `pending`.
   * Nothing is created until the form is saved, so a form abandoned midway
   * leaves no unused record behind. */
  onPendingChange?: (pending: NewLookup[]) => void
  /** Links to IGDB companies to write when the form is saved, from
   * Identify. A selected record with no country yet shows the one its link
   * brings, as it will once saved. */
  links?: CompanyLink[]
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
  pending = [],
  onPendingChange,
  links = [],
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selected = options.filter((o) => selectedIds.includes(o.id))
  const trimmedQuery = query.trim()
  const foldedQuery = foldCase(trimmedQuery)
  const filtered = options.filter((o) => foldCase(o.name).includes(foldedQuery))
  // Compared the way the database compares names, ignoring case and accents:
  // a name it would take for an existing record is never offered as new.
  const exactMatch = [...options, ...pending].some((o) => foldCase(o.name) === foldedQuery)
  const canCreate = Boolean(onPendingChange) && trimmedQuery !== '' && !exactMatch

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

  function create() {
    if (!onPendingChange || !trimmedQuery) return
    onPendingChange([...pending, { name: trimmedQuery }])
    setQuery('')
    setOpen(false)
  }

  function removePending(name: string) {
    onPendingChange?.(pending.filter((p) => p.name !== name))
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-control bg-field shadow-field px-2 py-1.5 text-left disabled:opacity-50"
      >
        {selected.length === 0 && pending.length === 0 && (
          <span className="px-0.5 text-sm text-ink-faint">{placeholder}</span>
        )}
        {selected.map((option) => {
          // The record's own country always wins: saving never replaces it.
          const country = option.country || links.find((link) => link.id === option.id)?.country
          return (
            <span
              key={option.id}
              className="inline-flex items-center gap-1 rounded-[4px] bg-hover px-1.5 py-0.5 text-xs font-medium text-ink"
            >
              {country && <CountryFlag code={country} />}
              <Emoji value={option.name} />
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
          )
        })}
        {pending.map((item) => (
          <span
            key={`new-${item.name}`}
            data-tooltip="Created when the game is saved"
            className="inline-flex items-center gap-1 rounded-[4px] bg-hover px-1.5 py-0.5 text-xs font-medium text-ink"
          >
            {item.country && <CountryFlag code={item.country} />}
            {/* Baseline rather than centre: small capitals centred on a line
                of lower-case text sit visibly high, while on its baseline
                they line up with the name's x-height. */}
            <span className="inline-flex items-baseline gap-1">
              <Emoji value={item.name} />
              <NewMark />
            </span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation()
                removePending(item.name)
              }}
              className="text-ink-faint hover:text-ink"
            >
              <XIcon className="size-3" />
            </span>
          </span>
        ))}
      </button>

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        aria-label={`Pick ${label.toLowerCase()}`}
        className="w-(--popover-anchor-width) overflow-hidden"
      >
        <input
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // What is typed here may become a new record's name.
          maxLength={MAX_LOOKUP_NAME}
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
                <span className="flex min-w-0 items-center gap-1.5">
                  {option.country && <CountryFlag code={option.country} />}
                  <span className="truncate"><Emoji value={option.name} /></span>
                </span>
                {active && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
              </button>
            )
          })}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left text-sm text-accent transition-colors duration-75 hover:bg-hover"
            >
              <PlusIcon className="size-3.5 shrink-0" />
              <span className="truncate">{`Create "${trimmedQuery}"`}</span>
            </button>
          )}
        </div>
      </Popover>
    </div>
  )
}
