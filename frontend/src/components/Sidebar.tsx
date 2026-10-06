import { useState, type FocusEvent, type MouseEvent, type ReactElement } from 'react'
import { NavLink } from 'react-router-dom'

import { errorMessage } from '../api/client'
import { useHealth } from '../hooks/useHealth'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useLogout } from '../hooks/useSession'
import type { User } from '../types/auth'
import type { Game } from '../types/game'
import { Avatar } from './Avatar'
import { Button } from './Button'
import { GlobalSearch } from './GlobalSearch'
import { Logo } from './Logo'
import {
  BriefcaseIcon,
  BuildingIcon,
  DeviceIcon,
  HomeIcon,
  SearchIcon,
  SidebarIcon,
  SignOutIcon,
  TableIcon,
  TagIcon,
} from './icons'
import { Notice } from './Notice'

interface NavItem {
  to: string
  label: string
  icon: (props: { className?: string }) => ReactElement
  end?: boolean
}

const MAIN_ITEMS: NavItem[] = [{ to: '/', label: 'Dashboard', icon: HomeIcon, end: true }]

const LIBRARY_ITEMS: NavItem[] = [
  { to: '/games', label: 'Games', icon: TableIcon },
  { to: '/genres', label: 'Genres', icon: TagIcon },
  { to: '/developers', label: 'Developers', icon: BuildingIcon },
  { to: '/publishers', label: 'Publishers', icon: BriefcaseIcon },
  { to: '/platforms', label: 'Platforms', icon: DeviceIcon },
]

/** Every nav-style row (the main/library links, the account link) shares
 * this exact, unconditional padding — see the component doc comment for
 * why it never changes between collapsed and expanded.
 *
 * A fixed `h-8` rather than vertical padding, deliberately: padding would
 * size the row to its tallest child, and a label's 20px line box is taller
 * than the 16px icon — so every row grew by 4px the moment labels appeared,
 * shoving the whole list down. A fixed height is the same 32px either way,
 * which also keeps a collapsed row's highlight an exact 32×32 square. */
const NAV_ROW_CLASS = 'h-8 w-full items-center gap-2 rounded-control px-2'

interface SidebarProps {
  user: User
  open: boolean
  onClose: () => void
  onSelectGame: (game: Game) => void
  /** Whether the sidebar stays fully open (today's behaviour) or collapses
   * to an icon rail that expands on hover/focus — see useSidebarPinned.
   * Only affects `sm` and up: the mobile drawer (`open`, toggled from
   * AppShell's top bar) always shows the full sidebar regardless, since
   * there is nothing beside it for a rail to save room from. */
  pinned: boolean
  onTogglePinned: () => void
}

/**
 * The permanent left rail: where every view lives.
 *
 * Fixed and overlaying on a phone (toggled from the top bar in AppShell),
 * static and always visible from `sm` up — a sidebar with nothing to hide
 * behind a hamburger on a screen wide enough for it.
 *
 * From `sm` up it also has two modes: pinned (today's behaviour, always the
 * full 16rem) or collapsed to a narrow icon rail that expands back to the
 * full width on hover or keyboard focus, the same pattern most apps with a
 * persistent left nav use.
 *
 * Every row's padding is a *constant* (see NAV_ROW_CLASS) — deliberately
 * never conditioned on whether the rail is collapsed. The collapsed rail's
 * own width (`w-14`) is chosen so that padding, alone, centers a plain icon
 * exactly: container padding + row padding + icon width already sums to
 * the rail's width, with nothing left over. That means an icon never has
 * to jump between a "centered" layout and a "left-aligned" one — it never
 * moves at all. The only thing that changes on hover/focus is whether a
 * label is *rendered* next to it, which the row's own `overflow-hidden`
 * (from the `<aside>` down) simply reveals or hides as the width
 * transitions, rather than something jumping or flickering into place.
 * An earlier version toggled `justify-center` on and off instead, which
 * is a discrete, unanimatable change — exactly what produced the flicker
 * this was rewritten to avoid.
 */
