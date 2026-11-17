/**
 * Where genreIconsPlugin (vite.config.ts) serves each library's icons from,
 * by the prefix a genre's icon has when it names one of them rather than
 * holding an emoji: `tabler:swords`, `lucide:anvil`. See LookupIcon.
 */
const LIBRARIES = new Map([
  ['tabler', '/genre-icons/'],
  ['lucide', '/genre-icons/lucide/'],
])

/** The file a genre's icon is drawn from, or null for an emoji or a library
 * the app does not know. */
export function iconFile(value: string): string | null {
  const match = /^([a-z]+):([a-z0-9-]+)$/.exec(value)
  const dir = match && LIBRARIES.get(match[1])
  return match && dir ? `${dir}${match[2]}.svg` : null
}

/** An icon's name, without its library: "tabler:ball-football" is
 * "ball-football". */
export function iconName(value: string): string {
  return value.slice(value.indexOf(':') + 1)
}

/** An icon's name as people read it: "tabler:ball-football" is "Ball
 * football". */
export function iconLabel(value: string): string {
  const words = iconName(value).replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The colour a genre's icon is drawn in: its own, where it has one and the
 * icon is one of the app's, which an emoji's colours are not. */
export function genreColor(genre: { icon?: string | null; color?: string | null }): string | null {
  return genre.color && genre.icon && iconFile(genre.icon) ? genre.color : null
}
