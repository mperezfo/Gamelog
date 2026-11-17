import { useRef, useState, type FormEvent } from 'react'

import { useOffline } from '../hooks/useOffline'
import { usePreference, useUpdatePreferences } from '../hooks/useSession'
import { MAX_SAVED_VIEW_NAME, MAX_SAVED_VIEWS, type SavedView } from '../types/auth'
import { CheckIcon, StarIcon, XIcon } from './icons'
import { Popover } from './Popover'

function focusAndSelect(element: HTMLInputElement | null) {
  element?.focus({ preventScroll: true })
  element?.select()
}

/** Whether `name` is taken by a view other than `except`, ignoring case,
 * the way the backend compares them. */
function nameTaken(views: SavedView[], name: string, except?: SavedView): boolean {
  const folded = name.toLowerCase()
  return views.some((view) => view !== except && view.name.toLowerCase() === folded)
}

/** A name typed into a field shaped like a chip's label: the field is as
 * wide as what is in it, measured by an invisible copy of the text under
 * it, since Firefox does not size a field to its content. Enter or leaving
 * it commits, Escape gives up. */
function ChipNameInput({
  initial,
  onCommit,
  onCancel,
  isTaken,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
  isTaken: (name: string) => boolean
}) {
  const [draft, setDraft] = useState(initial)
  const done = useRef(false)

  function commit() {
    if (done.current) return
    done.current = true
    const name = draft.trim()
    // A name left blank or already taken keeps the one it had.
    if (name && name !== initial && !isTaken(name)) onCommit(name)
    else onCancel()
  }

  return (
    <span className="inline-grid min-w-[3ch]">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre">
        {draft || ' '}
      </span>
      <input
        ref={focusAndSelect}
        aria-label="Name of the saved view"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        maxLength={MAX_SAVED_VIEW_NAME}
        // Left to its own size, a field is some twenty characters wide
        // whatever it holds, and would widen the chip.
        size={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            event.stopPropagation()
            done.current = true
            onCancel()
          }
        }}
        className="col-start-1 row-start-1 w-full min-w-0 bg-transparent p-0 font-[inherit] text-inherit outline-none"
      />
    </span>
  )
}

/** One saved view. Clicking it applies it; once applied, clicking its name
 * renames it in place and its × removes it. */
function SavedViewChip({
  view,
  active,
  editable,
  isTaken,
  onApply,
  onRename,
  onRemove,
}: {
  view: SavedView
  active: boolean
  editable: boolean
  isTaken: (name: string) => boolean
  onApply: () => void
  onRename: (name: string) => void
  onRemove: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const base = 'inline-flex h-9 max-w-[220px] items-center rounded-full text-[13px] font-medium transition-colors duration-75'

  if (!active) {
    return (
      <button
        type="button"
        onClick={onApply}
        className={`${base} px-3 text-ink-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-hover hover:text-ink`}
      >
        <span className="truncate">{view.name}</span>
      </button>
    )
  }

  return (
    <span className={`${base} bg-ink pl-3 text-surface ${editable ? 'pr-1' : 'pr-3'}`} aria-current="true">
      {renaming ? (
        <ChipNameInput
          initial={view.name}
          isTaken={isTaken}
          onCommit={(name) => {
            onRename(name)
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : editable ? (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          data-tooltip="Rename"
          className="min-w-0 truncate py-1.5 text-left"
        >
          {view.name}
        </button>
      ) : (
        <span className="truncate">{view.name}</span>
      )}
      {editable && (
        <button
          type="button"
          // Pressing it must not blur a name being typed into first, which
          // would commit the name and then remove the view all the same.
          onPointerDown={(event) => event.preventDefault()}
          onClick={onRemove}
          aria-label={`Remove the saved view ${view.name}`}
          className="ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity duration-75 hover:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  )
}

/** The saved views as chips, the one the page is showing highlighted. */
export function SavedViewChips({
  activeName,
  onApply,
}: {
  /** The view the page is showing, if it is showing one. */
  activeName: string | undefined
  onApply: (view: SavedView) => void
}) {
  const views = usePreference('saved_views')
  const updatePreferences = useUpdatePreferences()
  const offline = useOffline()

  if (views.length === 0) return null

  return (
    <div role="group" aria-label="Saved views" className="contents">
      {views.map((view) => (
        <div key={view.name} className="order-4 flex min-w-0 sm:order-none">
          <SavedViewChip
            view={view}
            active={view.name === activeName}
            editable={!offline}
            isTaken={(name) => nameTaken(views, name, view)}
            onApply={() => onApply(view)}
            onRename={(name) =>
              updatePreferences.mutate({ saved_views: views.map((v) => (v === view ? { ...v, name } : v)) })
            }
            onRemove={() => updatePreferences.mutate({ saved_views: views.filter((v) => v !== view) })}
          />
        </div>
      ))}
    </div>
  )
}

/** The star that saves what the page is showing as a view, under a name
 * it suggests from the filters. */
export function SaveViewButton({ query, suggestedName }: { query: string; suggestedName: string }) {
  const views = usePreference('saved_views')
  const updatePreferences = useUpdatePreferences()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const anchorRef = useRef<HTMLButtonElement>(null)

  const trimmed = name.trim()
  const taken = nameTaken(views, trimmed)
  const full = views.length >= MAX_SAVED_VIEWS

  function save(event: FormEvent) {
    event.preventDefault()
    if (!trimmed || taken) return
    updatePreferences.mutate({ saved_views: [...views, { name: trimmed, query }] })
    setOpen(false)
  }

  return (
    <div className="order-2 shrink-0 sm:order-none">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => {
          if (!open) setName(suggestedName.slice(0, MAX_SAVED_VIEW_NAME))
          setOpen(!open)
        }}
        aria-label="Save this view"
        data-tooltip="Save this view"
        className="flex size-9 items-center justify-center rounded-control text-ink-faint transition-colors duration-75 hover:bg-hover hover:text-ink"
      >
        <StarIcon className="size-4" />
      </button>

      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        aria-label="Save this view"
        className="w-60 overflow-hidden"
      >
        {full ? (
          <p className="px-2.5 py-2 text-xs text-ink-faint">
            {MAX_SAVED_VIEWS} saved views at most: remove one to save another.
          </p>
        ) : (
          <form onSubmit={save} className="relative">
            <input
              ref={focusAndSelect}
              aria-label="Name of the view"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              maxLength={MAX_SAVED_VIEW_NAME}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this view…"
              className="w-full bg-transparent py-2 pr-9 pl-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!trimmed || taken}
              aria-label="Save"
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-control text-ink-muted transition-colors duration-75 enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-40"
            >
              <CheckIcon className="size-3.5" />
            </button>
            {taken && <p className="border-t border-line px-2.5 py-1.5 text-xs text-ink-faint">A view is already called that.</p>}
          </form>
        )}
      </Popover>
    </div>
  )
}
