/** Identifies the build; see `define` in vite.config.ts. */
declare const __BUILD_ID__: string

/** Emoji typed without their U+FE0F, by code points, mapped to the full
 * sequence that has an image; see emojiPlugin in vite.config.ts. */
declare module 'virtual:emoji-aliases' {
  const aliases: Record<string, string>
  export default aliases
}
