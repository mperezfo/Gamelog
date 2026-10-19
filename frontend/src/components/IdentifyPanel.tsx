import { useEffect, useRef, useState, type ReactNode } from 'react'

import { errorMessage } from '../api/client'
import { useGameCandidates } from '../hooks/useMetadata'
import { useDateFormat } from '../hooks/useSession'
import { formatDate } from '../lib/format'
import { foldCase } from '../lib/fuzzy'
import type { CompanyLink, NewLookup, NewPlatform, PlatformLink } from '../types/game'
import { MAX_LOOKUP_NAME, type Lookup } from '../types/lookup'
import type { CompanyMatch, GameCandidate, MatchTarget, PlatformMatch } from '../types/metadata'
import { Button } from './Button'
import { Dots } from './Dots'
import { Dropdown } from './Dropdown'
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, PlusIcon, XIcon } from './icons'
import { Notice } from './Notice'
import { Reveal } from './Reveal'
import { Switch } from './Switch'

/** What the form holds right now for the fields Identify can set. */
export interface IdentifyCurrent {
  title: string
  /** yyyy-mm-dd, or empty. */
  releaseDate: string
  /** The IGDB game the form is linked to, or null. */
  igdbId: number | null
  /** The platform the form holds, by id; null for none or a pending one. */
  platformId: number | null
  /** Its name, a pending one included; empty for none. */
  platform: string
  /** Names of the developers and publishers on the form, pending ones
   * included. */
  developers: string[]
  publishers: string[]
}

/** What one role (developers or publishers) resolves to: records the library
 * already has, links to write for them, and records to create on save. */
export interface CompanyResolution {
  ids: number[]
  links: CompanyLink[]
  pending: NewLookup[]
}

/** What Apply hands back to the form: every field present replaces what the
 * form holds, and every field left out is kept. */
export interface IdentifyResult {
  /** The IGDB game picked, when it is not the one the form is linked to. */
  igdbId?: number
  title?: string
  /** yyyy-mm-dd, the form's own date shape. */
  releaseDate?: string
  developers?: CompanyResolution
  publishers?: CompanyResolution
  platform?: PlatformResolution
}

/** What the platform resolves to: a platform the library has, with a link
 * to write when it is not linked to the IGDB platform yet, or one to create
 * on save. */
export type PlatformResolution = { id: number; link: PlatformLink | null } | { pending: NewPlatform }

interface IdentifyPanelProps {
  title: string
  current: IdentifyCurrent
  /** IGDB games other games of the library are linked to. */
  libraryIgdbIds: ReadonlySet<number>
  platforms: Lookup[]
  /** How many games of the library each platform has, by id. */
  platformGames: ReadonlyMap<number, number>
  developers: Lookup[]
  publishers: Lookup[]
  onApply: (result: IdentifyResult) => void
  onClose: () => void
}

/**
 * Looks the title up on IGDB and fills in the release date, platform,
 * developers and publishers from the game picked among the results.
 *
 * Two steps, because a title alone is often ambiguous (an original and its
 * remake share one): pick the game, then confirm what it would change. Apply
 * only changes the form; nothing is created or linked until the game is
 * saved.
 */
