import {
  EmojiPicker,
  type EmojiData,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  type SkinTone,
} from 'frimousse'

import { useMediaQuery } from '../hooks/useMediaQuery'
import { COLUMN_WIDTH, COLUMNS } from '../lib/pickerGrid'
import { Emoji } from './Emoji'
import { PanelSearch } from './PickerParts'

/** The newest emoji version the Noto images cover (emoji-datasource-google's
 * major version): anything newer would have no image to show. */
const EMOJI_VERSION = 16

interface EmojiPanelProps {
  /** The search, shared with the Icons tab (see IconField). */
  search: string
  onSearch: (search: string) => void
  onPick: (emoji: string) => void
}

/**
 * The Emoji tab of a genre's icon picker: a searchable picker (frimousse,
 * which only brings the behaviour; everything it draws is styled here),
 * showing every emoji as the same Noto image the rest of the app uses (see
 * Emoji). As in the Icons tab, they run on without a break between groups,
 * and an emoji names itself in its tooltip.
 */
export function EmojiPanel({ search, onSearch, onPick }: EmojiPanelProps) {
  const touch = useMediaQuery('(pointer: coarse)')
  return (
    <EmojiPicker.Root
      resolveEmojiData={loadEmojiData}
      columns={COLUMNS}
      // A header with nothing in it has nothing to keep in view.
      sticky={false}
      onEmojiSelect={({ emoji }) => onPick(emoji)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <PanelSearch>
        <EmojiPicker.Search
          type="text"
          placeholder="Search emoji…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          // Not on a touch screen, where it would bring the keyboard up
          // over the grid; tapping the box searches.
          data-autofocus={touch ? undefined : ''}
          autoFocus={!touch}
          className="h-8 w-full rounded-control bg-field shadow-field px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </PanelSearch>
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
    </EmojiPicker.Root>
  )
}

/** The one category's start (see shapeEmojiData): a little room above the
 * grid, as the Icons tab has, and its name for assistive technology. It
 * cannot be nothing at all: the picker lays out no rows under a header with
 * no height. */
function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className="h-1">
      <span className="sr-only">{category.label}</span>
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
      data-tooltip={emoji.label}
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
 *
 * Every emoji goes into one category, so that the grid runs on from one
 * group to the next without a gap, as the Icons tab does; Emojibase lists
 * them in the order of their groups already.
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
  // Skin tones and hair styles on their own, which are parts of emoji.
  const component = messages.groups.find((group) => group.key === 'component')?.order

  return {
    locale: 'en',
    categories: [{ index: 0, label: 'Emoji' }],
    skinTones: Object.fromEntries(
      messages.skinTones.map((tone) => [tone.key, capitalize(tone.message)]),
    ) as EmojiData['skinTones'],
    emojis: data
      .filter((emoji) => emoji.group !== undefined && emoji.group !== component && emoji.version <= EMOJI_VERSION)
      .map((emoji) => {
        const singleToned = emoji.skins?.filter((skin) => typeof skin.tone === 'number')
        return {
          emoji: emoji.emoji,
          category: 0,
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
