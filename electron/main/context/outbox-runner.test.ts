import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from './storage'
import { OutboxRunner, type OutboxPort } from './outbox-runner'
import type { ProviderBinding } from '../../../src/lib/context/providers/outbox'
import type { MemoryRecord } from '../../../src/lib/context/types'
import type { MemoryProviderDef, ProviderResult } from '../../../src/lib/context/providers/types'

const stores: MemoryStorage[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new MemoryStorage(':memory:', randomBytes(32)); stores.push(store)
  const binding: ProviderBinding = { id: crypto.randomUUID(), scope: 'global', adapter: 'hindsight', adapterVersion: 'fixture', namespaceRef: 'private_fixture', connectionRef: crypto.randomUUID(), policyRevision: 1, enabled: true, writesCertified: true }
  store.configureBinding(binding)
  const now = new Date().toISOString()
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Prefer metric units', evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] }
  store.save(record)
  const provider: MemoryProviderDef = { id: 'fixture', label: 'Synthetic provider', apiVersion: 1, location: { kind: 'external', connectionId: binding.connectionRef },
    capabilities: { lexicalSearch: true, semanticSearch: false, temporalSearch: false, readById: true, upsert: true, deleteBySource: true, deleteScope: false, export: false, reflection: false, usageReporting: true, scopeIsolation: 'native' },
    dispatch: vi.fn<MemoryProviderDef['dispatch']>(async (request, host) => ({ status: 'ok', operationId: host.idempotencyKey, records: request.operation === 'upsert' ? request.records : [], complete: true, usage: { inputTokens: 0, outputTokens: 0, estimated: false } })),
  }
  const state = { scopes: ['global'], now: Date.now() }, settle = vi.fn(async () => {})
  const port: OutboxPort = {
    scopes: () => state.scopes,
    claim: async (scopes, now) => store.claimJob(now, scopes),
    claimPending: async (scopes, now) => store.claimPendingJob(now, scopes),
    current: async (id, scopes) => store.currentJob(id, scopes),
    complete: async (id, receipt, now) => store.completeJob(id, receipt, now),
    resolve: async job => ({ provider, host: { namespace: job.binding.namespaceRef, policyRevision: job.binding.policyRevision, timeoutMs: 1000, maxTokens: 2000, maxResults: 1, paidProcessingAllowed: false }, authorised: () => true, settle }),
  }
  return { store, binding, record, provider, port, state, settle, runner: new OutboxRunner(port, () => state.now) }
}

it('deduplicates dispatch and commits only the matching canonical revision receipt', async () => {
  const { runner, provider, store, record, settle } = fixture()
  const first = runner.run(), second = runner.run()
  expect(first).toBe(second)
  expect(await first).toBe(1)
  expect(provider.dispatch).toHaveBeenCalledOnce()
  expect(store.outbox()[0].status).toBe('confirmed')
  expect(store.list()).toEqual([record])
  expect(settle).toHaveBeenCalledOnce()
})

it('leaves uncertain ingestion pending and uses bounded revision reads without re-ingesting', async () => {
  const { runner, provider, store, record, state } = fixture()
  const dispatch = vi.mocked(provider.dispatch)
  dispatch.mockRejectedValueOnce(new Error('Lost acknowledgement'))
  await runner.run()
  expect(store.outbox()[0].status).toBe('pending')
  const operationId = store.outbox()[0].id
  state.now += 31000
  dispatch.mockResolvedValueOnce({ status: 'ok', operationId, records: [], complete: true, usage: { estimated: true }, evidence: [{ sourceId: record.id, canonicalId: record.id, revision: 1, text: record.statement, authority: 'provider-derived' }] })
  await runner.run()
  expect(dispatch.mock.calls.map(([request]) => request.operation)).toEqual(['upsert', 'read'])
  expect(store.outbox()[0]).toMatchObject({ status: 'confirmed', attempts: 1, reconciliationAttempts: 1 })
})

it('never confirms a partial or wrong-revision recovery read and stops automatic recovery after six attempts', async () => {
  const { runner, provider, store, record, state } = fixture()
  const dispatch = vi.mocked(provider.dispatch)
  dispatch.mockRejectedValueOnce(new Error('Lost acknowledgement'))
  await runner.run()
  const operationId = store.outbox()[0].id
  dispatch.mockResolvedValue({ status: 'ok', operationId, records: [], complete: true, usage: { estimated: true }, evidence: [{ sourceId: record.id, canonicalId: record.id, revision: 2, text: record.statement, authority: 'provider-derived' }] })
  for (let i = 0; i < 8; i++) { state.now += 31000; await runner.run() }
  expect(dispatch.mock.calls.filter(([request]) => request.operation === 'upsert')).toHaveLength(1)
  expect(dispatch.mock.calls.filter(([request]) => request.operation === 'read')).toHaveLength(6)
  expect(store.outbox()[0]).toMatchObject({ status: 'pending', reason: 'reconciliation-limit' })
})

it('does not claim another project or trust a route with a different namespace', async () => {
  const { runner, provider, port, state, store } = fixture()
  state.scopes = [`project:${crypto.randomUUID()}`]
  expect(await runner.run()).toBe(0)
  expect(store.outbox()[0]).toMatchObject({ status: 'queued', attempts: 0 })
  state.scopes = ['global']
  const resolve = port.resolve
  port.resolve = async (...args) => { const route = await resolve(...args); route.host.namespace = 'another_project'; return route }
  await runner.run(1)
  expect(provider.dispatch).not.toHaveBeenCalled()
  expect(store.outbox()[0].status).toBe('queued')
})

it('compensates a late ingestion after forgetting and accounts for its late reported usage', async () => {
  const { runner, provider, store, record, settle, state } = fixture()
  let finish!: (value: ProviderResult) => void
  const dispatch = vi.mocked(provider.dispatch)
  dispatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const running = runner.run(1)
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce())
  const operationId = store.outbox()[0].id
  store.forget(record.id)
  runner.cancel(record.id)
  await running
  expect(store.search('metric')).toEqual([])
  // Complete the first deletion before the provider ignores cancellation and
  // finishes its old write. The late receipt must queue another deletion.
  state.now = Date.now() + 1000
  await runner.run()
  expect(store.outbox().filter(job => job.operation === 'delete' && job.status === 'confirmed')).toHaveLength(1)
  finish({ status: 'ok', operationId, records: [record], complete: true, usage: { inputTokens: 100, outputTokens: 20, estimated: false } })
  await vi.waitFor(() => expect(store.outbox().filter(job => job.operation === 'delete' && job.status === 'queued')).toHaveLength(1))
  await vi.waitFor(() => expect(settle).toHaveBeenCalledWith(expect.objectContaining({ usage: { inputTokens: 100, outputTokens: 20, estimated: false } })))
})

it('rechecks revocation after asynchronous routing and never accepts provider records as local writes', async () => {
  const { runner, provider, port, binding, store, record } = fixture()
  const resolve = port.resolve
  port.resolve = async (...args) => {
    const route = await resolve(...args)
    store.configureBinding({ ...binding, enabled: false, policyRevision: 2 })
    return route
  }
  await runner.run()
  expect(provider.dispatch).not.toHaveBeenCalled()
  expect(store.outbox()[0].status).toBe('cancelled')
  expect(store.list()).toEqual([record])
})
