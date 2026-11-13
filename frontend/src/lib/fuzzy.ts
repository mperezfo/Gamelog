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

/** How well a query matched, best first: the name starts with it, a word in
 * it starts with it, it appears inside a word, or only its letters do, in
 * order. Each tier outranks any score within the one below. */
const TIER_PREFIX = 3
const TIER_WORD = 2
const TIER_INSIDE = 1
const TIER_SCATTERED = 0

/** How far apart the tiers' scores are: more than any alignment scores. */
const TIER_WEIGHT = 1000

/** Whether `index` starts a word of the folded `text`. */
function isWordStart(text: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(text[index - 1])
}

function range(from: number, length: number): number[] {
  return Array.from({ length }, (_, i) => from + i)
}

/**
 * Matches `query` against `text` and scores how well, so that the obvious
 * match ranks first: the name starting with the query, then a word starting
 * with it, then the query anywhere inside a word, then its letters scattered
 * in order (see the tiers above). Returns null when the letters are not all
 * there, in order.
 *
 * Every alignment is considered, not just the first occurrence of each
 * letter: "Montr" lands on the "Montr" of "Ubisoft Montreal", not on the M
 * of "Massive", so the highlight shows what actually matched.
 *
 * The score says nothing about the text's length: a list ordered some other
 * way keeps that order among matches as good as each other (see LookupPage).
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = foldCase(query.trim())
  if (!q) return { score: 0, indices: [] }
  const t = foldCase(text)

  // The query as one run: at a word start if any occurrence is.
  let inside = -1
  for (let at = t.indexOf(q); at !== -1; at = t.indexOf(q, at + 1)) {
    if (at === 0) return { score: TIER_PREFIX * TIER_WEIGHT, indices: range(0, q.length) }
    if (isWordStart(t, at)) return { score: TIER_WORD * TIER_WEIGHT, indices: range(at, q.length) }
    if (inside === -1) inside = at
  }
  if (inside !== -1) return { score: TIER_INSIDE * TIER_WEIGHT, indices: range(inside, q.length) }

  return scatteredMatch(q, t)
}

/**
 * The best placement of `q`'s letters, in order, across `t`, both folded:
 * each letter scores a point, more when it starts a word or follows the
 * previous one straight on. A small dynamic programme over every placement,
 * which names are short enough for.
 */
function scatteredMatch(q: string, t: string): FuzzyMatch | null {
  const m = q.length
  const n = t.length
  if (m > n) return null

  // best[i][j]: the best score with q[i] placed on t[j], or -Infinity; from[i][j]:
  // where q[i - 1] went in that placement.
  const best = Array.from({ length: m }, () => new Array<number>(n).fill(-Infinity))
  const from = Array.from({ length: m }, () => new Array<number>(n).fill(-1))

  for (let i = 0; i < m; i++) {
    // The best placement of q[i - 1] strictly before j - 1, kept as j moves.
    let earlier = -Infinity
    let earlierAt = -1
    for (let j = i; j < n; j++) {
      if (i > 0 && j >= 2 && best[i - 1][j - 2] > earlier) {
        earlier = best[i - 1][j - 2]
        earlierAt = j - 2
      }
      if (t[j] !== q[i]) continue

      const own = 1 + (isWordStart(t, j) ? 3 : 0)
      if (i === 0) {
        best[i][j] = own
        continue
      }
      const straightOn = j >= 1 ? best[i - 1][j - 1] + 2 : -Infinity
      if (straightOn >= earlier && straightOn > -Infinity) {
        best[i][j] = own + straightOn
        from[i][j] = j - 1
      } else if (earlier > -Infinity) {
        best[i][j] = own + earlier
        from[i][j] = earlierAt
      }
    }
  }

  let end = -1
  for (let j = m - 1; j < n; j++) {
    if (best[m - 1][j] > -Infinity && (end === -1 || best[m - 1][j] > best[m - 1][end])) end = j
  }
  if (end === -1) return null

  const indices: number[] = []
  for (let i = m - 1, j = end; i >= 0; j = from[i][j], i--) indices.unshift(j)
  return { score: TIER_SCATTERED * TIER_WEIGHT + best[m - 1][end], indices }
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

  // Among matches as good as each other, the shorter text: the closer it is
  // to being exactly what was typed.
  matches.sort((a, b) => b.match.score - a.match.score || getText(a.item).length - getText(b.item).length)
  return matches.slice(0, limit)
}
