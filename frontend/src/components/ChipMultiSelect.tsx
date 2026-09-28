import type { Lookup } from '../types/lookup'

interface ChipMultiSelectProps {
  label: string
  options: Lookup[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
  emptyMessage?: string
}

/**
 * Toggle chips for a game's genres, developers or publishers.
 *
 * New entries are not created from here: the four simple entities have their
 * own table pages for that, so a form that let you type a new one in would
 * duplicate that CRUD and risk near-duplicate names nobody notices.
 */
export function ChipMultiSelect({
  label,
  options,
  selectedIds,
  onChange,
  emptyMessage = 'None yet — add one from its own page first.',
}: ChipMultiSelectProps) {
  function toggle(id: number) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      {options.length === 0 ? (
        <p className="text-xs text-ink-faint">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const active = selectedIds.includes(option.id)
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => toggle(option.id)}
                className={[
                  'inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium transition-colors duration-75',
                  active ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-muted hover:bg-hover hover:text-ink',
                ].join(' ')}
              >
                {option.icon && <span aria-hidden="true">{option.icon}</span>}
                {option.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
