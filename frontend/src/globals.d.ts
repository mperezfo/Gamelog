/** Identifies the build; see `define` in vite.config.ts. */
declare const __BUILD_ID__: string

/** The icons a genre can be given, in the picker's order, each as its name,
 * its category, its tags (space-separated) and its drawing (the inside of
 * a 24 by 24 SVG); see genreIconsPlugin in vite.config.ts. */
declare module 'virtual:genre-icons' {
  const icons: [name: string, category: string, tags: string, drawing: string][]
  export default icons
}

/** Emoji typed without their U+FE0F, by code points, mapped to the full
 * sequence that has an image; see emojiPlugin in vite.config.ts. */
declare module 'virtual:emoji-aliases' {
  const aliases: Record<string, string>
  export default aliases
}
