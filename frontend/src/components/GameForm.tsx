import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'

import { errorMessage } from '../api/client'
import { useGameModal } from '../hooks/useGameModal'
import { useCreateGame, useDeleteGame, useGames, useUpdateGame } from '../hooks/useGames'
import { useLookups } from '../hooks/useLookups'
import { useMetadataCapabilities } from '../hooks/useMetadata'
import { useOffline } from '../hooks/useOffline'
import { foldCase } from '../lib/fuzzy'
import type { CompanyLink, Game, GameInput, GameStatus, NewLookup } from '../types/game'
import { GAME_STATUSES, STATUS_LABELS } from '../types/game'
import { Button } from './Button'
import { ChipMultiSelect } from './ChipMultiSelect'
import { CoverImageField } from './CoverImageField'
import { DateField } from './DateField'
import { Field } from './Field'
import { SparklesIcon, TrashIcon } from './icons'
import { IdentifyPanel, type IdentifyResult } from './IdentifyPanel'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { Notice } from './Notice'
import { Select } from './Select'
import { Textarea } from './Textarea'

/** yyyy-mm-dd out of an ISO timestamp, for a `<input type="date">` value. */
function dateValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

/**
 * The reverse: what the API accepts. It stores only the date, but the field
 * is a Go `time.Time` under the hood, which only (un)marshals full RFC 3339 —
 * a bare "2024-05-17" is rejected as not a valid date-time.
 */
function toApiDate(value: string): string | null {
  return value ? `${value}T00:00:00Z` : null
}

interface GameFormProps {
  game?: Game
  onSaved: (game: Game) => void
  onDeleted?: () => void
  onCancel?: () => void
  /** Reports whether the fields differ from what they started as, so a
   * container can warn before discarding them (see GamePanel). */
  onDirtyChange?: (dirty: boolean) => void
}

/** Same members, regardless of order — good enough for genre/developer/
 * publisher id lists, which come out of a multi-select in whatever order
 * they were toggled. */
function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const sorted = [...b].sort((x, y) => x - y)
  return [...a].sort((x, y) => x - y).every((id, index) => id === sorted[index])
}

/**
 * Create and edit share one form: the fields are the same, only what happens
 * on submit differs. Used both inside the slide-over panel and on the
 * dedicated `/games/:id` page.
 */
