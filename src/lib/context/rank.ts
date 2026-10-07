import type { ContextSource } from './types'
import { prepareLexicalQuery, scoreLexicalQuery } from './router'

export interface RankedSource { source: ContextSource; score: number; exact: boolean; reason: string }

/** Inputs must already be authorised. Exact resource aliases outrank prose;
 * optional providers contribute ordinal ranks, never comparable probabilities.
 * Recency helps a relative failure request without rewriting an older decision. */
export function rankSources(query: string, sources: ContextSource[], semanticIds: string[] = []): RankedSource[] {
  const prepared = prepareLexicalQuery(query.normalize('NFKC'))
  const normal = prepared.text
  const identifiers = new Set(normal.match(/[\p{L}\p{N}_.:$-]+/gu) ?? [])
  const recent = /\b(?:last|latest|recent|that)\b/i.test(query) && /\b(?:error|failure|failed|warning|execution|command)\b/i.test(query)
  const semantic = new Map(semanticIds.slice(0, 100).map((id, rank) => [id, rank + 1]))
  const authority = { observed: 3, host: 2, user: 1, untrusted: 0 }
  const candidates: RankedSource[] = []
  for (const source of sources) {
    const name = source.resource?.name.normalize('NFKC').toLowerCase()
    const title = source.title.toLowerCase()
    const exact = Boolean(normal) && (/[\u0080-\uffff]/.test(title) ? title.normalize('NFKC') : title).trim() === normal
      || Boolean(name && identifiers.has(name))
    const score = scoreLexicalQuery(prepared, title, source.summary.toLowerCase())
    // Most descriptors are irrelevant. Avoid allocating a ranked object for
    // each of 100,000 unrelated chunks only to throw it away immediately.
    if (exact || score > 0 || semantic.has(source.id)) candidates.push({ source, score: exact ? Math.max(100, score) : score, exact, reason: exact ? 'exact identifier' : 'lexical relevance' })
  }
  const compare = (a: RankedSource, b: RankedSource): number => Number(b.exact) - Number(a.exact) || b.score - a.score
    || (recent && a.source.kind === 'console' && b.source.kind === 'console' ? (Date.parse(b.source.timestamp ?? '') || 0) - (Date.parse(a.source.timestamp ?? '') || 0) : 0)
    || authority[b.source.trust] - authority[a.source.trust] || a.source.id.localeCompare(b.source.id)
  candidates.sort(compare)
  if (semantic.size) {
    const lexicalRanks = new Map(candidates.filter(hit => hit.score > 0).map((hit, rank) => [hit.source.id, rank + 1]))
    const fusion = (id: string): number => (lexicalRanks.has(id) ? 1 / (60 + lexicalRanks.get(id)!) : 0) + (semantic.has(id) ? 1 / (60 + semantic.get(id)!) : 0)
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || fusion(b.source.id) - fusion(a.source.id) || compare(a, b))
    for (const hit of candidates) if (semantic.has(hit.source.id)) hit.reason = hit.exact ? 'exact identifier' : hit.score ? 'lexical and semantic rank fusion' : 'semantic rank'
  }
  return candidates
}