export function Sidebar({ user, open, onClose, onSelectGame, pinned, onTogglePinned }: SidebarProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  // Hover and keyboard focus are tracked separately, not folded into one
  // "interacting" flag: typing in the search box can easily outlast the
  // pointer staying over the sidebar (reading results while the mouse
  // drifts off, say), and a single flag cleared by mouseleave would collapse
  // the rail out from under a still-focused search box.
  const [hovering, setHovering] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)

  const expanded = pinned || hovering || focusWithin
  // Mobile's drawer has nothing beside it to save room from, so it always
  // shows full content regardless of the desktop pin/collapse preference.
  const showFull = !isDesktop || expanded

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false)
  }

  // A click's own focus otherwise lingers on the link it landed on, which
  // kept the rail pinned open — by mouse-independent `:focus-within` — until
  // something else happened to be clicked. Blurring right after navigating
  // lets the rail retract on its own the moment the pointer also leaves,
  // same as it would have if the click had never focused anything.
  function blurAfterClick(event: MouseEvent<HTMLElement>) {
    event.currentTarget.blur()
  }

  /** Collapsing has to clear the hover and focus the click itself just
   * created, or the rail stays open on its own account: the button keeps
   * focus, and the pointer is still inside the sidebar it was clicked in.
   * The pointer ends up outside the narrow rail anyway (the button sits at
   * the far end of the wide one), so the next move back over it re-expands
   * normally. */
  function handleTogglePinned(event: MouseEvent<HTMLElement>) {
    event.currentTarget.blur()
    setHovering(false)
    setFocusWithin(false)
    onTogglePinned()
  }

  return (
    <>
      {/* Always mounted so that it can fade in and out with the drawer;
          pointer-events-none keeps it from swallowing taps while closed. */}
      <div
        className={[
          'fixed inset-0 z-30 bg-black/30 transition-opacity duration-150 ease-out motion-reduce:transition-none sm:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
        Always fixed to the viewport, never a flex sibling of the page
        content: that is what keeps its own height independent of how tall
        the page is, so a long dashboard never drags the sidebar's scroll
        along with it. AppShell offsets the content by its collapsed-or-not
        resting width instead — the wider hover/focus reveal is
        deliberately not reserved, so it overlaps the page like a flyout
        rather than shoving content sideways every time the pointer
        crosses it.
      */}
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={handleBlur}
        className={[
          // An *outset* shadow rather than a real `border-r`, and rather
          // than an inset one: a real border is part of the box model even
          // under border-box sizing (it quietly ate 1px off the content
          // width), while an inset line is painted over the last pixel of
          // the sidebar's own surface — so the surface a centred icon can
          // actually sit in was 55px wide while everything was centred in
          // 56px, leaving every icon a pixel closer to the divider than to
          // the left edge. Painted outside the box, the full 56px is
          // surface and the divider sits on the page's own margin.
          //
          // The shadow is only there while the sidebar is on screen. A
          // closed mobile drawer is parked at -translate-x-full, which ends
          // exactly at x=0, so its outset shadow would be the 1px line left
          // showing on the viewport's left edge.
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-hidden bg-surface sm:shadow-[1px_0_0_0_var(--color-line)]',
          // `translate`, not `transform`: Tailwind v4 implements
          // translate-x-* with the standalone `translate` property, which a
          // `transform` transition does not cover. Listing the wrong one is
          // what made the mobile drawer jump instead of sliding.
          'transition-[translate,width] duration-150 ease-out motion-reduce:transition-none sm:translate-x-0',
          open ? 'translate-x-0 shadow-[1px_0_0_0_var(--color-line)]' : '-translate-x-full',
          pinned ? '' : expanded ? 'sm:w-64' : 'sm:w-14',
        ].join(' ')}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-5 text-ink">
          <Logo className="size-4 shrink-0" />
          {showFull && <span className="truncate text-sm font-semibold tracking-tight">Gamelog</span>}
          {showFull && <VersionTag />}
        </div>

        {/* The real search box can never actually shrink down to icon
            size — its own left/right padding (for the icon and the text)
            already adds up to more than the whole collapsed rail, so
            nothing could make it fit there no matter how this is styled.
            It stays mounted and in its normal place regardless (only
            faded to invisible), so the page's "f" shortcut can still
            focus it — the icon shown in its place is purely decorative
            (`pointer-events-none`), so a click anywhere on it passes
            straight through to the real, currently-invisible input
            underneath rather than needing a separate click handler of its
            own to hand focus off. That matters here specifically: hovering
            the rail to reach the icon already starts expanding the
            sidebar, which would have unmounted a real button mid-click
            before its own onClick ever ran. */}
        <div className="relative shrink-0 px-3 pt-2">
          <div className={showFull ? '' : 'opacity-0'}>
            <GlobalSearch
              onSelect={(game) => {
                onSelectGame(game)
                onClose()
              }}
            />
          </div>
          {!showFull && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-faint" aria-hidden="true">
              <SearchIcon className="size-4" />
            </div>
          )}
        </div>

        <nav className="scrollbar-persistent flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
          <NavGroup items={MAIN_ITEMS} onNavigate={onClose} showFull={showFull} onNavClick={blurAfterClick} />
          <NavGroup
            label="Library"
            items={LIBRARY_ITEMS}
            onNavigate={onClose}
            showFull={showFull}
            onNavClick={blurAfterClick}
          />
        </nav>

        <SidebarFooter
          user={user}
          showFull={showFull}
          showToggle={isDesktop}
          pinned={pinned}
          onTogglePinned={handleTogglePinned}
          onNavClick={blurAfterClick}
        />
      </aside>
    </>
  )
}

