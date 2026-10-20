/**
 * Which way to draw the Han characters shared by Chinese, Japanese and
 * Korean, from the first of those among the reader's languages, or null to
 * keep the default (see --gl-font-cjk in index.css).
 */
export function cjkStyle(languages: readonly string[]): 'ja' | 'ko' | 'zh-hans' | 'zh-hant' | null {
  for (const language of languages) {
    const [code, ...rest] = language.toLowerCase().split('-')
    if (code === 'ja') return 'ja'
    if (code === 'ko') return 'ko'
    if (code !== 'zh') continue
    // Traditional where the script says so, or a region that writes it.
    if (rest.includes('hant') || rest.some((part) => ['tw', 'hk', 'mo'].includes(part))) return 'zh-hant'
    return 'zh-hans'
  }
  return null
}
