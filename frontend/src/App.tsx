import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { errorMessage } from './api/client'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useScrollbarFade } from './hooks/useScrollbarFade'
import { useSession } from './hooks/useSession'
import { useSetupStatus } from './hooks/useSetup'
import { useTruncationTooltip } from './hooks/useTruncationTooltip'
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
    },
  },
})

export default function App() {
  useTruncationTooltip()
  useScrollbarFade()

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

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

  if (setup.isPending || session.isPending) {
    return <Centred>Loading…</Centred>
  }

  // If even the setup check failed, the API is not answering at all: nothing
  // below would work, and saying so beats a login form that cannot log in.
  if (setup.isError) {
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
