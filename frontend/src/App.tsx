import { useEffect, type ReactNode } from 'react'

import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { errorMessage, UnreachableError } from './api/client'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useReconnect } from './hooks/useOffline'
import { useOfflineSync } from './hooks/useOfflineSync'
import { useScrollbarFade } from './hooks/useScrollbarFade'
import { useSession } from './hooks/useSession'
import { useSetupStatus } from './hooks/useSetup'
import { useTapFeedback } from './hooks/useTapFeedback'
import { useTruncationTooltip } from './hooks/useTruncationTooltip'
import { clearOfflineCache, persistOptions } from './lib/offlineCache'
import { clearImageCache } from './lib/serviceWorker'
import { Account } from './pages/Account'
import { Admin } from './pages/Admin'
import { Dashboard } from './pages/Dashboard'
import { GameDetail } from './pages/GameDetail'
import { ForcedPasswordChange } from './pages/ForcedPasswordChange'
import { GamesPage } from './pages/GamesPage'
import { LookupPage } from './pages/LookupPage'
import { Login } from './pages/Login'
import { Setup } from './pages/Setup'
import { ThemeProvider } from './theme/ThemeProvider'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data only changes when the user edits it, so there is no need to
      // revalidate on window focus.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      // A server that cannot be reached will not be reached a second later
      // either; the app shows what it has and checks back (see useReconnect).
      retry: (failureCount, error) => !(error instanceof UnreachableError) && failureCount < 3,
    },
  },
})

export default function App() {
  useTruncationTooltip()
  useScrollbarFade()
  useTapFeedback()

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      // The copy restored from the device only stands in until the server
      // answers. Even the session and setup queries, which never go stale on
      // their own, are asked again.
      onSuccess={() => queryClient.invalidateQueries()}
    >
      <ThemeProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </ThemeProvider>
    </PersistQueryClientProvider>
  )
}

/** The queries Gate itself keeps observing whoever is signed in. */
const GATE_QUERIES = new Set(['session', 'setup', 'health'])

/**
 * Decides which of the four screens the application is showing.
 *
 * What to show follows entirely from whether the deployment is set up and who
 * is signed in; once past that, the routes below decide which view of the
 * signed-in account's own screens is on.
 */
function Gate() {
  const setup = useSetupStatus()
  const session = useSession()
  const queryClient = useQueryClient()
  useReconnect()

  // A session the server ended on its own (it expired, or the password was
  // changed elsewhere) would otherwise leave the account's library behind,
  // in memory and in the copy on the device, for whoever signs in next.
  // Signing out deliberately clears it already (see useLogout).
  useEffect(() => {
    if (session.data !== null) return
    queryClient.removeQueries({ predicate: (query) => !GATE_QUERIES.has(String(query.queryKey[0])) })
    void clearOfflineCache()
    void clearImageCache()
  }, [session.data, queryClient])

  // Restoring the copy on the device takes a moment on every page load,
  // too short to be worth a word: the canvas stays empty unless it drags on.
  if (setup.isPending || session.isPending) {
    return (
      <Centred>
        <span className="appear-late block">Loading…</span>
      </Centred>
    )
  }

  // If even the setup check failed, the API is not answering at all: nothing
  // below would work, and saying so beats a login form that cannot log in.
  // Unless there is a copy of it from an earlier visit, which is all the
  // offline mode needs.
  if (setup.isError && !setup.data) {
    return (
      <Centred>
        <span className="text-ink">Gamelog cannot reach its API.</span>
        <span className="mt-1 block">{errorMessage(setup.error)}</span>
        <span className="mt-3 block">
          In development, check that the backend is running with{' '}
          <code className="rounded-[3px] bg-sunken px-1 py-0.5 text-ink-muted">air</code> in{' '}
          <code className="rounded-[3px] bg-sunken px-1 py-0.5 text-ink-muted">backend/</code>.
        </span>
      </Centred>
    )
  }

  if (setup.data?.pending) {
    return <Setup adminUsername={setup.data.admin_username} />
  }

  if (!session.data) {
    return <Login />
  }

  if (session.data.must_change_password) {
    return <ForcedPasswordChange />
  }

  return (
    <AppShell user={session.data}>
      <ErrorBoundary>{session.data.is_admin ? <Admin admin={session.data} /> : <UserRoutes />}</ErrorBoundary>
    </AppShell>
  )
}

/** The routes a regular account can reach: its library, and its own account. */
function UserRoutes() {
  useOfflineSync()

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/games" element={<GamesPage />} />
      <Route path="/games/:id" element={<GameDetail />} />
      <Route path="/genres" element={<LookupPage kind="genres" title="Genres" />} />
      <Route path="/developers" element={<LookupPage kind="developers" title="Developers" />} />
      <Route path="/publishers" element={<LookupPage kind="publishers" title="Publishers" />} />
      <Route path="/platforms" element={<LookupPage kind="platforms" title="Platforms" />} />
      <Route path="/account" element={<Account />} />
    </Routes>
  )
}

/** The whole viewport, with one quiet paragraph in the middle of it. */
function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <p className="max-w-85 text-[13px] leading-relaxed text-ink-muted">{children}</p>
    </div>
  )
}
