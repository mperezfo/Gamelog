import { useState, type ReactNode } from 'react'

import { useGameModal } from '../hooks/useGameModal'
import { useSidebarPinned } from '../hooks/useSidebarPinned'
import { useLogout } from '../hooks/useSession'
import { useThemeChoice } from '../theme/themeContext'
import type { User } from '../types/auth'
import { Button } from './Button'
import { GamePanel } from './GamePanel'
import { MenuIcon } from './icons'
import { Sidebar } from './Sidebar'
import { ThemeSwitch } from './ThemeSwitch'

interface AppShellProps {
  user: User
  children: ReactNode
}

/**
 * The frame around every view that needs a session.
 *
 * A regular account gets the library sidebar. The admin owns no library, so
 * it gets a bare top bar instead: there is nothing behind Games, Genres or a
 * calendar for it to navigate to, and a sidebar full of links to screens
 * that do not exist for it would be furniture at best and confusing at worst.
 */
export function AppShell({ user, children }: AppShellProps) {
  if (user.is_admin) {
    return <AdminShell user={user}>{children}</AdminShell>
  }

  return <LibraryShell user={user}>{children}</LibraryShell>
}

/**
 * The sidebar is static from `sm` up. Below that it overlays, opened from a
 * slim top bar that exists on mobile only — there is nothing to make room for
 * on desktop, so the bar does not render there at all.
 */
function LibraryShell({ user, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useSidebarPinned()
  // The single instance of the game panel for the whole shell — every page
  // and the sidebar search open it through the same `?modal=` state (see
  // useGameModal), so there is never more than one on screen at once.
  const modal = useGameModal()

  return (
    <div className="h-dvh overflow-hidden">
      <Sidebar
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelectGame={modal.openGame}
        pinned={sidebarPinned}
        onTogglePinned={() => setSidebarPinned(!sidebarPinned)}
      />

      {/* The sidebar is fixed and out of flow, so its width is reserved
          here by hand instead of by a flex row sharing height with it.
          Only its resting width (16rem pinned, 3.5rem collapsed) — the wider
          hover/focus reveal a collapsed sidebar gets is deliberately not
          reserved, so it overlaps the page like a flyout instead of
          shoving content sideways every time the pointer crosses it. */}
      <div className={`flex h-dvh min-w-0 flex-col ${sidebarPinned ? 'sm:pl-64' : 'sm:pl-14'}`}>
        <div className="pad-top-safe shrink-0 border-b border-line sm:hidden">
          <div className="flex h-12 items-center px-3">
            <Button variant="ghost" className="px-2" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <MenuIcon />
            </Button>
            <span className="ml-1 text-sm font-semibold tracking-tight text-ink">Gamelog</span>
          </div>
        </div>

        {/* min-h-0 is what lets a flex item actually shrink to this bounded
            height instead of growing to fit its content — without it, a tall
            page silently pushes main past the viewport instead of scrolling
            inside it. A page like GamesPage that manages its own internal
            scroll region sets h-full and never triggers this one at all. */}
        <main className="pad-bottom-safe min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-persistent">{children}</main>
      </div>

      {(modal.game || modal.creating) && <GamePanel game={modal.game} onClose={modal.close} />}
    </div>
  )
}

function AdminShell({ user, children }: AppShellProps) {
  const { theme, setTheme } = useThemeChoice()
  const signOut = useLogout()

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="pad-top-safe shrink-0 border-b border-line">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink">Gamelog</span>
            <span className="truncate text-[13px] text-ink-faint">{user.name}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeSwitch theme={theme} onChange={setTheme} />
            <Button variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="pad-bottom-safe min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-persistent">{children}</main>
    </div>
  )
}
