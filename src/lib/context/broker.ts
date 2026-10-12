import { descriptorIdentity, safeDescriptorId } from './descriptor-identity'
import { materialiseDescriptor } from './descriptor-index'
import type { MemoryRecallRequest, MemoryRecallResult } from './providers/recall'
import type { ContextEvidence, ContextIdentity, ContextKind, ContextSource, ContextTrace, ContextEffort, DocumentRange } from './types'
import { boundedText, estimateTokens } from './budget'
import { redactContext } from './policy'
import { rankSourcePage } from './rank'
import { updateUsage, type UsageReport } from './usage'
import type { ContextAttachment } from './attachments'
import { memoryRetention } from './retention'
import { readDocumentRange } from './document-range'

const sourceRevisionKey = (id: string, revision: string): string => JSON.stringify([id, revision])

// Cache only the fixed secret/encoding classification of an immutable ID.
// Every request still checks live scope, exclusions, kind and source revision.
// Weak keys do not retain a closed workspace's descriptors or content.
let identifierChecks = new WeakMap<ContextSource, string>()
let identifierCheckCount = 0
function safeIdentifier(source: ContextSource): boolean {
  const known = identifierChecks.get(source)
  if (known === source.id) return true
  const classified = descriptorIdentity(source)
  if (classified !== undefined) return classified
  const allowed = safeDescriptorId(source.id)
  // Discovery must not build a second descriptor-sized identity database.
  // A bounded weak cache saves repeated reads without retaining a workspace.
  if (allowed) {
    if (identifierCheckCount >= 4096) { identifierChecks = new WeakMap(); identifierCheckCount = 0 }
    identifierChecks.set(source, source.id); identifierCheckCount++
  }
  return allowed
}
import { cacheResult, resolveResult, resultSources } from './result-cache'

export interface BrokerHost {
  identity: ContextIdentity
  target: string
  effort: ContextEffort
  signal: AbortSignal
  current: () => boolean
  sources: (kinds?: ContextKind[]) => Iterable<ContextSource>
  recall?: (input: MemoryRecallRequest, signal: AbortSignal) => Promise<MemoryRecallResult>
  excluded: () => string[]
  changed?: (trace: ContextTrace) => void
  limitations?: string[]
}

/** References and cursors are leases on one turn, not paths or provider IDs.
 * Every cache hit goes through the same current-source check as a fresh read. */
export class ContextBroker {
  readonly trace: ContextTrace
  private handles = new Map<string, { id: string; revision: string; offset: number; end?: number; range?: DocumentRange }>()
  private cache = new Map<string, string>()
  private delivered = new Set<string>()
  private memoryRanks = new Map<string, MemoryRecallResult>()
  private deadline = Date.now() + 30 * 60_000
  constructor(private host: BrokerHost) {
    this.trace = { turnId: crypto.randomUUID(), identity: host.identity, target: host.target, state: 'prepared', selected: [], invocations: [], retrievalCalls: 0, returnedTokens: 0, excluded: [], ...(host.limitations?.length ? { limitations: host.limitations.slice(0, 5).map(value => value.slice(0, 200)) } : {}) }
  }

