import { ApiStatus } from '../components/ApiStatus'
import { BackupSection } from '../components/BackupSection'
import { ChangePassword } from '../components/ChangePassword'
import { PageContainer } from '../components/PageContainer'
import { ProfileForm } from '../components/ProfileForm'
import { Section } from '../components/Section'
import { Select } from '../components/Select'
import { SimulateOffline } from '../components/SimulateOffline'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useOffline } from '../hooks/useOffline'
import { usePreference, useSession, useUpdatePreferences } from '../hooks/useSession'
import { formatDate } from '../lib/format'
import { SEARCH_KINDS, type CalendarView, type DateFormat, type GamesView, type SearchKind } from '../types/auth'
import { useThemeChoice } from '../theme/themeContext'

/** The four layouts a date can be shown in, with a sample so the option
 * reads as what it produces rather than as a code. Sampled on a date with a
 * two-digit day and month, so the sample doesn't mislead about padding. */
const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: 'long', label: formatDate('2023-12-31', 'long') },
  { value: 'ymd', label: formatDate('2023-12-31', 'ymd') },
  { value: 'dmy', label: formatDate('2023-12-31', 'dmy') },
  { value: 'mdy', label: formatDate('2023-12-31', 'mdy') },
]

const GAMES_VIEW_OPTIONS: { value: GamesView; label: string }[] = [
  { value: 'table', label: 'Table' },
  { value: 'grid', label: 'Grid' },
]

const CALENDAR_VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: 'release', label: 'Release dates' },
  { value: 'logged', label: 'Logged dates' },
]

/** Which kinds the global search looks through, as toggles: the account
 * stores the ones left out, and the last one still on cannot be turned
 * off, so that the search box always searches something. */
function SearchKindsField({ hidden, onChange }: { hidden: SearchKind[]; onChange: (hidden: SearchKind[]) => void }) {
  const shownCount = SEARCH_KINDS.length - hidden.length

  return (
    <div role="group" aria-label="Kinds the search looks through" className="flex flex-wrap gap-1.5">
      {SEARCH_KINDS.map(({ value, label }) => {
        const shown = !hidden.includes(value)
        const last = shown && shownCount === 1
        return (
          <button
            key={value}
            type="button"
            aria-pressed={shown}
            disabled={last}
            data-tooltip={last ? 'At least one stays on' : undefined}
            onClick={() => onChange(shown ? [...hidden, value] : hidden.filter((kind) => kind !== value))}
            className={[
              'inline-flex items-center rounded-control px-2 py-1 text-xs font-medium transition-colors duration-75',
              shown
                ? 'bg-accent text-accent-ink disabled:cursor-default'
                : 'bg-sunken text-ink-muted enabled:hover:bg-hover enabled:hover:text-ink disabled:opacity-50',
            ].join(' ')}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/** Everything one account can do to itself: how it appears, how the app
 * looks on this device, and its password. */
export function Account() {
  useDocumentTitle('Account')
  const session = useSession()
  const { theme, setTheme } = useThemeChoice()
  const updatePreferences = useUpdatePreferences()
  // Through its default, for an account cached before the setting existed.
  const searchHidden = usePreference('search_hidden')
  const offline = useOffline()

  if (!session.data) return null
  const user = session.data

  return (
    <PageContainer>
      <div className="flex flex-col gap-10">
        {/* Everything here saves to the account, so offline it is all
            disabled at once. */}
        <fieldset disabled={offline} className="contents">
          <Section title="Profile" description="What you're called and shown as, throughout the application.">
            <ProfileForm user={session.data} />
          </Section>

          <Section
            title="Appearance"
            description="Theme, date format and default views travel with your account, so they follow you to any device you sign in on."
          >
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-muted">Theme</span>
                <ThemeSwitch theme={theme} onChange={setTheme} />
              </div>
              <Select
                label="Date format"
                value={user.date_format}
                onChange={(dateFormat) => updatePreferences.mutate({ date_format: dateFormat })}
                options={DATE_FORMAT_OPTIONS}
                className="w-auto"
              />
              <Select
                label="Default Games view"
                value={user.games_view}
                onChange={(gamesView) => updatePreferences.mutate({ games_view: gamesView })}
                options={GAMES_VIEW_OPTIONS}
                className="w-auto"
              />
              <Select
                label="Default calendar view"
                value={user.calendar_view}
                onChange={(calendarView) => updatePreferences.mutate({ calendar_view: calendarView })}
                options={CALENDAR_VIEW_OPTIONS}
                className="w-auto"
              />
            </div>
          </Section>

          <Section
            title="Search"
            description="What the search box at the top of the sidebar looks through. Like the rest, it follows your account."
          >
            <SearchKindsField
              hidden={searchHidden}
              onChange={(hidden) => updatePreferences.mutate({ search_hidden: hidden })}
            />
          </Section>

          <Section
            title="Your password"
            description="Changing it signs out every other browser you are signed in on."
          >
            <ChangePassword />
          </Section>

          <Section
            title="Backup"
            description="Export your whole account, or restore it from a backup made here."
          >
            <BackupSection />
          </Section>
        </fieldset>

        <div className="flex flex-col items-start gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-4">
            <ApiStatus />
            <a
              href="/api/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline"
            >
              API docs
            </a>
          </div>
          {import.meta.env.DEV && <SimulateOffline />}
        </div>
      </div>
    </PageContainer>
  )
}
