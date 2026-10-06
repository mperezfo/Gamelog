import { useRef, useState } from 'react'

import { ChevronLeftIcon, PlusIcon, XIcon } from './icons'
import { FilterPopover } from './FilterPopover'
import { OptionRow } from './OptionRow'

export interface FilterOption {
  value: string
  label: string
}

export interface FilterField {
  key: string
  label: string
  /** `single` replaces the current value and closes the popover; `multi`
   * toggles membership in a comma-joined list and stays open, so several
   * values can be picked in one go. */
  kind: 'single' | 'multi'
  options: FilterOption[]
}

interface FilterBarProps {
  fields: FilterField[]
  /** The full filters object a page keeps in the URL — only the keys named
   * in `fields` are read, so a page can pass its whole filter state as-is. */
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}

const SEARCHABLE_THRESHOLD = 6

/** How a field's current value(s) read on its pill — up to two option
 * labels, then a "+N" for the rest, rather than every one spelled out. */
function valueSummary(field: FilterField, raw: string): string {
  const values = raw ? raw.split(',') : []
  const labels = values.map((v) => field.options.find((o) => o.value === v)?.label ?? v)
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

/** The search box + scrollable option list shared by the "+ Filter" add flow
 * and an existing pill's edit popover. */
function FilterOptionList({
  field,
  value,
  onChange,
}: {
  field: FilterField
  value: string
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const selected = field.kind === 'multi' ? (value ? value.split(',') : []) : value ? [value] : []
  const trimmed = query.trim().toLowerCase()
  const filtered = trimmed ? field.options.filter((o) => o.label.toLowerCase().includes(trimmed)) : field.options

  function pick(optionValue: string) {
    if (field.kind === 'single') {
      onChange(optionValue)
      return
    }
    onChange(
      selected.includes(optionValue) ? selected.filter((v) => v !== optionValue).join(',') : [...selected, optionValue].join(','),
    )
  }

  return (
    <>
      {field.options.length > SEARCHABLE_THRESHOLD && (
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${field.label.toLowerCase()}…`}
          className="w-full border-b border-line bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
      )}
      <div className="max-h-[40vh] overflow-y-auto p-1">
        {filtered.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint">No matches.</p>}
        {filtered.map((option) => {
          const active = selected.includes(option.value)
          return (
            <OptionRow key={option.value} label={option.label} active={active} onClick={() => pick(option.value)} />
          )
        })}
      </div>
    </>
  )
}

/** The "+ Filter" trigger: picks a not-yet-active field, then immediately
 * shows that field's value list in the same popover (a small back arrow
 * returns to the field list) — Notion's own add-filter flow. */
function AddFilterButton({ fields, values, onChange }: FilterBarProps) {
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const inactiveFields = fields.filter((f) => !values[f.key])
  // Looked up from the full field list, not `inactiveFields`: picking a
  // value can make the field active mid-interaction (a single-select commits
  // immediately, a multi-select as soon as the first option is toggled),
  // which would otherwise drop it out of `inactiveFields` and strand the
  // popover with no field definition to keep rendering.
  const selectedField = selectedKey ? (fields.find((f) => f.key === selectedKey) ?? null) : null

  function close() {
    setOpen(false)
    setSelectedKey(null)
  }

  return (
    <div className="relative order-2 shrink-0 sm:order-none">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-control bg-sunken px-2.5 text-[13px] font-medium text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink"
      >
        <PlusIcon className="size-3.5" />
        Filter
      </button>

      <FilterPopover anchorRef={anchorRef} open={open} onClose={close}>
        {selectedField ? (
          <>
            <button
              type="button"
              onClick={() => setSelectedKey(null)}
              className="flex w-full items-center gap-1 border-b border-line py-2.5 pr-2.5 pl-2 text-left text-[13px] font-medium text-ink-muted transition-colors duration-75 hover:text-ink"
            >
              <ChevronLeftIcon className="size-4 shrink-0" />
              {selectedField.label}
            </button>
            <FilterOptionList
              field={selectedField}
              value={values[selectedField.key] ?? ''}
              onChange={(value) => {
                onChange(selectedField.key, value)
                if (selectedField.kind === 'single') close()
              }}
            />
          </>
        ) : (
          <div className="max-h-[40vh] overflow-y-auto p-1">
            {inactiveFields.length === 0 && <p className="px-2 py-2 text-xs text-ink-faint">All filters added.</p>}
            {inactiveFields.map((field) => (
              <button
                key={field.key}
                type="button"
                onClick={() => setSelectedKey(field.key)}
                className="flex w-full items-center rounded-control px-2 py-1.5 text-left text-sm text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink"
              >
                {field.label}
              </button>
            ))}
          </div>
        )}
      </FilterPopover>
    </div>
  )
}

/** One active filter, shown as a pill: click its label to change the
 * value(s), click the × to drop the filter entirely. */
function FilterPill({
  field,
  value,
  onChange,
  onRemove,
}: {
  field: FilterField
  value: string
  onChange: (value: string) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <span className="order-4 inline-flex h-9 items-center gap-0.5 rounded-control bg-sunken pr-1 pl-2.5 text-[13px] sm:order-none">
      <button ref={anchorRef} type="button" onClick={() => setOpen((o) => !o)} className="max-w-[220px] truncate py-1.5 text-left">
        <span className="text-ink-faint">{field.label}: </span>
        <span className="font-medium text-ink">{valueSummary(field, value)}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${field.label} filter`}
        className="flex size-5 items-center justify-center rounded-full text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
      >
        <XIcon className="size-3" />
      </button>

      <FilterPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <FilterOptionList
          field={field}
          value={value}
          onChange={(next) => {
            onChange(next)
            if (field.kind === 'single') setOpen(false)
          }}
        />
      </FilterPopover>
    </span>
  )
}

/**
 * Notion-style filters: a "+ Filter" button to add one, each active filter
 * as a removable pill rather than every field shown as its own always-on
 * control. Keeps the filter bar to one line until it's actually holding
 * something, which is what makes it work on a phone — see GamesPage.
 */
export function FilterBar({ fields, values, onChange }: FilterBarProps) {
  const active = fields.filter((f) => values[f.key])

  return (
    <>
      {active.map((field) => (
        <FilterPill
          key={field.key}
          field={field}
          value={values[field.key] ?? ''}
          onChange={(value) => onChange(field.key, value)}
          onRemove={() => onChange(field.key, '')}
        />
      ))}
      <AddFilterButton fields={fields} values={values} onChange={onChange} />
      {/* Forces everything after it onto a new line, but only up to `sm`: on
       * a phone the search box and "+ Filter" share the top row edge to
       * edge, and active pills wrap below them instead of trailing off
       * after "+ Filter" on their own line. On a wider screen this is
       * `hidden`, and pills go back to sitting between the search box and
       * "+ Filter" on the same line, per their DOM order above. */}
      <div className="order-3 basis-full sm:hidden" aria-hidden="true" />
    </>
  )
}
