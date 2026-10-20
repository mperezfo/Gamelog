import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

import { errorMessage } from '../api/client'
import { igdbPage } from '../api/metadata'
import { useGameModal } from '../hooks/useGameModal'
import { useCreateGame, useDeleteGame, useGames, useUpdateGame } from '../hooks/useGames'
import { useLookups } from '../hooks/useLookups'
import { useMetadataCapabilities } from '../hooks/useMetadata'
import { useOffline } from '../hooks/useOffline'
import { foldCase } from '../lib/fuzzy'
import type { CompanyLink, Game, GameInput, GameStatus, NewLookup, NewPlatform, PlatformLink } from '../types/game'
import { GAME_STATUSES, MAX_TAGLINE, MAX_TITLE, STATUS_LABELS } from '../types/game'
import { Button } from './Button'
import { ChipMultiSelect } from './ChipMultiSelect'
import { CoverImageField } from './CoverImageField'
import { DateField } from './DateField'
import { Field } from './Field'
import { ExternalLinkIcon, SearchIcon, TrashIcon } from './icons'
import { IdentifyPanel, type IdentifyCurrent, type IdentifyResult } from './IdentifyPanel'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { Reveal } from './Reveal'
import { Notice } from './Notice'
import { Select } from './Select'
import { Textarea } from './Textarea'

/** The Platform field's value while it holds a platform to create on save,
 * which has no id yet. Ids are numbers, so this is never one of them. */
