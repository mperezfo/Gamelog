import { useId, useRef, useState } from 'react'

import {
  EmojiPicker,
  type EmojiData,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  type SkinTone,
} from 'frimousse'

import { Emoji } from './Emoji'
import { Popover } from './Popover'

/** The picker's grid: COLUMNS emoji buttons of 2.125rem each. The search
 * box, the category names and the footer line up with it as one centred
 * column of the same width. */
const COLUMNS = 8
const COLUMN_WIDTH = 'mx-auto w-[17rem]'

/** The newest emoji version the Noto images cover (emoji-datasource-google's
 * major version): anything newer would have no image to show. */
const EMOJI_VERSION = 16

interface EmojiFieldProps {
  label: string
  /** The emoji, or empty for none. */
  value: string
  onChange: (value: string) => void
}

/**
 * A labelled emoji, in place of a text box filled in with the system's own
 * emoji keyboard: a popover with a searchable picker (frimousse, which only
 * brings the behaviour; everything it draws is styled here), showing every
 * emoji as the same Noto image the rest of the app uses (see Emoji).
 */
export function EmojiField({ label, value, onChange }: EmojiFieldProps) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  function pick(next: string) {
    onChange(next)
    setOpen(false)
    buttonRef.current?.focus()
  }

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
        aria-label={value ? `${label}: ${value}` : `${label}: none`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 min-w-16 items-center justify-center rounded-control bg-field shadow-field px-2.5 text-sm transition-colors duration-75 enabled:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {value ? (
          <span className="text-lg leading-none">
            <Emoji value={value} />
          </span>
        ) : (
          <span className="text-ink-faint">None</span>
        )}
      </button>

      <Popover anchorRef={buttonRef} open={open} onClose={() => setOpen(false)} aria-label={`Pick the ${label.toLowerCase()}`}>
        <EmojiPicker.Root
          resolveEmojiData={loadEmojiData}
          columns={COLUMNS}
          onEmojiSelect={({ emoji }) => pick(emoji)}
          className="flex h-80 w-[19rem] flex-col"
        >
          <div className={`${COLUMN_WIDTH} pt-2 pb-1`}>
            <EmojiPicker.Search
              type="text"
              placeholder="Search emoji…"
              data-autofocus=""
              className="h-8 w-full rounded-control bg-field shadow-field px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </div>
          {/* The scrollbar's gutter on both sides, so that the grid stays in
              the middle: one only on the right was a margin there the
              left did not have, as wide as each browser's scrollbar. */}
          <EmojiPicker.Viewport className="relative flex-1 outline-none" style={{ scrollbarGutter: 'stable both-edges' }}>
            <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-ink-faint">
              Loading…
            </EmojiPicker.Loading>
            <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-ink-faint">
              No emoji found.
            </EmojiPicker.Empty>
            <EmojiPicker.List className="pb-1.5 select-none" components={{ CategoryHeader, Row, Emoji: EmojiButton }} />
          </EmojiPicker.Viewport>
          <div className="shrink-0 border-t border-line">
            <div className={`${COLUMN_WIDTH} flex h-10 items-center justify-between gap-2`}>
              <EmojiPicker.ActiveEmoji>
                {({ emoji }) => <span className="truncate pl-1.5 text-xs text-ink-muted">{emoji?.label ?? ''}</span>}
              </EmojiPicker.ActiveEmoji>
              {value && (
                <button
                  type="button"
                  onClick={() => pick('')}
                  className="shrink-0 rounded-control px-2 py-1 text-xs font-medium text-ink-muted transition-colors duration-75 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </EmojiPicker.Root>
      </Popover>
    </div>
  )
}

function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className="bg-surface pt-2.5 pb-1 text-xs font-medium text-ink-faint">
      <div className={`${COLUMN_WIDTH} px-1.5`}>{category.label}</div>
    </div>
  )
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    // The whole column wide and centred, so that a short row (a search
    // with few results) starts at the left edge of the grid like the rest.
    <div {...props} className={`${COLUMN_WIDTH} scroll-my-1.5`}>
      {children}
    </div>
  )
}

function EmojiButton({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      className="flex size-[2.125rem] items-center justify-center rounded-control text-xl leading-none data-[active]:bg-hover"
    >
      <Emoji value={emoji.emoji} />
    </button>
  )
}

/** The part of an Emojibase entry this reads. */
interface EmojibaseEmoji {
  emoji: string
  label: string
  group?: number
  subgroup?: number
  version: number
  tags?: string[]
  tone?: number | number[]
  skins?: EmojibaseEmoji[]
}

interface EmojibaseMessages {
  groups: { key: string; message: string; order: number }[]
  subgroups: { key: string; message: string; order: number }[]
  skinTones: { key: Exclude<SkinTone, 'none'>; message: string }[]
}

const TONES: SkinTone[] = ['none', 'light', 'medium-light', 'medium', 'medium-dark', 'dark']

let emojiData: Promise<EmojiData> | undefined

/**
 * The picker's emoji, from the Emojibase data bundled with the build rather
 * than fetched from a CDN, so that it works offline and asks no third party.
 *
 * Frimousse's own loader would also drop whatever the system's emoji font
 * cannot draw (flags on Windows, the newest emoji on an older system), which
 * does not apply here: every emoji is drawn as an image. So the data is
 * shaped here instead, the way that loader shapes it, keeping everything up
 * to the version the images cover.
 */
function loadEmojiData(): Promise<EmojiData> {
  emojiData ??= Promise.all([import('emojibase-data/en/data.json'), import('emojibase-data/en/messages.json')]).then(
    ([data, messages]) => shapeEmojiData(data.default as unknown as EmojibaseEmoji[], messages.default as unknown as EmojibaseMessages),
  )
  return emojiData
}

function shapeEmojiData(data: EmojibaseEmoji[], messages: EmojibaseMessages): EmojiData {
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
  const flags = messages.subgroups.find((subgroup) => subgroup.key === 'country-flag')

  return {
    locale: 'en',
    categories: messages.groups
      .filter((group) => group.key !== 'component')
      .map((group) => ({ index: group.order, label: capitalize(group.message) })),
    skinTones: Object.fromEntries(
      messages.skinTones.map((tone) => [tone.key, capitalize(tone.message)]),
    ) as EmojiData['skinTones'],
    emojis: data
      .filter((emoji) => emoji.group !== undefined && emoji.version <= EMOJI_VERSION)
      .map((emoji) => {
        const singleToned = emoji.skins?.filter((skin) => typeof skin.tone === 'number')
        return {
          emoji: emoji.emoji,
          category: emoji.group!,
          version: emoji.version,
          label: capitalize(emoji.label),
          tags: emoji.tags ?? [],
          countryFlag: flags && emoji.subgroup === flags.order ? true : undefined,
          skins: singleToned?.length
            ? (Object.fromEntries(singleToned.map((skin) => [TONES[skin.tone as number], skin.emoji])) as NonNullable<
                EmojiData['emojis'][number]['skins']
              >)
            : undefined,
        }
      }),
  }
}