/** The deployed version, from GET /api/health. Silent while unknown, rather
 * than showing a placeholder that would just be replaced a moment later.
 *
 * The backend reports "dev" when it has no git tag or commit hash to report
 * instead — i.e. running locally under `air`, not a real deployment — so
 * that one value gets a loud red pill instead of the quiet version string,
 * as a standing reminder this isn't prod. */
function VersionTag() {
  const { data } = useHealth()
  if (!data?.version) return null

  if (data.version === 'dev') {
    return (
      <span
        className="ml-auto shrink-0 rounded-full bg-danger/15 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-danger uppercase"
        title="Development environment"
      >
        dev
      </span>
    )
  }

  return (
    <span className="ml-auto truncate text-[11px] text-ink-faint" title={data.version}>
      {data.version}
    </span>
  )
}

function NavGroup({
  label,
  items,
  onNavigate,
  showFull,
  onNavClick,
}: {
  label?: string
  items: NavItem[]
  onNavigate: () => void
  showFull: boolean
  onNavClick: (event: MouseEvent<HTMLElement>) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* The heading's box is always here, at the same height, whether or
          not there is room to read it — it used to appear only once
          expanded, which shoved every row under it down by its own height
          the instant the sidebar was hovered. Collapsed, it holds a
          hairline instead, which is what a section heading amounts to when
          there's no room for its words. */}
      {label && (
        <div className="flex h-5 items-center px-2">
          {showFull ? (
            <span className="truncate text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</span>
          ) : (
            <span className="h-px w-full bg-line" aria-hidden="true" />
          )}
        </div>
      )}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={(event) => {
            onNavigate()
            onNavClick(event)
          }}
          title={showFull ? undefined : item.label}
          className={({ isActive }) =>
            [
              'flex text-sm transition-colors duration-75',
              NAV_ROW_CLASS,
              isActive ? 'bg-sunken font-medium text-ink' : 'text-ink-muted hover:bg-hover hover:text-ink',
            ].join(' ')
          }
        >
          <item.icon className="size-4 shrink-0" />
          {showFull && <span className="truncate">{item.label}</span>}
        </NavLink>
      ))}
    </div>
  )
}

function SidebarFooter({
  user,
  showFull,
  showToggle,
  pinned,
  onTogglePinned,
  onNavClick,
}: {
  user: User
  showFull: boolean
  showToggle: boolean
  pinned: boolean
  onTogglePinned: (event: MouseEvent<HTMLElement>) => void
  onNavClick: (event: MouseEvent<HTMLElement>) => void
}) {
  const signOut = useLogout()

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-line px-3 py-3">
      <div className="flex items-center gap-1">
        <NavLink
          to="/account"
          onClick={onNavClick}
          title={showFull ? undefined : user.name}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-0.5 py-1.5 text-sm text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink"
        >
          {({ isActive }) => (
            <>
              {/* The active mark is a ring around just the photo, not a
                  rectangle behind the whole row — a photo is already
                  circular, so a rectangular highlight around it always
                  read as an odd, mismatched shape. */}
              <span className={`flex shrink-0 items-center justify-center rounded-full p-0.5 ${isActive ? 'ring-2 ring-accent/50' : ''}`}>
                <Avatar avatarUrl={user.avatar_url} />
              </span>
              {showFull && (
                <span className={`min-w-0 flex-1 truncate ${isActive ? 'font-medium text-ink' : ''}`}>{user.name}</span>
              )}
            </>
          )}
        </NavLink>
        {showFull && showToggle && (
          <Button
            variant="ghost"
            className="px-2!"
            title={pinned ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-label={pinned ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-pressed={pinned}
            onClick={onTogglePinned}
          >
            <SidebarIcon className="size-4" />
          </Button>
        )}
        {showFull && (
          <Button
            variant="ghost"
            className="px-2!"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
          >
            <SignOutIcon className="size-4" />
          </Button>
        )}
      </div>
      {signOut.isError && <Notice tone="error">{errorMessage(signOut.error)}</Notice>}
    </div>
  )
}
