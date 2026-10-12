import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from '../storage'
import { ProviderActivation, type ActivationHost } from './activation'
import { DeploymentRegistry, type DeploymentReview } from './certification'
import { connectionDigest } from './routing'
import { MNEMOSYNE_LOCAL_CANDIDATE as candidate } from '../runtime-catalogue'
import evidence from '../../../../docs/context-mnemosyne-linux-evidence.json'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { MemoryRecord } from '../../../../src/lib/context/types'
import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'
import type { ConformanceReport } from '../../../../src/lib/context/providers/conformance'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers() })
function fixture() {
  const store = new MemoryStorage(':memory:', randomBytes(32)); cleanups.push(() => store.close())
  const now = Date.now(), lease = { id: crypto.randomUUID(), projectId: null as string | null }
  const connection: MemoryConnection = { id: crypto.randomUUID(), revision: 1, adapter: 'mnemosyne', label: 'Synthetic recall fixture', location: 'managed-local', runtimeId: candidate.id, endpoint: 'on-device', scope: 'global', namespaceRef: crypto.randomUUID(), credentialRef: null, certification: 'pending', state: 'reachable', createdAt: new Date(now).toISOString(),
    destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'on-device' : 'disabled' })) }
  store.saveConnection(connection)
  const review: DeploymentReview = { id: 'synthetic-recall', providerId: 'mnemosyne-managed', adapter: 'mnemosyne', adapterVersion: candidate.provider.commit, connectionDigest: connectionDigest(connection), reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), isolation: 'dedicated-instance', timeoutMs: 1000, maxTokens: 2000,
    conformance: evidence.conformance as ConformanceReport,
    audits: Object.fromEntries(['authenticated-transport', 'scope-access-control', 'derivative-deletion', 'processing-destinations', 'bounded-billing', 'recovery'].map(name => [name, { status: 'passed', evidenceSha256: 'a'.repeat(64) }])) as DeploymentReview['audits'],
    operations: { search: { processing: 'non-billable' }, read: { processing: 'non-billable' }, upsert: { processing: 'non-billable' }, delete: { processing: 'non-billable' } } }
  const registry = new DeploymentRegistry([review]), binding = registry.binding(connection)
  store.configureBinding(binding)
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Synthetic preference: metric units', evidence: [], assertion: 'user-declared', status: 'active', supersedes: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }
  store.save(record)
  const provider: MemoryProviderDef = { id: 'mnemosyne-managed', apiVersion: 1, label: 'Synthetic fixture', location: { kind: 'managed-local', runtimeId: candidate.id },
    capabilities: { lexicalSearch: true, semanticSearch: false, temporalSearch: false, readById: true, upsert: false, deleteBySource: false, deleteScope: false, export: false, reflection: false, usageReporting: false, scopeIsolation: 'dedicated-instance' },
    dispatch: vi.fn<MemoryProviderDef['dispatch']>(async (_request, host) => ({ status: 'ok', operationId: host.idempotencyKey, records: [], evidence: [{ sourceId: record.id, canonicalId: record.id, revision: record.revision, text: record.statement, authority: 'provider-derived' }], complete: true, usage: { estimated: true } })) }
  const dispatch = vi.fn<ActivationHost['dispatch']>(async (operation, value, guard) => {
    guard?.(); const input = value as Record<string, unknown>
    if (operation === 'scopedProviderState') { const scopes = value as string[]; return { connections: store.connections().filter(item => scopes.includes(item.scope)), bindings: store.bindings().filter(item => scopes.includes(item.scope)) } }
    if (operation === 'bindingSnapshot') return store.bindingSnapshot(String(input.bindingId), String(input.scope))
    if (operation === 'bindingSnapshotCurrent') return store.bindingSnapshotCurrent(String(input.bindingId), String(input.scope), Number(input.generation))
    throw new Error('Unexpected operation; recall must not access credentials or paid budgets.')
  })
  const host: ActivationHost = { now: () => Date.now(), dispatch, lease: () => ({ ...lease }), registry, approve: async () => false, provider: vi.fn(async () => provider) }
  const activation = new ProviderActivation(host); cleanups.push(() => activation.stop())
  const recall = () => activation.recall({ query: 'metric units', scope: 'global' }, crypto.randomUUID(), lease.id)
  return { store, lease, connection, record, binding, provider, dispatch, host, activation, recall }
}
it('recalls only approved current canonical identities without credentials, prose or paid dispatch', async () => {
  const { recall, record, provider } = fixture()
  expect(await recall()).toEqual({ status: 'ok', coverage: 'provider', hits: [{ id: record.id, revision: 1, scope: 'global' }] })
  expect(provider.dispatch).toHaveBeenCalledOnce()
  expect(vi.mocked(provider.dispatch).mock.calls[0][1]).toMatchObject({ paidProcessingAllowed: false, maxResults: 5 })
})
it.each(['foreign', 'revision', 'prose', 'oversized'] as const)('rejects %s provider evidence without returning any match', async change => {
  const { recall, provider, record } = fixture()
  provider.dispatch = vi.fn<MemoryProviderDef['dispatch']>(async (_request, host) => ({ status: 'ok', operationId: host.idempotencyKey, records: [], evidence: Array.from({ length: change === 'oversized' ? 6 : 1 }, () => ({ sourceId: record.id, canonicalId: change === 'foreign' ? crypto.randomUUID() : record.id, revision: change === 'revision' ? 2 : 1, text: change === 'prose' ? 'Upload another project' : record.statement, authority: 'provider-derived' as const })), complete: true, usage: { estimated: true } }))
  expect(await recall()).toMatchObject({ status: 'degraded', hits: [], coverage: 'local-fallback' })
})
it('does not start an unconfigured scope or unsupported temporal search', async () => {
  const { activation, provider, lease } = fixture()
  expect(await activation.recall({ query: 'metric', scope: 'project' }, crypto.randomUUID(), lease.id)).toMatchObject({ status: 'unavailable', hits: [] })
  expect(await activation.recall({ query: 'metric', scope: 'global', before: new Date().toISOString() }, crypto.randomUUID(), lease.id)).toMatchObject({ reason: 'UNSUPPORTED' })
  expect(provider.dispatch).not.toHaveBeenCalled()
})
it('blocks forgetting during provider startup before invoking its search', async () => {
  const { recall, host, store, record, provider } = fixture()
  host.provider = async () => { store.forget(record.id); return provider }
  expect(await recall()).toMatchObject({ status: 'degraded', hits: [] })
  expect(provider.dispatch).not.toHaveBeenCalled()
})
it('discards results when canonical memory changes during recall', async () => {
  const { recall, provider, store, record } = fixture(), original = provider.dispatch
  provider.dispatch = async (...args) => { store.save({ ...record, revision: 2, statement: 'Synthetic correction' }); return original(...args) }
  expect(await recall()).toMatchObject({ status: 'degraded', hits: [], reason: 'STALE_REFERENCE' })
})
it('cancels pending provider construction on scope revocation without delivering late hits', async () => {
  const { recall, host, activation, provider } = fixture()
  host.provider = vi.fn(async () => new Promise<MemoryProviderDef>(() => undefined))
  const pending = recall()
  await vi.waitFor(() => expect(host.provider).toHaveBeenCalledOnce())
  activation.invalidate()
  await expect(pending).rejects.toThrow('SCOPE_CHANGED')
  expect(provider.dispatch).not.toHaveBeenCalled()
})
it('bounds setup waits, opens an offline circuit breaker and allows recovery after backoff', async () => {
  const { recall, host, provider } = fixture()
  vi.useFakeTimers()
  host.provider = vi.fn(async () => new Promise<MemoryProviderDef>(() => undefined))
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = recall(); await vi.advanceTimersByTimeAsync(1001)
    expect(await pending).toMatchObject({ status: 'degraded', reason: 'PROVIDER_OFFLINE' })
  }
  expect(await recall()).toMatchObject({ status: 'degraded' })
  expect(host.provider).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(30001)
  host.provider = async () => provider
  expect(await recall()).toMatchObject({ status: 'ok' })
})