const PENDING_PLATFORM = 'new'

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
  const [igdbId, setIgdbId] = useState(game?.igdb_id ?? null)
  // The IGDB game Unlink just took off, for Undo to put back.
  const [unlinkedIgdbId, setUnlinkedIgdbId] = useState<number | null>(null)
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
  // The same for the platform, from Identify only: a platform to create
  // (shown in the Platform field as PENDING_PLATFORM), or a link to write.
  const [pendingPlatform, setPendingPlatform] = useState<NewPlatform | null>(null)
  const [platformLink, setPlatformLink] = useState<PlatformLink | null>(null)
  // The title Identify is looking up, or null while its panel is not
  // there. It outlives identifyOpen by the length of the closing animation.
  const [identifyTitle, setIdentifyTitle] = useState<string | null>(null)
  const [identifyOpen, setIdentifyOpen] = useState(false)
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
    igdbId: game?.igdb_id ?? null,
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
    igdbId !== initial.igdbId ||
    !sameIds(genreIds, initial.genreIds) ||
    !sameIds(developerIds, initial.developerIds) ||
    !sameIds(publisherIds, initial.publisherIds) ||
    pendingDevelopers.length > 0 ||
    pendingPublishers.length > 0 ||
    developerLinks.length > 0 ||
    publisherLinks.length > 0 ||
    pendingPlatform !== null ||
    platformLink !== null

  // What Identify shows as about to be kept or replaced.
  const identifyCurrent: IdentifyCurrent = {
    title,
    releaseDate,
    igdbId,
    platformId: platformId && platformId !== PENDING_PLATFORM ? Number(platformId) : null,
    platform: pendingPlatform?.name ?? (platforms.data ?? []).find((p) => String(p.id) === platformId)?.name ?? '',
    developers: [
      ...(developers.data ?? []).filter((d) => developerIds.includes(d.id)).map((d) => d.name),
      ...pendingDevelopers.map((d) => d.name),
    ],
    publishers: [
      ...(publishers.data ?? []).filter((p) => publisherIds.includes(p.id)).map((p) => p.name),
      ...pendingPublishers.map((p) => p.name),
    ],
  }

  // What Apply chose, held until the panel has finished closing: changing
  // the fields below it while it is still shrinking makes the whole form
  // jump under it, where closing first and then filling in reads as one
  // calm step, the same as Cancel.
  const identifiedRef = useRef<IdentifyResult | null>(null)

  function openIdentify() {
    // Reopened before the last Apply finished closing: its values go in now
    // rather than never.
    flushIdentified()
    setIdentifyTitle(title.trim())
    setIdentifyOpen(true)
  }

  function applyIdentified(result: IdentifyResult) {
    identifiedRef.current = result
    setIdentifyOpen(false)
  }

  function closedIdentify() {
    setIdentifyTitle(null)
    flushIdentified()
  }

  function flushIdentified() {
    const result = identifiedRef.current
    identifiedRef.current = null
    if (!result) return

    if (result.igdbId !== undefined) {
      setIgdbId(result.igdbId)
      setUnlinkedIgdbId(null)
    }
    if (result.title) setTitle(result.title)
    if (result.releaseDate) setReleaseDate(result.releaseDate)
    if (result.platform) {
      if ('pending' in result.platform) {
        setPendingPlatform(result.platform.pending)
        setPlatformId(PENDING_PLATFORM)
        setPlatformLink(null)
      } else {
        setPendingPlatform(null)
        setPlatformId(String(result.platform.id))
        setPlatformLink(result.platform.link)
      }
    }
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
  }

  // The form keeps titles unique, which the API does not enforce: an import
  // matches games by title, and two that share one are ambiguous to it.
  // Compared the case- and accent-insensitive way the database's collation
  // compares them. Editing a game never collides with itself.
  const duplicateGame = useMemo(() => {
    const needle = foldCase(title.trim())
    if (!needle) return undefined
    return (games.data ?? []).find((g) => g.id !== game?.id && foldCase(g.title.trim()) === needle)
  }, [games.data, title, game?.id])

  // Two games can be the same IGDB game (nothing stops it), but it is more
  // often a mistake, so the form says so without refusing to save.
  const igdbTwin = useMemo(() => {
    if (igdbId === null) return undefined
    return (games.data ?? []).find((g) => g.id !== game?.id && g.igdb_id === igdbId)
  }, [games.data, igdbId, game?.id])

  // What the link under the title is about: the IGDB game, or the one just
  // unlinked while Undo can still bring it back.
  const shownIgdbId = igdbId ?? unlinkedIgdbId

  // How many games each platform has, for Identify to put the platforms
  // the library uses most first.
  const platformGames = useMemo(() => {
    const counts = new Map<number, number>()
    for (const g of games.data ?? []) {
      if (g.platform_id !== null) counts.set(g.platform_id, (counts.get(g.platform_id) ?? 0) + 1)
    }
    return counts
  }, [games.data])

  // The IGDB games the rest of the library is linked to, for Identify to
  // point out among its results.
  const libraryIgdbIds = useMemo(
    () => new Set((games.data ?? []).flatMap((g) => (g.id !== game?.id && g.igdb_id !== null ? [g.igdb_id] : []))),
    [games.data, game?.id],
  )

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
  // A cover still uploading or importing: saving now would keep the old one.
  const [coverBusy, setCoverBusy] = useState(false)
  const saveError = create.error ?? update.error

  function submit(event: FormEvent) {
    event.preventDefault()
    // Not left to the disabled button alone: a form has other ways to be
    // submitted than a click on it.
    if (duplicateGame || coverBusy || !title.trim()) return

    // Sent without the blank space around it, as it is stored, so that the
    // cached copy matches the server's.
    const input: GameInput = {
      title: title.trim(),
      status,
      // Untouched by this form — carried through as-is so a regular edit
      // never disturbs the dashboard board's manual order.
      position: game?.position ?? Date.now(),
      score: score === '' ? null : Number(score),
      tagline: tagline.trim() || null,
      notes: notes.trim() || null,
      cover_image_url: coverImageUrl.trim() || null,
      cover_focal_x: coverFocalX,
      cover_focal_y: coverFocalY,
      cover_zoom: coverZoom,
      release_date: toApiDate(releaseDate),
      logged_date: toApiDate(loggedDate),
      platform_id: platformId && platformId !== PENDING_PLATFORM ? Number(platformId) : null,
      new_platform: platformId === PENDING_PLATFORM ? pendingPlatform : null,
      // Like a developer's, a link only matters while its platform is still
      // the game's.
      platform_link: platformLink && String(platformLink.id) === platformId ? platformLink : null,
      igdb_id: igdbId,
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
          imageSearch={
            capabilities.data
              ? { title: title.trim(), igdbId, sources: capabilities.data.image_sources }
              : undefined
          }
          onBusyChange={setCoverBusy}
        />

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Untitled"
              // Game titles are proper names, which a spellchecker only
              // underlines in red.
              spellCheck={false}
              maxLength={MAX_TITLE}
              // Enter looks the title up, where Identify is available: it is
              // the one thing worth doing straight from the title. The form
              // itself never saves on Enter (see guardEnter).
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                if (capabilities.data?.identify && title.trim()) openIdentify()
              }}
              required
              aria-invalid={duplicateGame ? true : undefined}
              className={[
                'min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-ink-faint',
                duplicateGame ? 'text-danger' : 'text-ink',
              ].join(' ')}
            />
            {/* Shown even without IGDB credentials, but disabled, with the
                reason in its tooltip: the feature exists, the server is
                just not set up for it. Left out until the capabilities are
                known, so as not to blame a missing configuration that is
                not missing. */}
            {capabilities.data && (
              <Button
                variant="ghost"
                className="shrink-0 px-2"
                data-tooltip={
                  capabilities.data.identify
                    ? 'Fill in the title, release date, platform, developers and publishers from IGDB'
                    : 'Fill in the details from IGDB (IGDB credentials not set up on this server)'
                }
                disabled={!capabilities.data.identify || !title.trim()}
                onClick={openIdentify}
              >
                <SearchIcon />
                Identify
              </Button>
            )}
          </div>

          {shownIgdbId !== null && (
            <IgdbGameLink
              id={shownIgdbId}
              unlinked={igdbId === null}
              canOpen={Boolean(capabilities.data?.identify)}
              onUnlink={() => {
                setUnlinkedIgdbId(igdbId)
                setIgdbId(null)
              }}
              onUndo={() => {
                setIgdbId(unlinkedIgdbId)
                setUnlinkedIgdbId(null)
              }}
            />
          )}
        </div>

        {identifyTitle !== null && (
          // The form's gap goes inside the animated height, so that closing
          // ends exactly where the next field starts.
          <div className="-mt-5">
            <Reveal open={identifyOpen} onClosed={closedIdentify}>
              <div className="pt-5">
                <IdentifyPanel
                  key={identifyTitle}
                  title={identifyTitle}
                  current={identifyCurrent}
                  libraryIgdbIds={libraryIgdbIds}
                  platforms={platforms.data ?? []}
                  platformGames={platformGames}
                  developers={developers.data ?? []}
                  publishers={publishers.data ?? []}
                  onApply={applyIdentified}
                  onClose={() => setIdentifyOpen(false)}
                />
              </div>
            </Reveal>
          </div>
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

        {igdbTwin && (
          <Notice tone="ok">
            “{igdbTwin.title}” is linked to this IGDB game too.{' '}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => modal.openGame(igdbTwin)}
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
            onChange={(value) => {
              setPlatformId(value)
              // Picking any other platform drops the one Identify was to
              // create.
              if (value !== PENDING_PLATFORM) setPendingPlatform(null)
            }}
            align="right"
            options={[
              { value: '', label: '—' },
              ...(platforms.data ?? []).map((platform) => ({ value: String(platform.id), label: platform.name })),
              // Marked with Identify's "+" for a record to create: a "(new)"
              // after the name would be the first thing cut on a phone.
              ...(pendingPlatform ? [{ value: PENDING_PLATFORM, label: `+ ${pendingPlatform.name}` }] : []),
            ]}
          />
        </div>

        <Field
          label="Tagline"
          placeholder="A short, witty summary"
          maxLength={MAX_TAGLINE}
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
          <Button type="submit" variant="primary" disabled={saving || coverBusy || offline || Boolean(duplicateGame) || !title.trim()}>
            {saving ? 'Saving…' : coverBusy ? 'Storing cover…' : game ? 'Save' : 'Create game'}
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
                data-tooltip="Delete this game"
                aria-label="Delete this game"
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

interface IgdbGameLinkProps {
  id: number
  /** Unlinked on this form, not saved yet: shown struck through, with Undo. */
  unlinked: boolean
  /** Whether the API can find the page, which needs IGDB credentials. */
  canOpen: boolean
  onUnlink: () => void
  onUndo: () => void
}

/**
 * The game's link to IGDB, under its title: the page there, and a way to
 * drop the link. Dropping it waits for Save like any other field, and reads
 * struck through until then, the way Identify shows what goes away.
 */
function IgdbGameLink({ id, unlinked, canOpen, onUnlink, onUndo }: IgdbGameLinkProps) {
  const label =
    canOpen && !unlinked ? (
      <a
        href={igdbPage('games', id)}
        target="_blank"
        rel="noopener noreferrer"
        data-tooltip="View on IGDB"
        className="inline-flex items-center gap-1 transition-colors duration-75 hover:text-ink"
      >
        Linked to IGDB
        <ExternalLinkIcon className="size-3 shrink-0" />
      </a>
    ) : (
      <span className={unlinked ? 'line-through decoration-ink-faint' : undefined}>Linked to IGDB</span>
    )

  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-faint">
      {label}
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={unlinked ? onUndo : onUnlink}
        className="transition-colors duration-75 hover:text-ink"
      >
        {unlinked ? 'Undo' : 'Unlink'}
      </button>
    </p>
  )
}
