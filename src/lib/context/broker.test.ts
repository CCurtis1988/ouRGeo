import { describe, expect, it, vi } from 'vitest'
import { ContextBroker } from './broker'
import { estimateTokens } from './budget'
import type { BrokerHost } from './broker'
import type { ContextSource } from './types'

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
    expect(() => broker.search({ query: 'one more' })).toThrow('BUDGET_LIMIT')
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
