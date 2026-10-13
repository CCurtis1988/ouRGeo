import { descriptorLowerCase, descriptorLexicalSignature, descriptorMayMatch, type DescriptorQuery } from './descriptor-identity'
import { materialiseDescriptor } from './descriptor-index'
import type { ContextSource } from './types'
import { prepareLexicalQuery, scoreLexicalQuery } from './router'

export interface RankedSource { source: ContextSource; score: number; exact: boolean; reason: string }
type Compare = (a: RankedSource, b: RankedSource) => number

function ranking(query: string) {
  const prepared = prepareLexicalQuery(query.normalize('NFKC'))
  const normal = prepared.text
  const identifiers = new Set(normal.match(/[\p{L}\p{N}_.:$-]+/gu) ?? [])
  const signatures = !prepared.words.length || prepared.words.some(word => word.length < 3 || /[\u0080-\uffff]/.test(word)) ? undefined : prepared.words.map(descriptorLexicalSignature)
  const recent = /\b(?:last|latest|recent|that)\b/i.test(query) && /\b(?:error|failure|failed|warning|execution|command)\b/i.test(query)
  const authority = { observed: 3, host: 2, user: 1, untrusted: 0 }
  const compare: Compare = (a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score
    // Comparing timestamps only when both sides are console creates cycles
    // against a third non-console hit. Use a total order before pagination.
    || (recent ? Number(b.source.kind === 'console') - Number(a.source.kind === 'console')
      || (a.source.kind === 'console' ? (Date.parse(b.source.timestamp ?? '') || 0) - (Date.parse(a.source.timestamp ?? '') || 0) : 0) : 0)
    || authority[b.source.trust] - authority[a.source.trust] || a.source.id.localeCompare(b.source.id)
  return { compare, filter: (semantic: Map<string, number>): DescriptorQuery => ({ text: normal, words: signatures, semantic: new Set(semantic.keys()) }), scan(sources: Iterable<ContextSource>, semantic: Map<string, number>, eligible: (source: ContextSource) => boolean, visit: (hit: RankedSource) => void) {
    // Reuse the scan card. Only retained candidates need their own object.
    const hit = {} as RankedSource
    for (const source of sources) {
      // Empty discovery needs only the total ranking order. Avoid normalising
      // every resource name and allocating lower-case metadata for a broad page.
      if (!normal) {
        if (!eligible(source)) continue
        hit.source = source; hit.score = 1; hit.exact = false; hit.reason = 'lexical relevance'
        visit(hit)
        continue
      }
      const name = source.resource?.name.normalize('NFKC').toLowerCase()
      const lower = descriptorLowerCase(source)
      const title = lower & 1 ? source.title : source.title.toLowerCase()
      const named = Boolean(name && identifiers.has(name))
      // Partial titles inside the query retain their existing lexical score,
      // even when the descriptor lacks the rest of that query word.
      if (!named && !(title && normal.includes(title)) && !semantic.has(source.id) && !descriptorMayMatch(source, signatures)) continue
      const exact = Boolean(normal) && (/[\u0080-\uffff]/.test(title) ? title.normalize('NFKC') : title).trim() === normal
        || named
      const score = scoreLexicalQuery(prepared, title, lower & 2 ? source.summary : source.summary.toLowerCase())
      if (!(exact || score > 0 || semantic.has(source.id)) || !eligible(source)) continue
      hit.source = source; hit.score = exact ? Math.max(100, score) : score; hit.exact = exact
      hit.reason = exact ? 'exact identifier' : 'lexical relevance'
      visit(hit)
    }
  } }
}
function semanticRanks(ids: string[]): Map<string, number> { return new Map(ids.slice(0, 100).map((id, rank) => [id, rank + 1])) }
function fuse(candidates: RankedSource[], lexical: Map<string, number>, semantic: Map<string, number>, compare: Compare, label: string): void {
  const score = (id: string): number => (lexical.has(id) ? 1 / (60 + lexical.get(id)!) : 0) + (semantic.has(id) ? 1 / (60 + semantic.get(id)!) : 0)
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || score(b.source.id) - score(a.source.id) || compare(a, b))
  for (const hit of candidates) if (semantic.has(hit.source.id)) hit.reason = hit.exact ? 'exact identifier' : hit.score ? `lexical and ${label} rank fusion` : `${label} rank`
}

/** Inputs must already be scoped. Identifier validation happens only for a
 * matching candidate and always before it contributes a rank or match count. */
export function rankSources(query: string, sources: Iterable<ContextSource>, semanticIds: string[] = [], rankLabel = 'semantic', eligible: (source: ContextSource) => boolean = () => true): RankedSource[] {
  const engine = ranking(query), semantic = semanticRanks(semanticIds), candidates: RankedSource[] = []
  engine.scan(sources, semantic, eligible, hit => candidates.push({ ...hit, source: materialiseDescriptor(hit.source) }))
  candidates.sort(engine.compare)
  if (semantic.size) fuse(candidates, new Map(candidates.filter(hit => hit.score > 0).map((hit, rank) => [hit.source.id, rank + 1])), semantic, engine.compare, rankLabel)
  return candidates
}

/** Retain the requested lexical window plus at most 100 provider matches.
 * Complete counts and ordinal fusion survive without allocating one ranked
 * object per document/console descriptor on broad discovery. The source factory
 * reapplies current scope filters if fusion requires its bounded second scan. */
export function rankSourcePage(query: string, sources: (filter?: DescriptorQuery) => Iterable<ContextSource>, start: number, limit: number, semanticIds: string[] = [], rankLabel = 'semantic', eligible: (source: ContextSource) => boolean = () => true): { hits: RankedSource[]; total: number } {
  if (!Number.isSafeInteger(start) || start < 0 || start > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new Error('BUDGET_LIMIT')
  const capacity = start + limit, engine = ranking(query), semantic = semanticRanks(semanticIds)
  const filter = engine.filter(semantic)
  const top: RankedSource[] = [], provider = new Map<string, RankedSource>()
  let total = 0
  engine.scan(sources(filter), semantic, eligible, hit => {
    total++
    if (semantic.has(hit.source.id)) provider.set(hit.source.id, { ...hit, source: materialiseDescriptor(hit.source) })
    if (top.length >= capacity && engine.compare(hit, top[top.length - 1]) >= 0) return
    let low = 0, high = top.length
    while (low < high) { const middle = (low + high) >>> 1; if (engine.compare(hit, top[middle]) < 0) high = middle; else low = middle + 1 }
    top.splice(low, 0, { ...hit, source: materialiseDescriptor(hit.source) })
    if (top.length > capacity) top.pop()
  })
  if (provider.size) {
    const lexical = new Map(top.filter(hit => hit.score > 0).map((hit, rank) => [hit.source.id, rank + 1]))
    const beyond = [...provider.values()].filter(hit => hit.score > 0 && !lexical.has(hit.source.id))
    for (const hit of beyond) lexical.set(hit.source.id, 1)
    if (beyond.length) engine.scan(sources(filter), semantic, eligible, hit => {
      if (hit.score > 0) for (const candidate of beyond) if (engine.compare(hit, candidate) < 0) lexical.set(candidate.source.id, lexical.get(candidate.source.id)! + 1)
    })
    const union = new Map(top.map(hit => [hit.source.id, hit]))
    for (const [id, hit] of provider) union.set(id, hit)
    const fused = [...union.values()]
    fuse(fused, lexical, semantic, engine.compare, rankLabel)
    return { hits: fused.slice(start, start + limit), total }
  }
  return { hits: top.slice(start, start + limit), total }
}