  private emit(): void { if (this.host.current()) this.host.changed?.({ ...this.trace, selected: [...this.trace.selected], invocations: [...this.trace.invocations] }) }
  private check(): void {
    this.host.signal.throwIfAborted()
    if (!this.host.current() || Date.now() > this.deadline) throw new Error('SCOPE_CHANGED')
  }
  private takeCall(): void {
    this.check()
    const max = this.host.effort === 'thorough' ? 10 : this.host.effort === 'efficient' ? 3 : 6
    if (this.trace.retrievalCalls >= max) throw new Error(`BUDGET_LIMIT: this turn has used its ${max} context lookups at ${this.host.effort} effort. Use the evidence already retrieved, narrow the request, or choose a higher Context effort in the assistant footer and send again.`)
    if (this.trace.returnedTokens >= 12000) throw new Error('BUDGET_LIMIT: this turn has reached its 12,000-token retrieval allowance. Use the evidence already retrieved or send a narrower follow-up request.')
    this.trace.retrievalCalls++
  }
  private eligible(kinds?: ContextKind[], matches?: (source: ContextSource) => boolean): ContextSource[] {
    return Array.from(this.iterateEligible(kinds, matches), materialiseDescriptor)
  }
  private *iterateEligible(kinds?: ContextKind[], matches?: (source: ContextSource) => boolean, verifyIdentifier = true): Generator<ContextSource> {
    const excluded = this.host.excluded()
    const excludedIds = new Set(excluded)
    this.trace.excluded = excluded
    const originals = this.host.sources(kinds)
    const results = !kinds || kinds.includes('result') ? this.results : []
    for (const collection of [originals, results]) for (const s of collection) {
      if ((!matches || matches(s)) && s.revision.length <= 128 && !excludedIds.has(s.id) && !s.legacyIds?.some(id => excludedIds.has(id)) && (!kinds || kinds.includes(s.kind)) && (!verifyIdentifier || safeIdentifier(s))) yield s
    }
  }
  private ref(source: ContextSource, offset = 0, end?: number, range?: DocumentRange): string {
    if (this.handles.size > 1024) throw new Error('BUDGET_LIMIT')
    const ref = `ctx_${crypto.randomUUID()}`
    this.handles.set(ref, { id: source.id, revision: source.revision, offset, end, ...(range ? { range: { ...range } } : {}) })
    return ref
  }

  search(input: Record<string, unknown>): string {
    this.takeCall()
    return this.compileSearch(input)
  }

  async searchWithMemory(input: Record<string, unknown>): Promise<string> {
    this.takeCall()
    const query = typeof input.query === 'string' ? redactContext(input.query.slice(0, 512)) : ''
    const scope = input.scope ?? 'all'
    const kinds = input.kinds
    const discoverMemory = !Array.isArray(kinds) || kinds.includes('memory')
    if (!this.host.recall || !query.trim() || !discoverMemory || !this.eligible(['memory']).length || !['all', 'available', 'global', 'project'].includes(String(scope)) || input.group) return this.compileSearch(input)
    const request: MemoryRecallRequest = { query, scope: scope === 'global' || !this.host.identity.projectId && scope !== 'project' ? 'global' : 'project',
      ...(typeof input.before === 'string' ? { before: input.before } : {}), ...(typeof input.after === 'string' ? { after: input.after } : {}) }
    const key = JSON.stringify(request)
    let recalled = this.memoryRanks.get(key)
    if (input.cursor && !recalled) return this.compileSearch(input)
    if (!recalled) {
      try { recalled = await this.host.recall(request, this.host.signal) }
      catch { this.check(); recalled = { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'PROVIDER_OFFLINE' } }
      this.check()
      this.memoryRanks.set(key, recalled)
    }
    this.check()
    const allowed = new Map(this.eligible(['memory']).map(source => [source.id, source]))
    const ranks = recalled.hits.slice(0, 5).filter(hit => allowed.get(`memory:${hit.id}`)?.revision === String(hit.revision) && allowed.get(`memory:${hit.id}`)?.scope === hit.scope).map(hit => `memory:${hit.id}`)
    if (recalled.status === 'degraded') {
      this.trace.limitations = [...new Set([...(this.trace.limitations ?? []), 'Memory provider recall was unavailable or stale; authorised local records were searched.'])].slice(0, 5)
    }
    return this.compileSearch(input, ranks, recalled.status === 'degraded' ? 'degraded-local-fallback' : ranks.length ? 'local-and-provider-ranked' : undefined)
  }

