export interface FuzzyMatch {
  score: number
  /** Indices into the matched text that the query's characters landed on. */
  indices: number[]
}

/**
 * Lowercases and strips diacritics ("Pokémon" -> "pokemon") so accents don't
 * have to be typed to match. Decomposing and dropping combining marks keeps
 * one character in, one character out, so the result stays index-aligned
 * with the original string for highlighting.
 */
export function foldCase(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Matches `query` against `text` as a subsequence — letters can skip around,
 * as long as they appear in order — and scores the result so that tighter,
 * earlier, word-start matches rank above scattered ones. Returns null when
 * `query` isn't a subsequence of `text` at all.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = foldCase(query.trim())
  if (!q) return { score: 0, indices: [] }
  const t = foldCase(text)

  const indices: number[] = []
  let qi = 0
  let score = 0
  let prevIndex = -1
  let streak = 0

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue

    streak = ti === prevIndex + 1 ? streak + 1 : 0
    score += 1 + streak * 2
    if (ti === 0 || /[\s\-:_.]/.test(t[ti - 1])) score += 3

    indices.push(ti)
    prevIndex = ti
    qi++
  }

  if (qi < q.length) return null

  // Slight preference for shorter titles when scores would otherwise tie.
  return { score: score - t.length * 0.01, indices }
}

/** The best `limit` matches of `query` against `items`, ranked highest first. */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
  limit = 8,
): { item: T; match: FuzzyMatch }[] {
  if (!query.trim()) return []

  const matches: { item: T; match: FuzzyMatch }[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item))
    if (match) matches.push({ item, match })
  }

  matches.sort((a, b) => b.match.score - a.match.score)
  return matches.slice(0, limit)
}
