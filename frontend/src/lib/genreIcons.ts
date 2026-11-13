/** How a genre's icon names one of Tabler's icons rather than holding an
 * emoji: `tabler:swords`. See LookupIcon. */
const ICON_PREFIX = 'tabler:'

/** Where genreIconsPlugin (vite.config.ts) serves the icons from. */
export const GENRE_ICONS_PATH = '/genre-icons/'

/** The Tabler icon a genre's icon names, or null for an emoji. */
export function iconName(value: string): string | null {
  if (!value.startsWith(ICON_PREFIX)) return null
  const name = value.slice(ICON_PREFIX.length)
  return /^[a-z0-9-]+$/.test(name) ? name : null
}

/** The value a genre stores for one of Tabler's icons. */
export function iconValue(name: string): string {
  return ICON_PREFIX + name
}

/** An icon's name as people read it: "ball-football" is "Ball football". */
export function iconLabel(name: string): string {
  const words = name.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The colour a genre's icon is drawn in: its own, where it has one and the
 * icon is one of Tabler's, which an emoji's colours are not. */
export function genreColor(genre: { icon?: string | null; color?: string | null }): string | null {
  return genre.color && genre.icon && iconName(genre.icon) ? genre.color : null
}
