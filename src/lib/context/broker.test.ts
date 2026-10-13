import { describe, expect, it, vi } from 'vitest'
import { ContextBroker } from './broker'
import { estimateTokens } from './budget'
import type { BrokerHost } from './broker'
import type { ContextSource } from './types'
import { readDocumentRange } from './document-range'

function fixture(sources: ContextSource[] = []) {
  const controller = new AbortController()
  const state = { sources, active: true, excluded: [] as string[] }
  const host: BrokerHost = { identity: { chatId: 'chat', projectId: null, workspaceEpoch: 0, policyRevision: 0 }, target: 'local/test', effort: 'balanced', signal: controller.signal, current: () => state.active, sources: vi.fn(kinds => state.sources.filter(s => !kinds || kinds.includes(s.kind))), excluded: () => state.excluded }
  return { state, host, controller, broker: new ContextBroker(host) }
}
function source(extra: Partial<ContextSource> = {}): ContextSource {
  return { id: 'skill:themes', kind: 'skill', scope: 'application', title: 'themes', summary: 'copy a theme template and check contrast', revision: '1', trust: 'host', read: () => 'Copy a template; check contrast.', ...extra }
}
function first(broker: ContextBroker, query = 'theme') { return JSON.parse(broker.search({ query })).results[0].ref }

