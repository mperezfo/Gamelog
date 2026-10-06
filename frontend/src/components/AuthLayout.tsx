import type { ReactNode } from 'react'

import { useThemeChoice } from '../theme/themeContext'
import { ThemeSwitch } from './ThemeSwitch'

interface AuthLayoutProps {
  title: string
  description: string
  children: ReactNode
}

/**
 * The screen shown before there is a session: logging in, and the first run.
 *
 * One column, narrow, vertically centred, with nothing on it but what has to
 * be typed. The theme switch is up in the corner because choosing a theme
 * should not require an account.
 */
export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  const { theme, setTheme } = useThemeChoice()

  return (
    <div className="pad-top-safe pad-bottom-safe flex min-h-dvh flex-col">
      <div className="flex justify-end p-3">
        <ThemeSwitch theme={theme} onChange={setTheme} />
      </div>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:pb-24">
        <div className="w-full max-w-[320px]">
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  )
}
