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

/** Which of the fields Identify fills are still empty on the form. Identify
 * never overwrites anything: a field with a value is shown as kept. */
export interface IdentifyFill {
  releaseDate: boolean
  developers: boolean
  publishers: boolean
}

/** What one role (developers or publishers) resolves to: records the library
 * already has, links to write for them, and records to create on save. */
export interface CompanyResolution {
  ids: number[]
  links: CompanyLink[]
  pending: NewLookup[]
}

/** What Apply hands back to the form. A field that was not empty, or that
 * IGDB had nothing for, is left out. */
export interface IdentifyResult {
  /** yyyy-mm-dd, the form's own date shape. */
  releaseDate?: string
  developers?: CompanyResolution
  publishers?: CompanyResolution
}

interface IdentifyPanelProps {
  title: string
  fill: IdentifyFill
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
 * remake share one): pick the game, then confirm what it would fill in. In
 * the second step every developer and publisher can be pointed at a record
 * the library already has, created, or skipped. Apply only changes the form;
 * nothing is created or linked until the game is saved.
 */
export function IdentifyPanel({ title, fill, developers, publishers, onApply, onClose }: IdentifyPanelProps) {
  const candidates = useGameCandidates(title)
  const [picked, setPicked] = useState<GameCandidate | null>(null)

  return (
    <div className="flex flex-col gap-3 rounded-control bg-sunken p-3">
      <div className="flex items-center justify-between gap-2">
        {picked ? (
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="-ml-1 inline-flex items-center gap-1 rounded-control px-1 text-[13px] font-medium text-ink-muted hover:text-ink"
          >
            <ChevronLeftIcon className="size-3.5" />
            Results
          </button>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-medium text-ink-muted">
            IGDB results for “{title}”
          </span>
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

      {picked ? (
        <IdentifyConfirm
          candidate={picked}
          fill={fill}
          developers={developers}
          publishers={publishers}
          onApply={onApply}
          onCancel={onClose}
        />
      ) : candidates.isPending ? (
        <p className="text-sm text-ink-faint">Searching IGDB…</p>
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
      if (!alreadyLinked) resolution.links.push({ id: choice.id, igdb_company_id: company.igdb_company_id })
    } else if (choice.kind === 'create') {
      const name = foldCase(company.name)
      if (!resolution.pending.some((p) => foldCase(p.name) === name)) {
        resolution.pending.push({ name: company.name, igdb_company_id: company.igdb_company_id })
      }
    }
  })

  return resolution
}

function hasAny(resolution: CompanyResolution): boolean {
  return resolution.ids.length > 0 || resolution.pending.length > 0
}

interface IdentifyConfirmProps {
  candidate: GameCandidate
  fill: IdentifyFill
  developers: Lookup[]
  publishers: Lookup[]
  onApply: (result: IdentifyResult) => void
  onCancel: () => void
}

function IdentifyConfirm({ candidate, fill, developers, publishers, onApply, onCancel }: IdentifyConfirmProps) {
  const dateFormat = useDateFormat()
  const [developerChoices, setDeveloperChoices] = useState(() => candidate.developers.map(defaultChoice))
  const [publisherChoices, setPublisherChoices] = useState(() => candidate.publishers.map(defaultChoice))

  const result: IdentifyResult = {}
  if (fill.releaseDate && candidate.release_date) {
    result.releaseDate = candidate.release_date.slice(0, 10)
  }
  if (fill.developers) {
    const resolution = resolve(candidate.developers, developerChoices)
    if (hasAny(resolution)) result.developers = resolution
  }
  if (fill.publishers) {
    const resolution = resolve(candidate.publishers, publisherChoices)
    if (hasAny(resolution)) result.publishers = resolution
  }
  const changesSomething = Object.keys(result).length > 0

  const year = releaseYear(candidate)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-ink">
        {candidate.name}
        {year && <span className="font-normal text-ink-faint"> ({year})</span>}
      </p>

      <ConfirmSection label="Release date">
        {!fill.releaseDate ? (
          <Kept />
        ) : candidate.release_date ? (
          <span className="text-sm text-ink">{formatDate(candidate.release_date.slice(0, 10), dateFormat)}</span>
        ) : (
          <Missing />
        )}
      </ConfirmSection>

      <CompanySection
        label="Developers"
        fill={fill.developers}
        companies={candidate.developers}
        choices={developerChoices}
        onChoicesChange={setDeveloperChoices}
        records={developers}
      />
      <CompanySection
        label="Publishers"
        fill={fill.publishers}
        companies={candidate.publishers}
        choices={publisherChoices}
        onChoicesChange={setPublisherChoices}
        records={publishers}
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

function ConfirmSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      {children}
    </div>
  )
}

function Kept() {
  return <span className="text-sm text-ink-faint">Already set, kept as it is</span>
}

function Missing() {
  return <span className="text-sm text-ink-faint">Not on IGDB</span>
}

interface CompanySectionProps {
  label: string
  fill: boolean
  companies: CompanyMatch[]
  choices: Choice[]
  onChoicesChange: (choices: Choice[]) => void
  records: Lookup[]
}

function CompanySection({ label, fill, companies, choices, onChoicesChange, records }: CompanySectionProps) {
  return (
    <ConfirmSection label={label}>
      {!fill ? (
        <Kept />
      ) : companies.length === 0 ? (
        <Missing />
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((company, index) => (
            <li
              key={company.igdb_company_id}
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="min-w-0 truncate text-sm text-ink" title={`${company.name} on IGDB`}>
                {company.name}
              </span>
              <CompanyChoice
                company={company}
                choice={choices[index]}
                records={records}
                onChange={(choice) => onChoicesChange(choices.map((c, i) => (i === index ? choice : c)))}
              />
            </li>
          ))}
        </ul>
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
 * Where one company goes: the record it was matched to, any other record of
 * the library, a new record, or nowhere. Searchable, since a library's
 * developers can run into the hundreds (see MultiSelectDropdown).
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

  const match = company.match
  const foldedQuery = foldCase(query.trim())
  // The match first, then the rest of the library in its own order.
  const ordered = match ? [...records.filter((r) => r.id === match.id), ...records.filter((r) => r.id !== match.id)] : records
  const filtered = ordered.filter((record) => foldCase(record.name).includes(foldedQuery))

  function pick(next: Choice) {
    onChange(next)
    setQuery('')
    setOpen(false)
  }

  function badge(id: number) {
    if (match?.id !== id) return null
    return (
      <span className="shrink-0 text-[10px] font-semibold tracking-wide text-accent uppercase">
        {match.reason === 'linked' ? 'linked' : 'suggested'}
      </span>
    )
  }

  let label: ReactNode
  if (choice.kind === 'existing') {
    const record = records.find((r) => r.id === choice.id)
    label = (
      <>
        <span className="truncate">{record?.name ?? match?.name}</span>
        {badge(choice.id)}
      </>
    )
  } else if (choice.kind === 'create') {
    label = (
      <>
        <span className="truncate">Create “{company.name}”</span>
        <span className="shrink-0 text-[10px] font-semibold tracking-wide text-accent uppercase">new</span>
      </>
    )
  } else {
    label = <span className="truncate text-ink-faint">Skip</span>
  }

  const isSelected = (next: Choice) =>
    next.kind === choice.kind && (next.kind !== 'existing' || (choice.kind === 'existing' && next.id === choice.id))

  return (
    <div className="relative w-full shrink-0 sm:w-56" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-1.5 rounded-control bg-surface px-2.5 text-left text-sm text-ink"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{label}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-10 mt-1 w-full min-w-56 overflow-hidden rounded-control bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
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
              <span className="truncate text-accent">Create “{company.name}”</span>
            </ChoiceRow>
            <ChoiceRow selected={isSelected({ kind: 'skip' })} onClick={() => pick({ kind: 'skip' })}>
              <span className="truncate">Skip</span>
            </ChoiceRow>
            {filtered.length > 0 && <div className="my-1 border-t border-line" />}
            {filtered.map((record) => (
              <ChoiceRow
                key={record.id}
                selected={isSelected({ kind: 'existing', id: record.id })}
                onClick={() => pick({ kind: 'existing', id: record.id })}
              >
                <span className="truncate">{record.name}</span>
                {badge(record.id)}
              </ChoiceRow>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ChoiceRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
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
