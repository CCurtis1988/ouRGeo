/**
 * Fuzzy match a query against a label. Returns a score (higher is better) and
 * the matched character indices for highlighting, or null if no subsequence
 * match exists. Prefix matches beat scattered subsequence matches; case and
 * word-boundary hits are rewarded. An empty query matches everything at 0.
 */
export function fuzzyMatch(
  query: string,
  label: string
): { score: number; matched: number[] } | null {
  if (!query) return { score: 0, matched: [] }
  const q = query.toLowerCase()
  const l = label.toLowerCase()

  // Fast paths for the common (and highest-value) prefix cases.
  if (label.startsWith(query)) return { score: 1000 - label.length, matched: range(query.length) }
  if (l.startsWith(q)) return { score: 900 - label.length, matched: range(query.length) }

  // General subsequence match with contiguity / boundary bonuses.
  const matched: number[] = []
  let score = 0
  let qi = 0
  let prevMatch = -2
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) {
      matched.push(i)
      score += 1
      if (i === prevMatch + 1) score += 3 // contiguous run
      const prev = i > 0 ? label[i - 1] : ''
      if (i === 0 || prev === '.' || prev === '_' || (prev >= 'a' && prev <= 'z' && label[i] >= 'A' && label[i] <= 'Z'))
        score += 4 // word boundary (dot/underscore/camelCase)
      prevMatch = i
      qi++
    }
  }
  if (qi < q.length) return null
  // Prefer shorter labels among equal-quality matches.
  return { score: score - label.length * 0.05, matched }
}

function range(n: number): number[] {
  const a: number[] = []
  for (let i = 0; i < n; i++) a.push(i)
  return a
}
