import { useId, useRef, useState } from 'react'

import { iconLabel, iconName, iconValue } from '../lib/genreIcons'
import { COLUMN_WIDTH } from '../lib/pickerGrid'
import { EmojiPanel } from './EmojiPanel'
import { IconPanel } from './IconPanel'
import { LookupIcon } from './LookupIcon'
import { Popover } from './Popover'

type Tab = 'icons' | 'emoji'

const TAB_NAMES: Record<Tab, string> = { icons: 'Icons', emoji: 'Emoji' }

interface IconFieldProps {
  label: string
  /** The icon (`tabler:<name>`, see LookupIcon), an emoji, or empty for none. */
  value: string
  /** The colour the icon is drawn in, if the genre has one (see ColorField). */
  color?: string | null
  onChange: (value: string) => void
}

/**
 * A labelled genre icon: a popover with two tabs, plain icons (Tabler's, the
 * default) and emoji. It opens on the tab of the value it has, and one search
 * serves both, kept when switching.
 */
export function IconField({ label, value, color, onChange }: IconFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('icons')
  const [search, setSearch] = useState('')

  const icon = value ? iconName(value) : null
  const description = !value ? 'none' : icon ? iconLabel(icon) : value

  function toggle() {
    if (!open) {
      setTab(value && !icon ? 'emoji' : 'icons')
      setSearch('')
    }
    setOpen(!open)
  }

  function pick(next: string) {
    onChange(next)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const remove = value ? () => pick('') : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      <button
        id={id}
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${description}`}
        onClick={toggle}
        className="flex h-9 min-w-16 items-center justify-center rounded-control bg-field shadow-field px-2.5 text-sm text-ink-muted transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {value ? (
          <span className="text-lg leading-none">
            <LookupIcon value={value} color={color} />
          </span>
        ) : (
          <span className="text-ink-faint">None</span>
        )}
      </button>

      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} aria-label={`Pick the ${label.toLowerCase()}`}>
        <div className="flex h-[22rem] w-[19rem] flex-col">
          <div className={`${COLUMN_WIDTH} flex gap-1 pt-2`} role="tablist" aria-label="Kind of icon">
            {(['icons', 'emoji'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={option === tab}
                onClick={() => setTab(option)}
                className={[
                  'rounded-control px-2.5 py-1 text-[13px] font-medium transition-colors duration-75',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  option === tab ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {TAB_NAMES[option]}
              </button>
            ))}
          </div>
          {tab === 'icons' ? (
            <IconPanel
              search={search}
              onSearch={setSearch}
              onPick={(name) => pick(iconValue(name))}
              selected={icon}
              onRemove={remove}
            />
          ) : (
            <EmojiPanel search={search} onSearch={setSearch} onPick={pick} onRemove={remove} />
          )}
        </div>
      </Popover>
    </div>
  )
}
