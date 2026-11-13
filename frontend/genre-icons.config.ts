/**
 * Which Tabler icons a genre can be given (see genreIconsPlugin in
 * vite.config.ts).
 *
 * Tabler has some five thousand icons, most of them interface glyphs that say
 * nothing about a genre: arrows, letters, file and database variants, brand
 * logos. The set offered is what is left after the rules below, applied in
 * this order:
 *
 * 1. Every icon of a category in DROPPED_CATEGORIES goes.
 * 2. So does every modifier variant (DROPPED_SUFFIXES): "car-off",
 *    "map-plus", "trophy-check"... the icon they modify is already there.
 * 3. KEPT puts back single icons of a dropped category that do suit a genre.
 * 4. DROPPED takes out single icons of a kept category that do not.
 *
 * SUGGESTED comes first in the picker, in its own order, and its icons stay
 * in their own category as well.
 *
 * A name that leaves the set stays in the genres that already have it: the
 * icon keeps showing there, it is only no longer offered.
 */

/** The categories of Tabler's icons.json that the picker leaves out. */
export const DROPPED_CATEGORIES = new Set([
  'Arrows',
  'Badges',
  'Brand',
  'Charts',
  'Currencies',
  'Database',
  'Design',
  'Development',
  'Document',
  'Electrical',
  'Extensions',
  'Gender',
  'Gestures',
  'Laundry',
  'Letters',
  'Logic',
  'Math',
  'Numbers',
  'System',
  'Text',
  'Version control',
])

/** The endings of Tabler's modifier variants. */
export const DROPPED_SUFFIXES = [
  'off',
  'plus',
  'minus',
  'check',
  'x',
  'up',
  'down',
  'left',
  'right',
  'share',
  'search',
  'cog',
  'heart',
  'star',
  'bolt',
  'code',
  'dollar',
  'exclamation',
  'question',
  'pause',
  'pin',
  'cancel',
  'edit',
  'lock',
  'discount',
  'spark',
]

/** Icons of a dropped category that are kept anyway. */
export const KEPT = new Set([
  'award',
  'blocks',
  'bolt',
  'bomb',
  'book',
  'book-2',
  'books',
  'brush',
  'bug',
  'bulb',
  'candle',
  'cards',
  'christmas-ball',
  'coffin',
  'crosshair',
  'crown',
  'door',
  'eye',
  'guitar-pick',
  'hammer',
  'hourglass',
  'infinity',
  'key',
  'ladder',
  'lock',
  'magnet',
  'mask',
  'military-award',
  'military-rank',
  'notebook',
  'paint',
  'palette',
  'pray',
  'robot-face',
  'sandbox',
  'shield',
  'shield-checkered',
  'shield-half',
  'shovel',
  'snowboarding',
  'sparkles',
  'spiral',
  'star',
  'stars',
  'ticket',
  'tool',
  'tools',
  'umbrella',
  'wand',
])

/** Icons of a kept category that are left out anyway. */
export const DROPPED = new Set<string>([
  // The numbered and lettered playing cards: one card says it.
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'a', 'j', 'k', 'q'].map((card) => `play-card-${card}`),
])

/** The picker's first category, in this order. */
export const SUGGESTED = [
  'device-gamepad-2',
  'sword',
  'swords',
  'axe',
  'archery-arrow',
  'shield',
  'crosshair',
  'target',
  'bomb',
  'tank',
  'karate',
  'military-award',
  'wand',
  'crown',
  'dragon',
  'treasure-chest',
  'building-castle',
  'mask',
  'sparkles',
  'flame',
  'skull',
  'ghost',
  'pumpkin-scary',
  'coffin',
  'spider',
  'ufo',
  'rocket',
  'planet',
  'robot',
  'puzzle',
  'chess-knight',
  'dice-5',
  'cards',
  'brain',
  'hourglass',
  'map',
  'compass',
  'key',
  'door',
  'book',
  'car',
  'steering-wheel',
  'motorbike',
  'plane',
  'ball-football',
  'ball-basketball',
  'trophy',
  'run',
  'music',
  'palette',
  'brush',
  'hammer',
  'pick',
  'campfire',
  'tent',
  'plant',
  'paw',
  'mushroom',
  'blocks',
  'pacman',
]

/** The name of the picker's first category. */
export const SUGGESTED_CATEGORY = 'Suggested'

/** One entry of Tabler's icons.json, as far as it is read here. */
export interface TablerIcon {
  name: string
  category: string
  tags: (string | number)[]
  styles: { outline?: unknown }
}

/** One icon the picker offers. */
export interface GenreIcon {
  name: string
  category: string
  tags: string[]
}

/** Whether the rules above offer an icon. */
export function isOffered(icon: TablerIcon): boolean {
  if (!icon.styles.outline) return false
  if (KEPT.has(icon.name)) return true
  if (DROPPED.has(icon.name) || DROPPED_CATEGORIES.has(icon.category)) return false
  return !DROPPED_SUFFIXES.some((suffix) => icon.name.endsWith(`-${suffix}`))
}

/**
 * The icons the picker offers, grouped: SUGGESTED first, then every category
 * in alphabetical order, each sorted by name. The icons KEPT from a dropped
 * category make one of their own, "Other".
 */
export function genreIcons(all: Record<string, TablerIcon>): GenreIcon[] {
  const offered = Object.values(all).filter(isOffered)
  const entry = (icon: TablerIcon, category: string): GenreIcon => ({
    name: icon.name,
    category,
    tags: icon.tags.map(String),
  })

  const suggested = SUGGESTED.map((name) => {
    const icon = all[name]
    if (!icon || !isOffered(icon)) throw new Error(`genre-icons.config.ts: suggested icon "${name}" is not offered`)
    return entry(icon, SUGGESTED_CATEGORY)
  })

  const rest = offered
    .map((icon) => entry(icon, DROPPED_CATEGORIES.has(icon.category) ? 'Other' : icon.category))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  return [...suggested, ...rest]
}