export function GameForm({ game, onSaved, onDeleted, onCancel, onDirtyChange }: GameFormProps) {
  const genres = useLookups('genres')
  const developers = useLookups('developers')
  const publishers = useLookups('publishers')
  const platforms = useLookups('platforms')
  const games = useGames()
  const modal = useGameModal()
  const capabilities = useMetadataCapabilities()
  const offline = useOffline()

  const [title, setTitle] = useState(game?.title ?? '')
  const [status, setStatus] = useState<GameStatus>(game?.status ?? 'wishlist')
  const [score, setScore] = useState(game?.score != null ? String(game.score) : '')
  const [tagline, setTagline] = useState(game?.tagline ?? '')
  const [notes, setNotes] = useState(game?.notes ?? '')
  const [coverImageUrl, setCoverImageUrl] = useState(game?.cover_image_url ?? '')
  const [coverFocalX, setCoverFocalX] = useState(game?.cover_focal_x ?? null)
  const [coverFocalY, setCoverFocalY] = useState(game?.cover_focal_y ?? null)
  const [coverZoom, setCoverZoom] = useState(game?.cover_zoom ?? null)
  const [releaseDate, setReleaseDate] = useState(dateValue(game?.release_date))
  const [loggedDate, setLoggedDate] = useState(dateValue(game?.logged_date))
  const [platformId, setPlatformId] = useState(game?.platform_id ? String(game.platform_id) : '')
  const [genreIds, setGenreIds] = useState((game?.genres ?? []).map((g) => g.id))
  const [developerIds, setDeveloperIds] = useState((game?.developers ?? []).map((d) => d.id))
  const [publisherIds, setPublisherIds] = useState((game?.publishers ?? []).map((p) => p.id))
  // Developers and publishers to create, and links to IGDB to write, when the
  // game is saved: never before, so that abandoning the form leaves nothing
  // behind. A game never starts with any.
  const [pendingDevelopers, setPendingDevelopers] = useState<NewLookup[]>([])
  const [pendingPublishers, setPendingPublishers] = useState<NewLookup[]>([])
  const [developerLinks, setDeveloperLinks] = useState<CompanyLink[]>([])
  const [publisherLinks, setPublisherLinks] = useState<CompanyLink[]>([])
  // The title Identify is looking up, or null while its panel is closed.
  const [identifyTitle, setIdentifyTitle] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [initial] = useState(() => ({
    title: game?.title ?? '',
    status: game?.status ?? 'wishlist',
    score: game?.score != null ? String(game.score) : '',
    tagline: game?.tagline ?? '',
    notes: game?.notes ?? '',
    coverImageUrl: game?.cover_image_url ?? '',
    coverFocalX: game?.cover_focal_x ?? null,
    coverFocalY: game?.cover_focal_y ?? null,
    coverZoom: game?.cover_zoom ?? null,
    releaseDate: dateValue(game?.release_date),
    loggedDate: dateValue(game?.logged_date),
    platformId: game?.platform_id ? String(game.platform_id) : '',
    genreIds: (game?.genres ?? []).map((g) => g.id),
    developerIds: (game?.developers ?? []).map((d) => d.id),
    publisherIds: (game?.publishers ?? []).map((p) => p.id),
  }))

  const isDirty =
    title !== initial.title ||
    status !== initial.status ||
    score !== initial.score ||
    tagline !== initial.tagline ||
    notes !== initial.notes ||
    coverImageUrl !== initial.coverImageUrl ||
    coverFocalX !== initial.coverFocalX ||
    coverFocalY !== initial.coverFocalY ||
    coverZoom !== initial.coverZoom ||
    releaseDate !== initial.releaseDate ||
    loggedDate !== initial.loggedDate ||
    platformId !== initial.platformId ||
    !sameIds(genreIds, initial.genreIds) ||
    !sameIds(developerIds, initial.developerIds) ||
    !sameIds(publisherIds, initial.publisherIds) ||
    pendingDevelopers.length > 0 ||
    pendingPublishers.length > 0 ||
    developerLinks.length > 0 ||
    publisherLinks.length > 0

  // Identify only fills what is empty, never what was already set.
  const identifyFill = {
    releaseDate: releaseDate === '',
    developers: developerIds.length === 0 && pendingDevelopers.length === 0,
    publishers: publisherIds.length === 0 && pendingPublishers.length === 0,
  }
  const nothingToIdentify = !identifyFill.releaseDate && !identifyFill.developers && !identifyFill.publishers

  function applyIdentified(result: IdentifyResult) {
    if (result.releaseDate) setReleaseDate(result.releaseDate)
    if (result.developers) {
      setDeveloperIds(result.developers.ids)
      setDeveloperLinks(result.developers.links)
      setPendingDevelopers(result.developers.pending)
    }
    if (result.publishers) {
      setPublisherIds(result.publishers.ids)
      setPublisherLinks(result.publishers.links)
      setPendingPublishers(result.publishers.pending)
    }
    setIdentifyTitle(null)
  }

  // Titles must be unique — matched the same case/accent-insensitive way the
  // database's own collation would, so this can't flag something the backend
  // would actually let through (or miss something it wouldn't). Editing a
  // game never collides with itself.
  const duplicateGame = useMemo(() => {
    const needle = foldCase(title.trim())
    if (!needle) return undefined
    return (games.data ?? []).find((g) => g.id !== game?.id && foldCase(g.title.trim()) === needle)
  }, [games.data, title, game?.id])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Warns on a tab close/reload while there are unsaved changes. The
  // in-app "discard changes?" confirmation (see GamePanel/GameDetail) is a
  // separate concern — this is only about leaving the browser altogether.
  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  const create = useCreateGame()
  const update = useUpdateGame()
  const remove = useDeleteGame()

  const saving = create.isPending || update.isPending
  const saveError = create.error ?? update.error

  function submit(event: FormEvent) {
    event.preventDefault()
    if (duplicateGame) return

    const input: GameInput = {
      title,
      status,
      // Untouched by this form — carried through as-is so a regular edit
      // never disturbs the dashboard board's manual order.
      position: game?.position ?? Date.now(),
      score: score === '' ? null : Number(score),
      tagline: tagline || null,
      notes: notes || null,
      cover_image_url: coverImageUrl || null,
      cover_focal_x: coverFocalX,
      cover_focal_y: coverFocalY,
      cover_zoom: coverZoom,
      release_date: toApiDate(releaseDate),
      logged_date: toApiDate(loggedDate),
      platform_id: platformId ? Number(platformId) : null,
      genre_ids: genreIds,
      developer_ids: developerIds,
      publisher_ids: publisherIds,
      new_developers: pendingDevelopers,
      new_publishers: pendingPublishers,
      // A link only matters while its record is still on the game: one
      // deselected after Identify is dropped along with it.
      developer_links: developerLinks.filter((link) => developerIds.includes(link.id)),
      publisher_links: publisherLinks.filter((link) => publisherIds.includes(link.id)),
    }

    if (game) {
      update.mutate({ id: game.id, input }, { onSuccess: onSaved })
    } else {
      create.mutate(input, { onSuccess: onSaved })
    }
  }

  // Enter is easy to hit by accident while typing a title or tagline, and
  // this form has no undo — a save should be a deliberate click on the
  // button, not a keystroke. Buttons and the notes textarea keep their own
  // Enter behaviour (activating the focused button, adding a newline).
  function guardEnter(event: KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement
    if (event.key === 'Enter' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
      event.preventDefault()
    }
  }

  return (
    <form onSubmit={submit} onKeyDown={guardEnter} className="flex flex-col gap-5">
      {/* Offline, the game can still be read here, just not changed. A
          disabled fieldset disables every control inside it at once, and
          keeps whatever was being typed for when the server is back. */}
      <fieldset disabled={offline} className="contents">
        <CoverImageField
          readOnly={offline}
          value={coverImageUrl}
          onChange={setCoverImageUrl}
          focalX={coverFocalX}
          focalY={coverFocalY}
          onFocalChange={(x, y) => {
            setCoverFocalX(x)
            setCoverFocalY(y)
          }}
          zoom={coverZoom}
          onZoomChange={setCoverZoom}
        />

        <div className="flex items-center gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled"
            required
            aria-invalid={duplicateGame ? true : undefined}
            className={[
              'min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-ink-faint',
              duplicateGame ? 'text-danger' : 'text-ink',
            ].join(' ')}
          />
          {/* Only on a deployment with IGDB credentials: without them there is
              nothing for the button to look games up in. */}
          {capabilities.data?.identify && (
            <Button
              variant="ghost"
              className="shrink-0 px-2"
              title={
                nothingToIdentify
                  ? 'Release date, developers and publishers are already set'
                  : 'Fill in the release date, developers and publishers from IGDB'
              }
              disabled={!title.trim() || nothingToIdentify}
              onClick={() => setIdentifyTitle(title.trim())}
            >
              <SparklesIcon />
              Identify
            </Button>
          )}
        </div>

        {identifyTitle !== null && (
          <IdentifyPanel
            key={identifyTitle}
            title={identifyTitle}
            fill={identifyFill}
            developers={developers.data ?? []}
            publishers={publishers.data ?? []}
            onApply={applyIdentified}
            onClose={() => setIdentifyTitle(null)}
          />
        )}

        {duplicateGame && (
          <Notice tone="error">
            This game already exists.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => modal.openGame(duplicateGame)}
            >
              Open it
            </button>
          </Notice>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={GAME_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
          />

          <Field
            label="Score"
            type="number"
            min={0}
            max={10}
            step={0.1}
            placeholder="—"
            value={score}
            onChange={(event) => setScore(event.target.value)}
          />

          <Select
            label="Platform"
            value={platformId}
            onChange={setPlatformId}
            align="right"
            options={[
              { value: '', label: '—' },
              ...(platforms.data ?? []).map((platform) => ({ value: String(platform.id), label: platform.name })),
            ]}
          />
        </div>

        <Field
          label="Tagline"
          placeholder="A short, witty summary"
          value={tagline}
          onChange={(event) => setTagline(event.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <DateField label="Release date" value={releaseDate} onChange={setReleaseDate} />
          <DateField label="Logged date" value={loggedDate} onChange={setLoggedDate} />
        </div>

        <div className="flex flex-col gap-3">
          <ChipMultiSelect
            label="Genres"
            options={genres.data ?? []}
            selectedIds={genreIds}
            onChange={setGenreIds}
          />
          <MultiSelectDropdown
            label="Developers"
            options={developers.data ?? []}
            selectedIds={developerIds}
            onChange={setDeveloperIds}
            placeholder="Select developers…"
            pending={pendingDevelopers}
            onPendingChange={setPendingDevelopers}
          />
          <MultiSelectDropdown
            label="Publishers"
            options={publishers.data ?? []}
            selectedIds={publisherIds}
            onChange={setPublisherIds}
            placeholder="Select publishers…"
            pending={pendingPublishers}
            onPendingChange={setPendingPublishers}
          />
        </div>

        <Textarea
          label="Notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </fieldset>

      {saveError && <Notice tone="error">{errorMessage(saveError)}</Notice>}
      {remove.isError && <Notice tone="error">{errorMessage(remove.error)}</Notice>}

      <div className="flex items-center justify-between gap-2 pt-2">
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={saving || offline || Boolean(duplicateGame)}>
            {saving ? 'Saving…' : game ? 'Save' : 'Create game'}
          </Button>
          {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        </div>

        {game && onDeleted && (
          <>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">Delete for good?</span>
                <Button
                  variant="danger"
                  className="border border-danger/30"
                  disabled={remove.isPending || offline}
                  onClick={() => remove.mutate(game.id, { onSuccess: onDeleted })}
                >
                  {remove.isPending ? 'Deleting…' : 'Delete'}
                </Button>
                <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button
                variant="danger"
                className="px-2"
                title="Delete this game"
                onClick={() => setConfirmingDelete(true)}
                disabled={offline}
              >
                <TrashIcon />
              </Button>
            )}
          </>
        )}
      </div>
    </form>
  )
}
