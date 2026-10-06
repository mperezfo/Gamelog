import { ApiStatus } from '../components/ApiStatus'
import { BackupSection } from '../components/BackupSection'
import { ChangePassword } from '../components/ChangePassword'
import { NotificationsSection } from '../components/NotificationsSection'
import { PageContainer } from '../components/PageContainer'
import { ProfileForm } from '../components/ProfileForm'
import { Section } from '../components/Section'
import { Select } from '../components/Select'
import { ThemeSwitch } from '../components/ThemeSwitch'
import { useSession, useUpdatePreferences } from '../hooks/useSession'
import { formatDate } from '../lib/format'
import type { DateFormat, GamesView } from '../types/auth'
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

/** Everything one account can do to itself: how it appears, how the app
 * looks on this device, and its password. */
export function Account() {
  const session = useSession()
  const { theme, setTheme } = useThemeChoice()
  const updatePreferences = useUpdatePreferences()

  if (!session.data) return null
  const user = session.data

  return (
    <PageContainer>
      <div className="flex flex-col gap-10">
        <Section title="Profile" description="What you're called and shown as, throughout the application.">
          <ProfileForm user={session.data} />
        </Section>

        <Section
          title="Appearance"
          description="Theme, date format and default Games view travel with your account, so they follow you to any device you sign in on."
        >
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-ink-muted">Theme</span>
              <ThemeSwitch theme={theme} onChange={setTheme} />
            </div>
            <Select
              label="Date format"
              value={user.date_format}
              onChange={(dateFormat) =>
                updatePreferences.mutate({
                  theme: user.theme,
                  dateFormat,
                  gamesView: user.games_view,
                })
              }
              options={DATE_FORMAT_OPTIONS}
              className="w-auto"
            />
            <Select
              label="Default Games view"
              value={user.games_view}
              onChange={(gamesView) =>
                updatePreferences.mutate({
                  theme: user.theme,
                  dateFormat: user.date_format,
                  gamesView,
                })
              }
              options={GAMES_VIEW_OPTIONS}
              className="w-auto"
            />
          </div>
        </Section>

        <Section
          title="Notifications"
          description="Get a reminder before the games in your library come out. Only the channels your administrator has set up are listed."
        >
          <NotificationsSection />
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

        <div className="flex items-center gap-4 border-t border-line pt-4">
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
      </div>
    </PageContainer>
  )
}
