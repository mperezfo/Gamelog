import { useEffect, useRef, useState, type ReactNode } from 'react'

import { errorMessage } from '../api/client'
import { useGameCandidates } from '../hooks/useMetadata'
import { useDateFormat } from '../hooks/useSession'
import { formatDate } from '../lib/format'
import { foldCase } from '../lib/fuzzy'
import type { CompanyLink, NewLookup } from '../types/game'
import type { Lookup } from '../types/lookup'
import type { CompanyMatch, GameCandidate } from '../types/metadata'
import { Button } from './Button'
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, PlusIcon, XIcon } from './icons'
import { Notice } from './Notice'
import { Reveal } from './Reveal'
import { Switch } from './Switch'

/** What the form holds right now for the fields Identify can set. */
export interface IdentifyCurrent {
  title: string
  /** yyyy-mm-dd, or empty. */
  releaseDate: string
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
  title?: string
  /** yyyy-mm-dd, the form's own date shape. */
  releaseDate?: string
  developers?: CompanyResolution
  publishers?: CompanyResolution
}

interface IdentifyPanelProps {
  title: string
  current: IdentifyCurrent
  developers: Lookup[]
  publishers: Lookup[]
  onApply: (result: IdentifyResult) => void
  onClose: () => void
}

/**
 * Looks the title up on IGDB and fills in the release date, developers and
 * publishers from the game picked among the results.
 *
 * Two steps, because a title alone is often ambiguous (an original and its
 * remake share one): pick the game, then confirm what it would change. Apply
 * only changes the form; nothing is created or linked until the game is
 * saved.
 */
export function IdentifyPanel({ title, current, developers, publishers, onApply, onClose }: IdentifyPanelProps) {
  const candidates = useGameCandidates(title)
  const [picked, setPicked] = useState<GameCandidate | null>(null)

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
        ) : candidates.data.length === 0 ? (
          <p className="text-sm text-ink-faint">No games found on IGDB.</p>
        ) : (
          <ul className="-mx-1 flex max-h-80 flex-col overflow-y-auto">
            {candidates.data.map((candidate) => (
              <li key={candidate.igdb_id}>
                <CandidateRow candidate={candidate} onPick={() => setPicked(candidate)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** An ellipsis whose dots bob in turn, to show the search is under way. */
function Dots() {
  return (
    <span aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="inline-block animate-[gl-bob_1.2s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{ animationDelay: `${delay}ms` }}
        >
          .
        </span>
      ))}
    </span>
  )
}

function releaseYear(candidate: GameCandidate): string | null {
  return candidate.release_date ? candidate.release_date.slice(0, 4) : null
}

function CandidateRow({ candidate, onPick }: { candidate: GameCandidate; onPick: () => void }) {
  const details = [releaseYear(candidate), candidate.platforms.join(', ')].filter(Boolean).join(' · ')

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
        <span className="truncate text-sm font-medium text-ink">{candidate.name}</span>
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
      const name = foldCase(company.name)
      if (!resolution.pending.some((p) => foldCase(p.name) === name)) {
        resolution.pending.push({
          name: company.name,
          igdb_company_id: company.igdb_company_id,
        })
      }
    }
  })

  return resolution
}

function isEmpty(resolution: CompanyResolution): boolean {
  return resolution.ids.length === 0 && resolution.pending.length === 0
}

interface IdentifyConfirmProps {
  candidate: GameCandidate
  current: IdentifyCurrent
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
function IdentifyConfirm({ candidate, current, developers, publishers, onApply, onCancel }: IdentifyConfirmProps) {
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

  const developerResolution = resolve(candidate.developers, developerChoices)
  const publisherResolution = resolve(candidate.publishers, publisherChoices)

  const result: IdentifyResult = {}
  if (applyTitle && igdbTitle && igdbTitle !== currentTitle) result.title = igdbTitle
  if (applyDate && igdbDate && igdbDate !== current.releaseDate) result.releaseDate = igdbDate
  // Skipping every company applies nothing, rather than clearing the field.
  if (applyDevelopers && !isEmpty(developerResolution)) result.developers = developerResolution
  if (applyPublishers && !isEmpty(publisherResolution)) result.publishers = publisherResolution
  const changesSomething = Object.keys(result).length > 0

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

      <div className="flex gap-2">
        <Button variant="primary" disabled={!changesSomething} onClick={() => onApply(result)}>
          Apply
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
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
                <li key={company.igdb_company_id} className="flex items-center gap-3">
                  <span
                    className={[
                      'min-w-0 flex-1 truncate text-sm transition-colors duration-150',
                      skipped ? 'text-ink-faint line-through decoration-ink-faint' : 'text-ink',
                    ].join(' ')}
                    title={`${company.name} on IGDB`}
                  >
                    {company.name}
                  </span>
                  <CompanyChoice
                    company={company}
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

interface CompanyChoiceProps {
  company: CompanyMatch
  choice: Choice
  records: Lookup[]
  onChange: (choice: Choice) => void
}

/**
 * Where one company goes: a record of the library (the one it was matched
 * to comes first), a new record named as on IGDB, or nowhere. Searchable,
 * since a library's developers can run into the hundreds (see
 * MultiSelectDropdown).
 */
function CompanyChoice({ company, choice, records, onChange }: CompanyChoiceProps) {
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

  const matchId = company.match?.id
  const foldedQuery = foldCase(query.trim())
  const ordered = [...records.filter((r) => r.id === matchId), ...records.filter((r) => r.id !== matchId)]
  const filtered = ordered.filter((record) => foldCase(record.name).includes(foldedQuery))

  function pick(next: Choice) {
    onChange(next)
    setQuery('')
    setOpen(false)
  }

  // The trigger never repeats the company's name, already on the left: it
  // only says where it goes.
  let label: ReactNode
  if (choice.kind === 'existing') {
    // A record not yet linked to this IGDB company gets linked on save, which
    // is worth saying; one already linked to it is simply the record.
    const linking = !(company.match?.reason === 'linked' && company.match.id === choice.id)
    label = (
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate">{records.find((r) => r.id === choice.id)?.name ?? company.match?.name}</span>
        {linking && (
          // On the baseline its capitals are shorter than the name's and
          // read as sitting low; lifted by 1.5px (measured), they centre on
          // the name's capitals instead.
          <span
            title="Linked to this IGDB company when the game is saved"
            className="relative -top-[1.5px] shrink-0 text-[10px] leading-none font-semibold tracking-wide text-accent uppercase"
          >
            link
          </span>
        )}
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
        className="flex h-8 w-full items-center gap-1.5 rounded-control bg-surface px-2.5 text-left text-sm text-ink"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-ink-faint" />
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
              <span className="truncate">Create “{company.name}”</span>
            </ChoiceRow>
            <ChoiceRow selected={isSelected({ kind: 'skip' })} onClick={() => pick({ kind: 'skip' })}>
              <span className="truncate">Skip</span>
            </ChoiceRow>
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