export function IdentifyPanel({
  title,
  current,
  libraryIgdbIds,
  platforms,
  platformGames,
  developers,
  publishers,
  onApply,
  onClose,
}: IdentifyPanelProps) {
  const candidates = useGameCandidates(title)
  const [picked, setPicked] = useState<GameCandidate | null>(null)

  // The game the form is linked to already goes first, to confirm in one
  // click; the rest keep IGDB's order.
  const ordered = candidates.data
    ? [
        ...candidates.data.filter((c) => c.igdb_id === current.igdbId),
        ...candidates.data.filter((c) => c.igdb_id !== current.igdbId),
      ]
    : []

  return (
    <div className="flex flex-col gap-3 rounded-control bg-sunken p-3">
      <div className="flex h-6 items-center justify-between gap-2">
        {picked ? (
          // The picked game, which is also the way back to the others: the
          // title section below may well show the game's own title instead.
          <button
            type="button"
            onClick={() => setPicked(null)}
            title="Back to the results"
            className="-ml-1 inline-flex min-w-0 items-center gap-1 rounded-control px-1 text-[13px] font-medium text-ink-muted hover:text-ink"
          >
            <ChevronLeftIcon className="size-3.5 shrink-0" />
            <span className="truncate">
              {picked.name}
              {releaseYear(picked) && <span className="font-normal text-ink-faint"> ({releaseYear(picked)})</span>}
            </span>
          </button>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-medium text-ink-muted">IGDB results for “{title}”</span>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="shrink-0 rounded-control p-1 text-ink-faint hover:bg-hover hover:text-ink"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Keyed by step, so that each one fades in as the panel resizes
          around it. */}
      <div key={picked?.igdb_id ?? 'results'} className="animate-[gl-appear_150ms_ease-out] motion-reduce:animate-none">
        {picked ? (
          <IdentifyConfirm
            candidate={picked}
            current={current}
            platforms={platforms}
            platformGames={platformGames}
            developers={developers}
            publishers={publishers}
            onApply={onApply}
            onCancel={onClose}
          />
        ) : candidates.isPending ? (
          <p className="text-sm text-ink-faint">
            Searching IGDB
            <Dots />
          </p>
        ) : candidates.isError ? (
          <Notice tone="error">{errorMessage(candidates.error)}</Notice>
        ) : ordered.length === 0 ? (
          <p className="text-sm text-ink-faint">No games found on IGDB.</p>
        ) : (
          <ul className="-mx-1 flex max-h-80 flex-col overflow-y-auto">
            {ordered.map((candidate) => (
              <li key={candidate.igdb_id}>
                <CandidateRow
                  candidate={candidate}
                  mark={
                    candidate.igdb_id === current.igdbId
                      ? 'linked'
                      : libraryIgdbIds.has(candidate.igdb_id)
                        ? 'library'
                        : undefined
                  }
                  onPick={() => setPicked(candidate)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function releaseYear(candidate: GameCandidate): string | null {
  return candidate.release_date ? candidate.release_date.slice(0, 4) : null
}

interface CandidateRowProps {
  candidate: GameCandidate
  /** linked: the game the form is linked to. library: one another game of
   * the library is linked to. */
  mark?: 'linked' | 'library'
  onPick: () => void
}

function CandidateRow({ candidate, mark, onPick }: CandidateRowProps) {
  // Platforms by IGDB's short names, which a phone's width has room for.
  const platforms = candidate.platforms.map((platform) => platform.abbreviation || platform.name).join(', ')
  const details = [releaseYear(candidate), platforms].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-control px-1 py-1.5 text-left transition-colors duration-75 hover:bg-hover"
    >
      {/* Shown straight from IGDB rather than through the API: it is only
          there to tell candidates apart, and never stored. */}
      {candidate.cover_url ? (
        <img
          src={candidate.cover_url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-12 w-9 shrink-0 rounded-[3px] bg-hover object-cover"
        />
      ) : (
        <span className="h-12 w-9 shrink-0 rounded-[3px] bg-hover" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{candidate.name}</span>
          {mark === 'linked' && <LinkMark title="The IGDB game this game is linked to">linked</LinkMark>}
          {mark === 'library' && (
            <span title="Another game of your library is linked to it" className="shrink-0 text-xs text-ink-faint">
              In library
            </span>
          )}
        </span>
        {details && <span className="truncate text-xs text-ink-faint">{details}</span>}
      </span>
    </button>
  )
}

/** What to do with one company from IGDB. */
type Choice = { kind: 'existing'; id: number } | { kind: 'create' } | { kind: 'skip' }

/** A match is taken as it is; with none, the company is created. */
function defaultChoice(company: CompanyMatch): Choice {
  return company.match ? { kind: 'existing', id: company.match.id } : { kind: 'create' }
}

/** Turns the choices for one role into what the form writes on save. */
function resolve(companies: CompanyMatch[], choices: Choice[]): CompanyResolution {
  const resolution: CompanyResolution = { ids: [], links: [], pending: [] }

  companies.forEach((company, index) => {
    const choice = choices[index]
    if (choice.kind === 'existing') {
      if (!resolution.ids.includes(choice.id)) resolution.ids.push(choice.id)
      // Already linked to that very record: nothing new to remember.
      const alreadyLinked = company.match?.reason === 'linked' && company.match.id === choice.id
      if (!alreadyLinked)
        resolution.links.push({
          id: choice.id,
          igdb_company_id: company.igdb_company_id,
        })
    } else if (choice.kind === 'create') {
      const name = recordName(company.name)
      if (!resolution.pending.some((p) => foldCase(p.name) === foldCase(name))) {
        resolution.pending.push({
          name,
          igdb_company_id: company.igdb_company_id,
        })
      }
    }
  })

  return resolution
}

/** IGDB's name for a company, cut to what the API takes for a new record:
 * IGDB sets no such limit, and one longer name would fail the game's whole
 * save. Cut by character rather than by UTF-16 unit, so as not to split one. */
function recordName(name: string): string {
  return Array.from(name.trim()).slice(0, MAX_LOOKUP_NAME).join('').trim()
}

/** IGDB's platforms, those matched to a platform of the library first, by
 * how many games the library has on it, and the rest in IGDB's order. */
function orderPlatforms(platforms: PlatformMatch[], games: ReadonlyMap<number, number>): PlatformMatch[] {
  const count = (platform: PlatformMatch) => (platform.match ? (games.get(platform.match.id) ?? 0) : -1)
  // A stable sort, so that ties keep IGDB's order.
  return [...platforms].sort((a, b) => count(b) - count(a))
}

/** A matched platform is taken as it is; with none, it is created. */
function platformDefault(platform: PlatformMatch | undefined): Choice {
  return platform?.match ? { kind: 'existing', id: platform.match.id } : { kind: 'create' }
}

/** The name a platform is created with: IGDB's abbreviation ("PS5") when it
 * has one, which is what a library tends to call a platform, or its name. */
function platformName(platform: PlatformMatch): string {
  return recordName(platform.abbreviation || platform.name)
}

function isLinkedToPlatform(record: Lookup | undefined, platform: PlatformMatch): boolean {
  return Boolean(record?.igdb_platform_ids?.includes(platform.igdb_platform_id))
}

/** Turns the choice for IGDB's platform into what the form writes on save. */
function resolvePlatform(platform: PlatformMatch, choice: Choice, records: Lookup[]): PlatformResolution | undefined {
  if (choice.kind === 'create') {
    return { pending: { name: platformName(platform), igdb_platform_id: platform.igdb_platform_id } }
  }
  if (choice.kind !== 'existing') return undefined
  const linked = isLinkedToPlatform(
    records.find((r) => r.id === choice.id),
    platform,
  )
  return { id: choice.id, link: linked ? null : { id: choice.id, igdb_platform_id: platform.igdb_platform_id } }
}

/** Whether a resolution changes the form's platform, or, unless `valueOnly`,
 * at least links it. */
function changesPlatform(resolution: PlatformResolution, current: number | null, valueOnly = false): boolean {
  if ('pending' in resolution) return true
  return resolution.id !== current || (!valueOnly && resolution.link !== null)
}

function isEmpty(resolution: CompanyResolution): boolean {
  return resolution.ids.length === 0 && resolution.pending.length === 0
}

interface IdentifyConfirmProps {
  candidate: GameCandidate
  current: IdentifyCurrent
  platforms: Lookup[]
  platformGames: ReadonlyMap<number, number>
  developers: Lookup[]
  publishers: Lookup[]
  onApply: (result: IdentifyResult) => void
  onCancel: () => void
}

/**
 * One section per field, each with a switch for whether IGDB's value goes in.
 * It starts on for a field that is empty and off for one that already has a
 * value, so that nothing set by hand is replaced without asking. Whatever
 * would be replaced is shown struck through, the same way a skipped company
 * is: struck through always means "goes away".
 */
function IdentifyConfirm({
  candidate,
  current,
  platforms,
  platformGames,
  developers,
  publishers,
  onApply,
  onCancel,
}: IdentifyConfirmProps) {
  const dateFormat = useDateFormat()
  const [developerChoices, setDeveloperChoices] = useState(() => candidate.developers.map(defaultChoice))
  const [publisherChoices, setPublisherChoices] = useState(() => candidate.publishers.map(defaultChoice))

  const igdbTitle = candidate.name.trim()
  const currentTitle = current.title.trim()
  // The form never has an empty title by the time Identify runs, so the
  // title is only ever replaced on request.
  const [applyTitle, setApplyTitle] = useState(false)

  const igdbDate = candidate.release_date?.slice(0, 10) ?? ''
  const [applyDate, setApplyDate] = useState(current.releaseDate === '')
  const [applyDevelopers, setApplyDevelopers] = useState(current.developers.length === 0)
  const [applyPublishers, setApplyPublishers] = useState(current.publishers.length === 0)

  // IGDB's platforms, the ones the library already has first, by how many
  // games it has on them: a game is likelier logged where most others are.
  const igdbPlatforms = orderPlatforms(candidate.platforms, platformGames)
  const [igdbPlatform, setIgdbPlatform] = useState<PlatformMatch | undefined>(
    () => igdbPlatforms.find((p) => p.match && p.match.id === current.platformId) ?? igdbPlatforms[0],
  )
  const [platformChoice, setPlatformChoice] = useState<Choice>(() => platformDefault(igdbPlatform))
  const [applyPlatform, setApplyPlatform] = useState(current.platform === '')
  const platformResolution = igdbPlatform && resolvePlatform(igdbPlatform, platformChoice, platforms)

  const developerResolution = resolve(candidate.developers, developerChoices)
  const publisherResolution = resolve(candidate.publishers, publisherChoices)

  const result: IdentifyResult = {}
  // Picking a game is saying that this is the game, switches or not.
  if (candidate.igdb_id !== current.igdbId) result.igdbId = candidate.igdb_id
  if (applyTitle && igdbTitle && igdbTitle !== currentTitle) result.title = igdbTitle
  if (applyDate && igdbDate && igdbDate !== current.releaseDate) result.releaseDate = igdbDate
  if (applyPlatform && platformResolution && changesPlatform(platformResolution, current.platformId)) {
    result.platform = platformResolution
  }
  // Skipping every company applies nothing, rather than clearing the field.
  if (applyDevelopers && !isEmpty(developerResolution)) result.developers = developerResolution
  if (applyPublishers && !isEmpty(publisherResolution)) result.publishers = publisherResolution
  const changesSomething = Object.keys(result).length > 0
  const onlyLinks = result.igdbId !== undefined && Object.keys(result).length === 1

  const date = (value: string) => formatDate(value, dateFormat)

  return (
    <div className="flex flex-col gap-4">
      <InlineSection
        label="Title"
        // Nothing to decide when it is the same title already.
        toggle={igdbTitle !== currentTitle ? { checked: applyTitle, onChange: setApplyTitle } : undefined}
        current={currentTitle}
        next={igdbTitle}
      />

      <InlineSection
        label="Release date"
        // Nothing to decide when IGDB has no date, or the same one.
        toggle={
          igdbDate && igdbDate !== current.releaseDate ? { checked: applyDate, onChange: setApplyDate } : undefined
        }
        current={current.releaseDate && date(current.releaseDate)}
        next={igdbDate && date(igdbDate)}
      />

      <PlatformSection
        igdbPlatforms={igdbPlatforms}
        selected={igdbPlatform}
        onSelect={(platform) => {
          setIgdbPlatform(platform)
          setPlatformChoice(platformDefault(platform))
        }}
        choice={platformChoice}
        onChoiceChange={setPlatformChoice}
        records={platforms}
        current={current.platform}
        // Struck through only when it would actually change.
        replaced={Boolean(platformResolution && changesPlatform(platformResolution, current.platformId, true))}
        apply={applyPlatform}
        onApplyChange={setApplyPlatform}
      />

      <CompanySection
        label="Developers"
        companies={candidate.developers}
        choices={developerChoices}
        onChoicesChange={setDeveloperChoices}
        records={developers}
        current={current.developers}
        apply={applyDevelopers}
        onApplyChange={setApplyDevelopers}
      />
      <CompanySection
        label="Publishers"
        companies={candidate.publishers}
        choices={publisherChoices}
        onChoicesChange={setPublisherChoices}
        records={publishers}
        current={current.publishers}
        apply={applyPublishers}
        onApplyChange={setApplyPublishers}
      />

      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!changesSomething} onClick={() => onApply(result)}>
          Apply
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        {/* Otherwise an Apply with every switch off would seem to do
            nothing at all. */}
        {onlyLinks && <span className="min-w-0 text-xs text-ink-faint">Only links the game to IGDB</span>}
      </div>
    </div>
  )
}

interface ConfirmSectionProps {
  label: string
  /** The switch for whether IGDB's value goes in. Left out when there is
   * nothing to decide. */
  toggle?: { checked: boolean; onChange: (checked: boolean) => void }
  /** What the field keeps while the switch is off, shown next to the label
   * in place of the section's body. */
  kept?: string
  children: ReactNode
}

function ConfirmSection({ label, toggle, kept, children }: ConfirmSectionProps) {
  const open = toggle?.checked ?? true

  return (
    <div className="flex flex-col">
      <div className="flex h-5 items-baseline gap-3">
        <span className="shrink-0 text-[13px] font-medium text-ink-muted">{label}</span>
        <span
          className={[
            'min-w-0 flex-1 truncate text-sm text-ink transition-opacity duration-150',
            open ? 'opacity-0' : 'opacity-100',
          ].join(' ')}
          aria-hidden={open}
        >
          {kept}
        </span>
        {toggle && (
          <span className="self-center">
            <Switch checked={toggle.checked} onChange={toggle.onChange}>
              <span className="sr-only">Use IGDB’s {label.toLowerCase()}</span>
            </Switch>
          </span>
        )}
      </div>
      <Reveal open={open}>
        <div className="pt-1.5">{children}</div>
      </Reveal>
    </div>
  )
}

interface InlineSectionProps {
  label: string
  toggle?: { checked: boolean; onChange: (checked: boolean) => void }
  /** What the field holds now, already formatted; empty for nothing. */
  current: string
  /** IGDB's value, already formatted; empty when IGDB has none. */
  next: string
}

/**
 * A section whose value is a single line (the title, the release date): the
 * value sits next to its label, the replaced one struck through before the
 * new one, and only drops below the label when the two do not fit side by
 * side. The switch stays put in the top corner either way.
 */
function InlineSection({ label, toggle, current, next }: InlineSectionProps) {
  const replacing = toggle?.checked ?? false

  let value: ReactNode
  if (replacing) {
    // Short of room, only the struck-through value gives way: what is about
    // to go in matters more than what is about to go, which keeps just
    // enough of itself (3ch, past the gap) to show that something goes.
    value = (
      <>
        {current && <Replaced className="min-w-[3ch]">{current}</Replaced>}
        <span
          className={['truncate text-ink', current ? 'max-w-[calc(100%-3ch-0.5rem)] shrink-0' : 'min-w-0'].join(' ')}
        >
          {next}
        </span>
      </>
    )
  } else if (!next) {
    value = (
      <>
        {current && <span className="min-w-0 truncate text-ink">{current}</span>}
        <span className="shrink-0 text-ink-faint">Not on IGDB</span>
      </>
    )
  } else {
    value = current ? (
      <span className="min-w-0 truncate text-ink">{current}</span>
    ) : (
      <span className="text-ink-faint">—</span>
    )
  }

  return (
    // Inline flow around a floated switch rather than flex: the switch only
    // takes room from the first line, so a value that drops below the label
    // gets the full width of the line it lands on.
    <div className="leading-6">
      {toggle && (
        <span className="float-right ml-3 flex h-6 items-center">
          <Switch checked={toggle.checked} onChange={toggle.onChange}>
            <span className="sr-only">Use IGDB’s {label.toLowerCase()}</span>
          </Switch>
        </span>
      )}
      <span className="mr-3 text-[13px] font-medium text-ink-muted">{label}</span>
      {/* Keyed by what it shows, so that switching fades the new value in
          rather than swapping it in a single frame. */}
      <span
        key={replacing ? 'replacing' : 'keeping'}
        className="inline-flex max-w-full min-w-0 animate-[gl-appear_150ms_ease-out] items-baseline gap-2 align-baseline text-sm motion-reduce:animate-none"
      >
        {value}
      </span>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-faint">{children}</p>
}

/** A value the section would replace. */
function Replaced({ children, className = 'min-w-0' }: { children: ReactNode; className?: string }) {
  return <s className={`truncate text-ink-faint decoration-ink-faint ${className}`}>{children}</s>
}

interface PlatformSectionProps {
  igdbPlatforms: PlatformMatch[]
  selected: PlatformMatch | undefined
  onSelect: (platform: PlatformMatch) => void
  choice: Choice
  onChoiceChange: (choice: Choice) => void
  records: Lookup[]
  /** The form's platform, by name; empty for none. */
  current: string
  /** Whether the form's platform would be replaced. */
  replaced: boolean
  apply: boolean
  onApplyChange: (apply: boolean) => void
}

/**
 * The platform the game is logged on: one of IGDB's (a game only has one),
 * and where it goes in the library, laid out like a company's row with the
 * IGDB side picked rather than given.
 */
function PlatformSection({
  igdbPlatforms,
  selected,
  onSelect,
  choice,
  onChoiceChange,
  records,
  current,
  replaced,
  apply,
  onApplyChange,
}: PlatformSectionProps) {
  return (
    <ConfirmSection
      label="Platform"
      toggle={selected ? { checked: apply, onChange: onApplyChange } : undefined}
      kept={current || undefined}
    >
      {!selected ? (
        <Muted>Not on IGDB</Muted>
      ) : (
        <div className="flex flex-col gap-1.5">
          {current && replaced && (
            <p className="flex text-sm">
              <Replaced>{current}</Replaced>
            </p>
          )}
          {/* IGDB's side reads as plain text, like a company's name, and only
              the library's side is a field. The IGDB side takes no more room
              than its name. */}
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              {igdbPlatforms.length === 1 ? (
                <span className="block truncate text-sm text-ink" title={`${selected.name} on IGDB`}>
                  {selected.name}
                </span>
              ) : (
                <Dropdown
                  aria-label="Platform on IGDB"
                  value={String(selected.igdb_platform_id)}
                  onChange={(value) => {
                    const platform = igdbPlatforms.find((p) => String(p.igdb_platform_id) === value)
                    if (platform) onSelect(platform)
                  }}
                  options={igdbPlatforms.map((platform) => ({
                    value: String(platform.igdb_platform_id),
                    label: platform.name,
                  }))}
                  className="h-8 max-w-full rounded-control text-sm text-ink transition-colors duration-75 hover:text-ink-muted"
                />
              )}
            </div>
            <Leader />
            <RecordChoice
              // Remounted per IGDB platform, so that a search typed for one
              // does not linger for the next.
              key={selected.igdb_platform_id}
              match={selected.match}
              createName={platformName(selected)}
              isLinked={(id) =>
                isLinkedToPlatform(
                  records.find((r) => r.id === id),
                  selected,
                )
              }
              linkTitle="Linked to this IGDB platform when the game is saved"
              skippable={false}
              choice={choice}
              records={records}
              onChange={onChoiceChange}
            />
          </div>
        </div>
      )}
    </ConfirmSection>
  )
}

interface CompanySectionProps {
  label: string
  companies: CompanyMatch[]
  choices: Choice[]
  onChoicesChange: (choices: Choice[]) => void
  records: Lookup[]
  current: string[]
  apply: boolean
  onApplyChange: (apply: boolean) => void
}

function CompanySection({
  label,
  companies,
  choices,
  onChoicesChange,
  records,
  current,
  apply,
  onApplyChange,
}: CompanySectionProps) {
  const currentNames = current.join(', ')

  return (
    <ConfirmSection
      label={label}
      toggle={companies.length > 0 ? { checked: apply, onChange: onApplyChange } : undefined}
      kept={currentNames || undefined}
    >
      {companies.length === 0 ? (
        <Muted>Not on IGDB</Muted>
      ) : (
        <div className="flex flex-col gap-1.5">
          {currentNames && (
            <p className="flex text-sm">
              <Replaced>{currentNames}</Replaced>
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {companies.map((company, index) => {
              const skipped = choices[index].kind === 'skip'
              return (
                <li key={company.igdb_company_id} className="flex items-center gap-2">
                  <span
                    className={[
                      'min-w-0 truncate text-sm transition-colors duration-150',
                      skipped ? 'text-ink-faint line-through decoration-ink-faint' : 'text-ink',
                    ].join(' ')}
                    title={`${company.name} on IGDB`}
                  >
                    {company.name}
                  </span>
                  <Leader />
                  <RecordChoice
                    match={company.match}
                    createName={recordName(company.name)}
                    isLinked={(id) => company.match?.reason === 'linked' && company.match.id === id}
                    linkTitle="Linked to this IGDB company when the game is saved"
                    choice={choices[index]}
                    records={records}
                    onChange={(choice) => onChoicesChange(choices.map((c, i) => (i === index ? choice : c)))}
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </ConfirmSection>
  )
}

interface RecordChoiceProps {
  /** The record IGDB's company or platform was matched to, if any. */
  match: MatchTarget | null
  /** What a new record would be called. */
  createName: string
  /** Whether a record is linked to this IGDB company or platform already. */
  isLinked: (id: number) => boolean
  /** What the `link` mark says on hover. */
  linkTitle: string
  /** Whether Skip is on offer: it is for a company, one of several, but not
   * for a platform, which its section's switch already leaves out. */
  skippable?: boolean
  choice: Choice
  records: Lookup[]
  onChange: (choice: Choice) => void
}

/**
 * Where one company or platform goes: a record of the library (the one it
 * was matched to comes first), a new record named as on IGDB, or nowhere.
 * Searchable, since a library's developers can run into the hundreds (see
 * MultiSelectDropdown).
 */
function RecordChoice({
  match,
  createName,
  isLinked,
  linkTitle,
  skippable = true,
  choice,
  records,
  onChange,
}: RecordChoiceProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
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

  const matchId = match?.id
  const foldedQuery = foldCase(query.trim())
  const ordered = [...records.filter((r) => r.id === matchId), ...records.filter((r) => r.id !== matchId)]
  const filtered = ordered.filter((record) => foldCase(record.name).includes(foldedQuery))

  function pick(next: Choice) {
    onChange(next)
    setQuery('')
    setOpen(false)
  }

  // The trigger never repeats IGDB's name, already on the left: it only
  // says where it goes.
  let label: ReactNode
  if (choice.kind === 'existing') {
    // A record not yet linked to this IGDB company or platform gets linked
    // on save, which is worth saying; one already linked to it is simply the
    // record.
    const linking = !isLinked(choice.id)
    label = (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate">{records.find((r) => r.id === choice.id)?.name ?? match?.name}</span>
        {linking && <LinkMark title={linkTitle}>link</LinkMark>}
      </span>
    )
  } else if (choice.kind === 'create') {
    label = (
      <>
        <PlusIcon className="size-3.5 shrink-0 text-accent" />
        <span className="truncate">Create new</span>
      </>
    )
  } else {
    label = <span className="truncate text-ink-faint">Skip</span>
  }

  const isSelected = (next: Choice) =>
    next.kind === choice.kind && (next.kind !== 'existing' || (choice.kind === 'existing' && next.id === choice.id))

  return (
    <div className="relative w-36 shrink-0 sm:w-52" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/trigger flex h-8 w-full items-center gap-1.5 rounded-control bg-surface px-2.5 text-left text-sm text-ink"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-ink-faint transition-colors duration-75 group-hover/trigger:text-ink" />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-10 mt-1 w-56 animate-[gl-appear_100ms_ease-out] overflow-hidden rounded-control bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.18)] motion-reduce:animate-none">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="max-h-52 overflow-y-auto border-t border-line p-1">
            <ChoiceRow selected={isSelected({ kind: 'create' })} onClick={() => pick({ kind: 'create' })}>
              <PlusIcon className="size-3.5 shrink-0 text-accent" />
              <span className="truncate">Create “{createName}”</span>
            </ChoiceRow>
            {skippable && (
              <ChoiceRow selected={isSelected({ kind: 'skip' })} onClick={() => pick({ kind: 'skip' })}>
                <span className="truncate">Skip</span>
              </ChoiceRow>
            )}
            {filtered.length > 0 && <div className="mx-1 my-1 border-t border-line" />}
            {filtered.map((record) => (
              <ChoiceRow
                key={record.id}
                selected={isSelected({ kind: 'existing', id: record.id })}
                onClick={() => pick({ kind: 'existing', id: record.id })}
              >
                <span className="truncate">{record.name}</span>
              </ChoiceRow>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The dotted line from what IGDB says to where it goes in the library, the
 * way a table of contents leads from a chapter to its page: it reads as
 * "this one is that one" without a word, and fills the gap between the two
 * sides whatever their widths. At least a few dots long, so that it never
 * disappears next to a long name.
 */
function Leader() {
  return <span aria-hidden="true" className="min-w-4 flex-1 self-center border-t-2 border-dotted border-line-strong" />
}

/** A small accent word next to a name, about its link to IGDB. */
function LinkMark({ title, children }: { title: string; children: ReactNode }) {
  return (
    // On the baseline its capitals are shorter than the name's and read as
    // sitting low; lifted by 1.5px (measured), they centre on the name's
    // capitals instead.
    <span
      title={title}
      className="relative -top-[1px] shrink-0 text-[10px] leading-none font-semibold tracking-wide text-accent uppercase"
    >
      {children}
    </span>
  )
}

function ChoiceRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-sm transition-colors duration-75',
        selected ? 'text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
      ].join(' ')}
    >
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {selected && <CheckIcon className="size-3.5 shrink-0 text-accent" />}
    </button>
  )
}