  private compileSearch(input: Record<string, unknown>, memoryRanks: string[] = [], coverage?: string): string {
    this.check()
    const query = typeof input.query === 'string' ? input.query.slice(0, 512) : ''
    const kinds = Array.isArray(input.kinds) ? input.kinds.filter(k => typeof k === 'string') as ContextKind[] : undefined
    const scope = typeof input.scope === 'string' ? input.scope : 'all'
    const group = typeof input.group === 'string' ? input.group.slice(0, 128) : ''
    const after = typeof input.after === 'string' ? Date.parse(input.after) : null
    const before = typeof input.before === 'string' ? Date.parse(input.before) : null
    if ((after !== null && !Number.isFinite(after)) || (before !== null && !Number.isFinite(before))) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE', recovery: 'Use an ISO timestamp for before or after.' })
    const offset = input.cursor ? this.handles.get(String(input.cursor)) : undefined
    const searchKey = `search:${JSON.stringify([query, scope, kinds, group, after, before])}`
    if (input.cursor && (!offset || offset.id !== searchKey)) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
    const start = offset?.offset ?? 0
    const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(10, Math.floor(input.limit))) : 5
    // Score first, then validate each matching candidate before it contributes
    // to a count or page. An extra filtering generator scanned every descriptor
    // even for exact-name queries over a large unrelated corpus.
    const excluded = this.host.excluded(), denied = new Set(excluded)
    this.trace.excluded = excluded
    const eligible = (s: ContextSource): boolean => s.revision.length <= 128 && !denied.has(s.id)
      && !s.legacyIds?.some(id => denied.has(id)) && (!kinds || kinds.includes(s.kind))
      && (scope === 'all' || scope === 'available' || s.scope === scope) && (!group || s.group === group)
      && (after === null && before === null || Boolean(s.timestamp && (after === null || Date.parse(s.timestamp) >= after) && (before === null || Date.parse(s.timestamp) <= before)))
      && safeIdentifier(s)
    const resultsToSearch = !kinds || kinds.includes('result') ? this.results : []
    const originals = (): Iterable<ContextSource> => this.host.sources(kinds)
    const sources = resultsToSearch.length ? function* () { yield* originals(); yield* resultsToSearch } : originals
    const { hits, total } = rankSourcePage(query, sources, start, limit, memoryRanks, 'memory provider', eligible)
    const results = hits.map(({ source: s, reason }) => {
      const resource = s.resource ? { environment: redactContext(s.resource.environment), name: redactContext(s.resource.name) } : undefined
      return { ref: this.ref(s), kind: s.kind, title: redactContext(s.title).slice(0, 120), scope: s.scope, revision: s.revision, ...(resource && estimateTokens(resource) <= 200 ? { resource } : {}), excerpt: boundedText(redactContext(s.summary), 80).text, matchReason: reason }
    })
    while (results.length > 1 && estimateTokens({ results, nextCursor: 'ctx_'.padEnd(40, '0'), coverage: 'indexed-sources-only', omitted: total }) > 1100) results.pop()
    const globalUsed = this.trace.selected.filter(e => e.scope === 'global' && e.reason !== 'user marked Always apply').reduce((total, e) => total + e.estimatedTokens, 0)
    while (results.length && globalUsed + results.filter(hit => hit.scope === 'global').reduce((total, hit) => total + estimateTokens(hit), 0) > 400) results.pop()
    if (total > start && !results.length) return JSON.stringify({ status: 'BUDGET_LIMIT', recovery: 'The global preference budget is covered. Narrow the query or use the Memory library.' })
    const next = start + results.length < total ? `ctx_${crypto.randomUUID()}` : null
    if (next) this.handles.set(next, { id: searchKey, revision: '', offset: start + results.length })
    const response = JSON.stringify({ status: 'ok', results, nextCursor: next, coverage: coverage ?? (total ? 'indexed-sources-only' : 'not-found-in-index'), omitted: Math.max(0, total - start - results.length) })
    if (estimateTokens(response) > 12000 - this.trace.returnedTokens) return JSON.stringify({ status: 'BUDGET_LIMIT' })
    for (const result of results) {
      const handle = this.handles.get(result.ref)!
      this.trace.selected.push({ ref: result.ref, sourceId: handle.id, kind: result.kind, scope: result.scope, title: result.title, revision: handle.revision, reason: 'search discovery metadata', content: JSON.stringify(result), estimatedTokens: estimateTokens(result), completeness: 'partial' })
    }
    this.trace.returnedTokens += estimateTokens(response)
    this.emit()
    return response
  }

  async read(input: Record<string, unknown>, reason = 'assistant requested evidence', tokenLimit = 1800): Promise<string> {
    this.check()
    const reference = String(input.cursor ?? input.ref ?? '')
    const cachedResult = resolveResult(this.host.identity, reference)
    const handle = this.handles.get(reference) ?? (cachedResult ? { id: cachedResult.id, revision: cachedResult.revision, offset: 0, end: undefined, range: undefined } : undefined)
    if (!handle) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
    const source = this.eligible([handle.id.split(':')[0] as ContextKind], s => s.id === handle.id)[0]
    if (!source) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
    if (source.revision !== handle.revision) return JSON.stringify({ status: 'STALE_REFERENCE', recovery: 'Search again for the current revision.' })
    let range = handle.range
    if (input.startLine !== undefined || input.endLine !== undefined) {
      if (source.kind !== 'document') return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
      if (!range && handle.offset > 0) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE', recovery: 'A continuation cursor cannot change its range. Search for a new reference.' })
      const requested = { startLine: input.startLine === undefined ? range?.startLine ?? 1 : Number(input.startLine), endLine: input.endLine === undefined ? range?.endLine ?? Number.MAX_SAFE_INTEGER : Number(input.endLine) }
      if (!Number.isSafeInteger(requested.startLine) || !Number.isSafeInteger(requested.endLine) || requested.startLine < 1 || requested.endLine < requested.startLine) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE', recovery: 'Choose positive, ordered document line numbers.' })
      if (range && (range.startLine !== requested.startLine || range.endLine !== requested.endLine)) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE', recovery: 'This reference is limited to its selected range. Search for a new authorised reference to select another range.' })
      range = requested
      handle.range = { ...range }
    }
    const cacheKey = range ? JSON.stringify([source.id, source.revision, range.startLine, range.endLine]) : sourceRevisionKey(source.id, source.revision)
    let raw = this.cache.get(cacheKey)
    if (raw === undefined) {
      this.takeCall()
      const original = range && source.readRange ? await source.readRange(range, this.host.signal) : await source.read(this.host.signal)
      raw = redactContext(range && !source.readRange ? readDocumentRange(original, range) : original)
      if (raw.length > 1_000_000) return JSON.stringify({ status: 'BUDGET_LIMIT', recovery: 'Select a smaller document section or result.' })
      this.check()
      const current = this.eligible([source.kind], s => s.id === source.id)[0]
      if (!current) return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
      if (current.revision !== source.revision) return JSON.stringify({ status: 'STALE_REFERENCE' })
      this.cache.set(cacheKey, raw)
    }
    const offset = handle.offset, end = handle.end ?? raw.length
    const selectedTokens = this.trace.selected.reduce((sum, evidence) => sum + evidence.estimatedTokens, 0)
    const globalRemaining = 400 - this.trace.selected.filter(e => e.scope === 'global' && e.reason !== 'user marked Always apply').reduce((sum, evidence) => sum + evidence.estimatedTokens, 0)
    const ceiling = this.host.effort === 'efficient' ? 3000 : this.host.effort === 'thorough' ? 10000 : 8000
    const remaining = Math.min(1800, tokenLimit, source.scope === 'global' ? Math.min(320, globalRemaining) : Infinity, 12000 - this.trace.returnedTokens, ceiling - selectedTokens)
    if (remaining < 100) return JSON.stringify({ status: 'BUDGET_LIMIT' })
    let page = boundedText(raw.slice(offset, end), remaining)
    const responseLimit = Math.min(tokenLimit, source.scope === 'global' ? globalRemaining : 2000, 12000 - this.trace.returnedTokens)
    // Budget the actual JSON, including escaped code/error strings and long
    // names. The opaque ref preserves identity when a large internal ID is
    // omitted from the wire; truncating that ID would create a false identity.
    const prospectiveCursor = `ctx_${crypto.randomUUID()}`
    const wire = (text: string): string => JSON.stringify({ status: 'ok', ref: String(input.ref ?? input.cursor), ...(source.id.length <= 512 ? { sourceId: source.id } : {}), kind: source.kind, scope: source.scope, title: redactContext(source.title).slice(0, 120), revision: source.revision, ...(range ? { range } : {}), reason, content: text, estimatedTokens: estimateTokens(text), completeness: offset + text.length >= end ? 'complete' : 'partial', timestamp: source.timestamp, trust: source.trust, nextCursor: offset + text.length >= end ? null : prospectiveCursor })
    if (estimateTokens(wire('')) > responseLimit) return JSON.stringify({ status: 'BUDGET_LIMIT', recovery: 'Source metadata exceeds the response budget. Select a smaller source.' })
    if (estimateTokens(wire(page.text)) > responseLimit) {
      let low = 0, high = page.text.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (estimateTokens(wire(page.text.slice(0, middle))) <= responseLimit) low = middle
        else high = middle - 1
      }
      if (low && /[\uD800-\uDBFF]/.test(page.text[low - 1])) low--
      page = { text: page.text.slice(0, low), complete: false }
    }
    if (!page.text && offset < end) return JSON.stringify({ status: 'BUDGET_LIMIT', recovery: 'Source metadata leaves no space for content. Narrow the source selection.' })
    const nextCursor = page.complete ? null : this.ref(source, offset + page.text.length, end, range)
    const evidence: ContextEvidence = { ref: String(input.ref ?? input.cursor), sourceId: source.id, kind: source.kind, scope: source.scope, title: redactContext(source.title).slice(0, 120), revision: source.revision, reason, content: page.text, estimatedTokens: estimateTokens(page.text), completeness: page.complete ? 'complete' : 'partial' }
    this.trace.selected.push(evidence)
    const response = wire(page.text).replace(prospectiveCursor, nextCursor ?? '')
    this.trace.returnedTokens += estimateTokens(response)
    this.emit()
    return response
  }

  async prefetch(ids: string[], allocation = 2400): Promise<string[]> {
    const results: string[] = []
    const selected = ids.slice(0, this.host.effort === 'efficient' ? 1 : 3)
    for (const id of selected) {
      const source = this.eligible([id.split(':')[0] as ContextKind], s => s.id === id)[0]
      const remaining = Math.max(0, Math.min(2400, allocation) - this.trace.selected.reduce((sum, evidence) => sum + evidence.estimatedTokens, 0))
      if (source && remaining > 100) results.push(await this.read({ ref: this.ref(source) }, 'local task routing', Math.min(remaining, Math.floor(allocation / selected.length))))
    }
    return results
  }

  /** Composer attachments are host-selected references, not filesystem paths.
   * Read on send, with the same permissions, freshness and paging as a model
   * read. Explicit input must be visibly staged or fail with a recovery move. */
  async attach(attachment: ContextAttachment, tokenBudget = 1800): Promise<string> {
    this.check()
    if (attachment.workspaceEpoch !== this.host.identity.workspaceEpoch) throw new Error('SCOPE_CHANGED: the attached workspace changed. Remove the attachment and select its current source.')
    const source = this.eligible(undefined, source => source.id === attachment.sourceId)[0]
    if (!source) throw new Error('SOURCE_UNAVAILABLE: the attachment was excluded or removed. Review the source and attach it again.')
    if (source.revision !== attachment.revision) throw new Error('STALE_REFERENCE: the attached source changed. Remove the attachment and select its current revision.')
    const response = await this.read({ ref: this.ref(source), ...(attachment.range ?? {}) }, 'user attachment', tokenBudget)
    const page = JSON.parse(response)
    if (page.status !== 'ok') throw new Error(`${page.status}: ${page.recovery ?? 'The attachment could not be read. Remove it or select a smaller section.'}`)
    return response
  }

  async pinnedInstructions(ids: string[]): Promise<string> {
    if (!ids.length) return ''
    this.check()
    const cards: { scope: string; instruction: string; ref: string }[] = []
    const evidence: ContextEvidence[] = []
    for (const id of ids) {
      const source = this.eligible(['memory'], source => source.id === id)[0]
      if (!source) throw new Error('SOURCE_UNAVAILABLE: an Always apply instruction was excluded or removed. Review its pin in the Memory library.')
      const record = JSON.parse(await source.read(this.host.signal))
      this.check()
      if (record.status !== 'active' || record.pinned !== true || typeof record.statement !== 'string' || memoryRetention(record).expired) throw new Error('STALE_REFERENCE: an Always apply instruction changed or expired. Review it in the Memory library and send again.')
      const content = redactContext(record.statement)
      const ref = this.ref(source)
      cards.push({ scope: source.scope, instruction: content, ref })
      evidence.push({ ref, sourceId: source.id, kind: 'memory', scope: source.scope, title: redactContext(source.title).slice(0, 120), revision: source.revision, reason: 'user marked Always apply', content, estimatedTokens: estimateTokens(content), completeness: 'complete' })
    }
    const card = `User-configured Always apply instructions. Current explicit user instructions take precedence; project preferences override global defaults. Application permissions still apply.\n${JSON.stringify(cards)}`
    if (estimateTokens(card) > 1200) throw new Error('BUDGET_LIMIT: Always apply instructions exceed 1,200 estimated tokens. Shorten them or unpin selected records in the Memory library; none were silently dropped.')
    this.trace.selected.push(...evidence)
    this.emit()
    return card
  }

  async ensureSkills(ids: string[]): Promise<string | null> {
    this.check()
    const missing = ids.filter(id => {
      const source = this.eligible(['skill'], s => s.id === id)[0]
      return !source || !this.delivered.has(sourceRevisionKey(id, source.revision))
    })
    if (!missing.length) return null
    const guidance = await this.prefetch(missing)
    return JSON.stringify({ status: 'REQUIRED_SKILL', executed: false, guidance, recovery: 'Read the supplied prerequisites and retry the action on the next invocation. Missing or excluded skills must be enabled by the user.' })
  }

  storeResult(text: string, title: string): string {
    return this.archiveResult(text, title, 1200)
  }

  archiveResult(text: string, title: string, tokens = 160): string {
    this.check()
    const id = `result:${crypto.randomUUID()}`
    const clean = redactContext(text)
    // Tool results are recoverable within the task, but are never promoted to memory.
    const source: ContextSource = { id, kind: 'result', scope: 'conversation', title, summary: title, revision: '1', timestamp: new Date().toISOString(), trust: 'observed', read: () => clean }
    if (clean.length > 1_000_000) throw new Error('BUDGET_LIMIT: select a smaller tool result.')
    const page = boundedText(clean, tokens)
    const excerpt = page.text
    const ref = this.ref(source)
    cacheResult(this.host.identity, ref, source, clean)
    this.trace.selected.push({ ref, sourceId: id, kind: 'result', scope: 'conversation', title, revision: '1', reason: tokens === 1200 ? 'tool result' : 'compacted tool result', content: excerpt, estimatedTokens: estimateTokens(excerpt), completeness: page.complete ? 'complete' : 'partial' })
    this.emit()
    return JSON.stringify({ status: tokens === 1200 ? page.complete ? 'ok' : 'partial' : 'compacted', excerpt, ref, completeness: page.complete ? 'complete' : 'partial', recovery: 'Read the authorised original result with context_read; this excerpt may omit critical values.' })
  }
  get results(): ContextSource[] { return resultSources(this.host.identity) }
  /** This is host evidence metadata, not a source's instruction. Retained
   * transports also receive it with tool results after an execution. */
  freshnessNotice(): string {
    this.validateSend()
    const selected = this.trace.selected.filter(e => e.kind === 'environment')
    if (!selected.length) return ''
    const ids = new Set(selected.map(e => e.sourceId))
    const current = this.eligible(['environment'], s => ids.has(s.id))
    const stale = selected.filter(e => current.some(s => s.id === e.sourceId && s.revision !== e.revision))
    if (!stale.length) return ''
    return `Host freshness notice: workspace observations ${[...new Set(stale.map(e => e.ref))].join(', ')} are historical. R execution or workspace state changed after they were observed. They do not establish current schema, values or analytical results. Search and read current metadata before relying on it; use visible authorised R computation for current quantitative claims.`
  }
  prepareInvocation(payload: unknown): void {
    const notice = this.freshnessNotice()
    if (!notice) return
    const staleRefs = new Set(this.trace.selected.filter(e => e.kind === 'environment').map(e => e.ref))
    const label = '[Host freshness annotation]'
    const textKeys = new Set(['text', 'content', 'turn', 'context', 'output'])
    const protectedKinds = new Set(['reasoning', 'thinking', 'redacted_thinking', 'tool_use', 'function_call'])
    const candidates: { value: Record<string, unknown>; key: string }[] = []
    let annotated = false
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const object = value as Record<string, unknown>
      if (protectedKinds.has(String(object.type)) || object.role === 'system' || object.role === 'developer') return
      for (const [key, item] of Object.entries(value)) {
        if (['functionCall', 'tool_calls', 'arguments', 'args', 'thinking', 'reasoning', 'signature', 'encrypted_content', 'tools'].includes(key)) continue
        if (typeof item === 'string' && textKeys.has(key)) {
          candidates.push({ value: object, key })
          if (![...staleRefs].some(ref => item.includes(ref))) continue
          // Replace our previous prefix, leaving the original attributed text
          // and complete tool exchange intact. Repeated inference cannot grow
          // an unbounded series of freshness notices.
          const text = item.startsWith(label) ? item.slice(item.indexOf('\n\n') + 2) : item
          object[key] = `${label} ${notice}\n\n${text}`
          annotated = true
        } else visit(item)
      }
    }
    visit(payload)
    // Compaction may remove the old evidence wrapper. A retained transcript
    // still needs the host correction, in an ordinary text channel.
    if (!annotated && candidates.length) {
      const candidate = candidates[candidates.length - 1]
      const old = String(candidate.value[candidate.key])
      const text = old.startsWith(label) ? old.slice(old.indexOf('\n\n') + 2) : old
      candidate.value[candidate.key] = `${label} ${notice}\n\n${text}`
    }
  }
  validateSend(): void {
    this.check()
    if (this.trace.selected.length === 0) return
    const selectedIds = new Set(this.trace.selected.map(e => e.sourceId))
    const sources = this.eligible([...new Set(this.trace.selected.map(e => e.kind))], source => selectedIds.has(source.id))
    const historical = new Set(this.trace.selected.filter(e => e.kind === 'environment' && ['sent', 'acknowledged', 'uncertain'].includes(e.delivery ?? 'selected')).map(e => sourceRevisionKey(e.sourceId, e.revision)))
    if (this.trace.selected.some(e => !sources.some(s => s.id === e.sourceId && (s.kind === 'result' || s.revision === e.revision
      // An execution legitimately invalidates observations already delivered
      // in this task. Keep them as labelled history; newly prepared evidence
      // must still match before its first disclosure.
      || (s.kind === 'environment' && historical.has(sourceRevisionKey(e.sourceId, e.revision))))))) {
      throw new Error('STALE_REFERENCE: selected context changed or was excluded. Send again to prepare current evidence.')
    }
  }
  recordInvocation(inputTokens: number, window: number, payload?: unknown): void {
    this.validateSend()
    const strings: string[] = []
    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value)
      else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    if (payload !== undefined) collect(payload)
    const freshness = this.freshnessNotice()
    if (freshness && !strings.some(text => text.includes(freshness))) throw new Error('STALE_REFERENCE: historical workspace evidence needs a host freshness notice before another invocation. Prepare current context and retry.')
    const sent = this.trace.selected.filter(evidence => payload === undefined || strings.some(text => text.includes(evidence.ref) && (text.includes(evidence.content) || text.includes(JSON.stringify(evidence.content).slice(1, -1)))))
    this.trace.invocations.push({ inputTokens, window, estimated: true, sentRefs: [...new Set(sent.map(evidence => evidence.ref))] })
    for (const evidence of this.trace.selected) {
      if (!sent.includes(evidence)) { evidence.delivery ??= 'selected'; continue }
      evidence.delivery = 'sent'
      if (evidence.reason === 'search discovery metadata') continue
      const source = evidence.kind === 'skill' ? this.eligible(['skill'], source => source.id === evidence.sourceId)[0] : undefined
      if (source?.prerequisites && !evidence.content.includes(source.prerequisites)) continue
      this.delivered.add(sourceRevisionKey(evidence.sourceId, evidence.revision))
    }
    this.trace.state = 'sent'
    this.emit()
  }
  recordReportedUsage(report: UsageReport): void {
    // A cancelled request may already have incurred usage. Keep its receipt
    // in this turn's ledger; it does not acknowledge evidence delivery.
    if (report.invocation > this.trace.invocations.length) return
    this.trace.usage = updateUsage(this.trace.usage ?? [], report)
    this.emit()
  }
  finish(success: boolean): void {
    for (const evidence of this.trace.selected) evidence.delivery = evidence.delivery === 'sent' ? success ? 'acknowledged' : 'uncertain' : evidence.delivery ?? 'selected'
    this.trace.state = this.trace.invocations.length ? success ? 'acknowledged' : 'uncertain' : 'prepared'
    this.emit()
  }
}
