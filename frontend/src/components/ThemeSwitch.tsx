import { THEMES, type Theme } from '../theme/theme'
import { MonitorIcon, MoonIcon, SunIcon } from './icons'

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Follow the system',
}

const ICONS: Record<Theme, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
}

interface ThemeSwitchProps {
  theme: Theme
  onChange: (theme: Theme) => void
}

/**
 * Three states rather than a toggle, because "follow the system" is a real
 * answer and not the absence of one. Shown as a segmented control so that the
 * current choice is readable without opening anything.
 */
export function ThemeSwitch({ theme, onChange }: ThemeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Theme"
      // p-0.5 (2px) either side of two size-8 (32px) buttons is 36px total —
      // the same height as Select/Field's h-9, so the two line up wherever
      // they sit side by side (see Account's Appearance section).
      className="flex h-9 items-center gap-0.5 rounded-control bg-sunken p-0.5"
    >
      {THEMES.map((option) => {
        const Glyph = ICONS[option]
        const selected = option === theme

        return (
          <button
            key={option}
            type="button"
            title={LABELS[option]}
            aria-label={LABELS[option]}
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={[
              'flex size-8 items-center justify-center rounded-[3px] transition-colors duration-75',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_15_15/0.08)]'
                : 'text-ink-faint hover:text-ink-muted',
            ].join(' ')}
          >
            <Glyph className="size-4" />
          </button>
        )
      })}
    </div>
  )
}