describe('context leases and budgets', () => {
  it('reads a bounded selected span in a multi-megabyte document and keeps every cursor inside it', async () => {
    const selected = '# Relevant\n' + 'selected text '.repeat(250)
    const text = 'x'.repeat(2_000_000) + '\n' + selected + '\nDO NOT INCLUDE THIS NEIGHBOUR'
    const read = vi.fn(() => { throw new Error('The full body must not be fetched') })
    const readRange = vi.fn(range => readDocumentRange(text, range))
    const item = source({ id: 'document:large', kind: 'document', read, readRange })
    const { broker } = fixture([item])
    const response = JSON.parse(await broker.attach({ sourceId: item.id, revision: item.revision, workspaceEpoch: 0, range: { startLine: 2, endLine: 3 } }, 500))
    expect(response).toMatchObject({ range: { startLine: 2, endLine: 3 }, completeness: 'partial' })
    expect(JSON.parse(await broker.read({ cursor: response.nextCursor, startLine: 1, endLine: 4 })).status).toBe('SOURCE_UNAVAILABLE')
    expect(JSON.parse(await broker.read({ ref: response.ref, startLine: 1, endLine: 4 })).status).toBe('SOURCE_UNAVAILABLE')
    let gathered = response.content
    let cursor = response.nextCursor
    while (cursor) {
      const page = JSON.parse(await broker.read({ cursor }, 'assistant requested evidence', 500))
      expect(page.range).toEqual({ startLine: 2, endLine: 3 })
      expect(page.status).toBe('ok')
      gathered += page.content; cursor = page.nextCursor
    }
    expect(gathered).toBe(selected)
    expect(gathered).not.toContain('NEIGHBOUR')
    expect(read).not.toHaveBeenCalled()
    expect(readRange).toHaveBeenCalledOnce()
  })
  it('does not reuse a cached document range after the current buffer revision changes', async () => {
    const item = source({ id: 'document:large', kind: 'document', readRange: range => readDocumentRange('first\n' + 'large selected span '.repeat(1000), range) })
    const { broker, state } = fixture([item])
    const page = JSON.parse(await broker.attach({ sourceId: item.id, revision: '1', workspaceEpoch: 0, range: { startLine: 2, endLine: 2 } }, 500))
    state.sources = [{ ...item, revision: '2' }]
    expect(JSON.parse(await broker.read({ cursor: page.nextCursor })).status).toBe('STALE_REFERENCE')
  })
  it('checks the revision again after a range adapter reads a changed current buffer', async () => {
    const { broker, state } = fixture()
    const item = source({ id: 'document:large', kind: 'document', readRange: () => { state.sources = [{ ...item, revision: '2' }]; return 'changed' } })
    state.sources = [item]
    await expect(broker.attach({ sourceId: item.id, revision: '1', workspaceEpoch: 0, range: { startLine: 1, endLine: 1 } })).rejects.toThrow('STALE_REFERENCE')
  })
  it('preserves reported cancelled-request usage without acknowledging evidence or updating another scope', () => {
    const { broker, host, state } = fixture()
    host.changed = vi.fn()
    broker.recordInvocation(700, 32000)
    state.active = false
    vi.mocked(host.changed).mockClear()
    broker.recordReportedUsage({ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 650 })
    broker.finish(false)
    expect(broker.trace.state).toBe('uncertain')
    expect(broker.trace.usage).toEqual([{ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 650 }])
    expect(host.changed).not.toHaveBeenCalled()
    broker.recordReportedUsage({ invocation: 2, attempt: 0, scope: 'invocation', inputTokens: 999 })
    expect(broker.trace.usage).toHaveLength(1)
  })
  it('rechecks exclusions and changed identifiers after warming the static validation cache', () => {
    const item = source(), { broker, state } = fixture([item])
    expect(JSON.parse(broker.search({ query: 'theme' })).results).toHaveLength(1)
    state.excluded = [item.id]
    expect(JSON.parse(broker.search({ query: 'theme' })).results).toEqual([])
    state.excluded = []
    item.id = 'skill:api_key%3Dprivate-value'
    expect(JSON.parse(broker.search({ query: 'theme' })).results).toEqual([])
  })
  it('keeps source revision cache keys distinct when IDs and revisions contain colons', async () => {
    const first = source({ id: 'document:note:part', kind: 'document', revision: 'v1', title: 'First note', read: () => 'First canonical section.' })
    const second = source({ id: 'document:note', kind: 'document', revision: 'part:v1', title: 'Second note', read: () => 'Different canonical section.' })
    const { broker } = fixture([first, second])
    const one = JSON.parse(broker.search({ query: 'First note' })).results[0]
    const two = JSON.parse(broker.search({ query: 'Second note' })).results[0]
    expect(JSON.parse(await broker.read({ ref: one.ref })).content).toBe('First canonical section.')
    expect(JSON.parse(await broker.read({ ref: two.ref })).content).toBe('Different canonical section.')
  })
  it('bounds attached envelopes and refuses stale, excluded or cross-workspace attachment metadata before fetching', async () => {
    const read = vi.fn(() => '# Heading\n' + 'long authorised text '.repeat(1000))
    const item = source({ id: 'document:attached', kind: 'document', read }), { broker, state, host } = fixture([item])
    const attachment = { sourceId: item.id, revision: item.revision, workspaceEpoch: host.identity.workspaceEpoch, range: { startLine: 1, endLine: 2 } }
    const response = await broker.attach(attachment, 500)
    expect(estimateTokens(response)).toBeLessThanOrEqual(500)
    expect(JSON.parse(response)).toMatchObject({ completeness: 'partial', reason: 'user attachment' })
    expect(JSON.parse(response).nextCursor).toMatch(/^ctx_/)
    expect(broker.trace.selected[0].delivery).toBeUndefined()
    await expect(broker.attach({ ...attachment, workspaceEpoch: attachment.workspaceEpoch + 1 })).rejects.toThrow('SCOPE_CHANGED')
    await expect(broker.attach({ ...attachment, revision: 'old' })).rejects.toThrow('STALE_REFERENCE')
    state.excluded = [item.id]
    await expect(broker.attach(attachment)).rejects.toThrow('SOURCE_UNAVAILABLE')
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('budgets escaped code and long identities without clipping a source ID', async () => {
    const text = '\\"\n'.repeat(3000)
    const { broker } = fixture([source({ id: `document:${'a'.repeat(700)}`, kind: 'document', read: () => text })])
    const result = JSON.parse(await broker.read({ ref: first(broker) }))
    expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(2000)
    expect(result.sourceId).toBeUndefined()
    expect(broker.trace.selected.at(-1)?.sourceId).toBe(`document:${'a'.repeat(700)}`)
    expect(result.nextCursor).toMatch(/^ctx_/)
    const next = JSON.parse(await broker.read({ ref: result.ref, cursor: result.nextCursor }))
    expect(next.status).toBe('ok')
  })
  it('does not fetch an encoded credential in a resource identity', () => {
    const read = vi.fn(() => 'private')
    const { broker } = fixture([source({ id: 'environment:.GlobalEnv:api_key%3Dcredential-value', kind: 'environment', read })])
    expect(JSON.parse(broker.search({ query: '' })).results).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
  it('keeps global preference discovery and reads within a cumulative selection budget', async () => {
    const { broker } = fixture(Array.from({ length: 10 }, (_, i) => source({ id: `memory:${i}`, kind: 'memory', scope: 'global', title: 'Metric preference', summary: 'metric '.repeat(40), read: () => 'metric '.repeat(100) })))
    const discovery = JSON.parse(broker.search({ query: 'metric' }))
    for (const hit of discovery.results) await broker.read({ ref: hit.ref })
    expect(broker.trace.selected.reduce((total, evidence) => total + evidence.estimatedTokens, 0)).toBeLessThanOrEqual(400)
  })
  it('does not claim a fetched source was sent when cancellation occurs before the next invocation', async () => {
    const { broker } = fixture([source()])
    broker.recordInvocation(700, 32000, { messages: [{ content: 'Conversation only.' }] })
    await broker.read({ ref: first(broker) })
    broker.finish(false)
    expect(broker.trace.selected.every(evidence => evidence.delivery === 'selected')).toBe(true)
    expect(broker.trace.invocations[0].sentRefs).toEqual([])
  })
  it('distinguishes a sent excerpt from other locally selected evidence', async () => {
    const { broker } = fixture([source()])
    const ref = first(broker)
    const read = await broker.read({ ref })
    broker.recordInvocation(1200, 32000, { messages: [{ content: read }] })
    broker.finish(true)
    expect(broker.trace.selected.find(evidence => evidence.reason === 'assistant requested evidence')?.delivery).toBe('acknowledged')
    expect(broker.trace.selected.find(evidence => evidence.reason === 'search discovery metadata')?.delivery).toBe('selected')
  })
  it('never treats a partial mandatory prerequisite section as delivered', async () => {
    const prerequisites = 'Complete mandatory workflow. '.repeat(40)
    const { broker } = fixture([source({ prerequisites, read: () => prerequisites + '\nOptional reference.' })])
    await broker.prefetch(['skill:themes'], 150)
    broker.recordInvocation(1000, 32000)
    expect(JSON.parse((await broker.ensureSkills(['skill:themes']))!).status).toBe('REQUIRED_SKILL')
    broker.recordInvocation(1800, 32000)
    expect(await broker.ensureSkills(['skill:themes'])).toBeNull()
  })
  it('keeps explicit pins separate from ranking and refuses oversized pins without dropping instructions', async () => {
    const memory = { id: crypto.randomUUID(), status: 'active', pinned: true, statement: 'Use exactly 12.5 US survey feet.' }
    const { broker, state } = fixture([source({ id: `memory:${memory.id}`, kind: 'memory', scope: 'global', read: () => JSON.stringify(memory) })])
    const card = await broker.pinnedInstructions([`memory:${memory.id}`])
    expect(card).toContain(memory.statement)
    expect(broker.trace.retrievalCalls).toBe(0)
    expect(broker.trace.selected[0].completeness).toBe('complete')
    state.sources[0].read = () => JSON.stringify({ ...memory, statement: 'Required instruction '.repeat(1000) })
    await expect(broker.pinnedInstructions([`memory:${memory.id}`])).rejects.toThrow('none were silently dropped')
  })
  it('does no source discovery or fetching for a context-free invocation', async () => {
    const { broker, host } = fixture(Array.from({ length: 10000 }, (_, i) => source({ id: `skill:${i}` })))
    expect(await broker.prefetch([])).toEqual([])
    broker.recordInvocation(700, 32000)
    expect(host.sources).not.toHaveBeenCalled()
    expect(broker.trace.selected).toEqual([])
    expect(broker.trace.retrievalCalls).toBe(0)
  })
  it('invalidates a cached source immediately after exclusion', async () => {
    const read = vi.fn(() => 'Allowed before revocation')
    const { broker, state } = fixture([source({ read })])
    const ref = first(broker)
    expect(JSON.parse(await broker.read({ ref })).status).toBe('ok')
    state.excluded = ['skill:themes']
    expect(JSON.parse(await broker.read({ ref })).status).toBe('SOURCE_UNAVAILABLE')
    expect(read).toHaveBeenCalledTimes(1)
    expect(() => broker.validateSend()).toThrow('STALE_REFERENCE')
  })
  it('rejects a result that completes in a different workspace', async () => {
    let release!: (text: string) => void
    const { broker, state } = fixture([source({ read: () => new Promise(resolve => { release = resolve }) })])
    const pending = broker.read({ ref: first(broker) })
    state.active = false
    release('private old project')
    await expect(pending).rejects.toThrow('SCOPE_CHANGED')
    expect(broker.trace.selected.every(e => e.reason === 'search discovery metadata')).toBe(true)
    expect(JSON.stringify(broker.trace)).not.toContain('private old project')
  })
  it('detects source replacement while reading and never reports it as current', async () => {
    const { broker, state } = fixture()
    state.sources = [source({ read: () => { state.sources = [source({ revision: '2' })]; return 'old' } })]
    expect(JSON.parse(await broker.read({ ref: first(broker) })).status).toBe('STALE_REFERENCE')
    expect(broker.trace.selected.every(e => e.reason === 'search discovery metadata')).toBe(true)
  })
  it('does not leak names through unknown or revoked references', async () => {
    const { broker } = fixture([source()])
    expect(await broker.read({ ref: '/other-project/private.txt' })).toBe('{"status":"SOURCE_UNAVAILABLE"}')
  })
  it('pages large evidence with opaque scoped cursors', async () => {
    const text = 'a'.repeat(16000)
    const { broker } = fixture([source({ read: () => text })])
    const result = JSON.parse(await broker.read({ ref: first(broker) }))
    expect(result.completeness).toBe('partial')
    expect(result.nextCursor).toMatch(/^ctx_/)
    expect(estimateTokens(JSON.stringify(result))).toBeLessThan(2000)
    const next = JSON.parse(await broker.read({ ref: result.ref, cursor: result.nextCursor }))
    expect(next.content).toBeTruthy()
    expect(broker.trace.retrievalCalls).toBe(2)
  })
  it('keeps an exact repeated read in the task cache without another retrieval round', async () => {
    const read = vi.fn(() => 'one statement')
    const { broker } = fixture([source({ read })])
    const ref = first(broker)
    await broker.read({ ref }); await broker.read({ ref })
    expect(read).toHaveBeenCalledTimes(1)
    expect(broker.trace.retrievalCalls).toBe(2)
  })
  it('gates an action until its skill revision has reached an invocation', async () => {
    const { broker } = fixture([source()])
    expect(JSON.parse((await broker.ensureSkills(['skill:themes']))!).executed).toBe(false)
    broker.recordInvocation(1000, 32000)
    expect(await broker.ensureSkills(['skill:themes'])).toBeNull()
  })
  it('redacts credentials before both delivery and inspector capture', async () => {
    const { broker } = fixture([source({ read: () => 'api_key=private-key\nSafe statement.' })])
    const result = await broker.read({ ref: first(broker) })
    expect(result).not.toContain('private-key')
    expect(broker.trace.selected.at(-1)!.content).toContain('[redacted]')
  })
  it('stops repeated searches at the configured turn limit', () => {
    const { broker } = fixture()
    for (let i = 0; i < 6; i++) broker.search({ query: `q${i}` })
    expect(() => broker.search({ query: 'one more' })).toThrow('this turn has used its 6 context lookups at balanced effort')
    expect(broker.trace.retrievalCalls).toBe(6)
  })
  it('returns every eligible result over pages without exposing the corpus in one response', () => {
    const { broker } = fixture(Array.from({ length: 201 }, (_, i) => source({ id: `skill:${i}`, title: `theme ${i}` })))
    let cursor: string | undefined
    const seen = new Set<string>()
    for (let page = 0; page < 3; page++) {
      const result = JSON.parse(broker.search({ query: 'theme', cursor }))
      expect(result.results).toHaveLength(5)
      result.results.forEach((hit: { title: string }) => seen.add(hit.title))
      cursor = result.nextCursor
    }
    expect(seen.size).toBe(15)
  })
})


describe('provider-assisted memory discovery', () => {
  it('uses provider ordinal matches only for current authorised canonical memory and reads original provenance', async () => {
    const recordId = crypto.randomUUID()
    const memory = source({ id: `memory:${recordId}`, kind: 'memory', scope: 'global', revision: '3', title: 'Prefer SI', summary: 'Prefer SI', trust: 'user', read: () => 'Original user preference: prefer SI units.' })
    const { broker, host } = fixture([memory])
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>(async () => ({ status: 'ok', coverage: 'provider', hits: [{ id: recordId, revision: 3, scope: 'global' }] }))
    const discovered = JSON.parse(await broker.searchWithMemory({ query: 'metric units', scope: 'global' }))
    expect(discovered.coverage).toBe('local-and-provider-ranked')
    expect(discovered.results).toHaveLength(1)
    expect(discovered.results[0].matchReason).toBe('memory provider rank')
    expect(JSON.parse(await broker.read({ ref: discovered.results[0].ref })).content).toBe('Original user preference: prefer SI units.')
    expect(host.recall).toHaveBeenCalledOnce()
  })
  it('does not fetch memory for capability discovery, empty queries, workspace reads or a context-free prefetch', async () => {
    const { broker, host } = fixture()
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>()
    await broker.prefetch([])
    await broker.searchWithMemory({ query: 'themes', kinds: ['skill'] })
    await broker.searchWithMemory({ query: '' })
    await broker.searchWithMemory({ query: 'roads', scope: 'workspace' })
    expect(host.recall).not.toHaveBeenCalled()
  })
  it('does not disclose a query to a provider when local policy excludes every canonical memory', async () => {
    const item = source({ id: 'memory:private', kind: 'memory', scope: 'global' })
    const { broker, host, state } = fixture([item])
    state.excluded = [item.id]
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>()
    expect(JSON.parse(await broker.searchWithMemory({ query: 'private project fields' })).results).toEqual([])
    expect(host.recall).not.toHaveBeenCalled()
  })
  it('reuses provider rankings but filters deleted, excluded and superseded records again', async () => {
    const id = crypto.randomUUID(), memory = source({ id: `memory:${id}`, kind: 'memory', scope: 'global', title: 'SI', summary: 'SI' })
    const { broker, host, state } = fixture([memory])
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>(async () => ({ status: 'ok', coverage: 'provider', hits: [{ id, revision: 1, scope: 'global' }] }))
    expect(JSON.parse(await broker.searchWithMemory({ query: 'metric' })).results).toHaveLength(1)
    memory.revision = '2'
    expect(JSON.parse(await broker.searchWithMemory({ query: 'metric' })).results).toEqual([])
    memory.revision = '1'; state.excluded = [memory.id]
    expect(JSON.parse(await broker.searchWithMemory({ query: 'metric' })).results).toEqual([])
    state.sources = []
    expect(JSON.parse(await broker.searchWithMemory({ query: 'metric' })).results).toEqual([])
    expect(host.recall).toHaveBeenCalledOnce()
  })
  it('keeps local lexical results and reports degraded coverage when a provider fails', async () => {
    const { broker, host } = fixture([source({ id: 'memory:test', kind: 'memory', scope: 'global', title: 'metric', summary: 'metric units' })])
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>(async () => { throw new Error('PROVIDER_OFFLINE') })
    const result = JSON.parse(await broker.searchWithMemory({ query: 'metric' }))
    expect(result.coverage).toBe('degraded-local-fallback')
    expect(result.results).toHaveLength(1)
    expect(broker.trace.limitations).toHaveLength(1)
  })
  it('rejects late provider results after a scope switch', async () => {
    const { broker, host, state } = fixture([source({ id: 'memory:metric', kind: 'memory', scope: 'global' })])
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>(async () => { state.active = false; return { status: 'ok', coverage: 'provider', hits: [] } })
    await expect(broker.searchWithMemory({ query: 'metric' })).rejects.toThrow('SCOPE_CHANGED')
    expect(broker.trace.selected).toEqual([])
  })
  it('uses current project recall by default without sending the query to a separate global provider', async () => {
    const { broker, host } = fixture([source({ id: 'memory:decision', kind: 'memory', scope: 'project' })])
    host.identity.projectId = crypto.randomUUID()
    host.recall = vi.fn<NonNullable<BrokerHost['recall']>>(async () => ({ status: 'unavailable', coverage: 'local-only', hits: [] }))
    await broker.searchWithMemory({ query: 'project CRS decision' })
    expect(vi.mocked(host.recall!).mock.calls[0][0].scope).toBe('project')
  })
})

it('searches conversation-only memories locally without dispatching their query to a provider', async () => {
  const { host } = fixture([source({ id: 'memory:conversation:chat:note', kind: 'memory', scope: 'conversation', title: 'Exactly 100 metres', summary: 'buffer distance', read: () => JSON.stringify({ statement: 'Exactly 100 metres', status: 'active', pinned: true }) })])
  host.recall = vi.fn<NonNullable<BrokerHost['recall']>>()
  const broker = new ContextBroker(host)
  expect(JSON.parse(await broker.searchWithMemory({ query: 'buffer distance', kinds: ['memory'] })).results).toHaveLength(1)
  expect(host.recall).not.toHaveBeenCalled()
})

it('prefetches an unpinned conversation memory through the ordinary memory-kind path', async () => {
  const id = 'memory:conversation:chat:note'
  const { broker } = fixture([source({ id, kind: 'memory', scope: 'conversation', title: 'Exactly 100 metres', summary: 'buffer distance', read: () => 'Current chat instruction: exactly 100 metres.' })])
  const evidence = await broker.prefetch([id])
  expect(evidence).toHaveLength(1)
  expect(broker.trace.selected[0]).toMatchObject({ sourceId: id, scope: 'conversation', completeness: 'complete' })
})

it('rebinds a schema once when its first inspection fills cached columns, counting both reads', async () => {
  const { state, broker } = fixture()
  const current = source({ id: 'environment:a:parcels', kind: 'environment', scope: 'workspace', revision: 'observed', read: vi.fn(() => 'Current parcel_id schema') })
  state.sources = [source({ id: current.id, kind: 'environment', scope: 'workspace', revision: 'uncached', read: vi.fn(() => { state.sources = [current]; throw new Error('STALE_REFERENCE: schema cache populated') }) })]
  const result = await broker.prefetch([current.id])
  expect(result[0]).toContain('Current parcel_id schema')
  expect(broker.trace.selected[0].revision).toBe('observed')
  expect(broker.trace.retrievalCalls).toBe(2)
  expect(current.read).toHaveBeenCalledOnce()
})
