import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from '../storage'
import { OutboxRunner, type OutboxPort } from '../outbox-runner'
import type { MemoryRecord } from '../../../../src/lib/context/types'
import type { ProviderBinding } from '../../../../src/lib/context/providers/outbox'
import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'
import { prepareConnection } from './connection-policy'
import { connectionDigest, resolveProviderRoute, type ProviderCertificate, type ProviderRoutingPort } from './routing'
import { createHindsightProvider } from './hindsight'
import type { JsonTransport } from './transport'

const stores: MemoryStorage[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture(projectId: string | null = null) {
  const store = new MemoryStorage(':memory:', randomBytes(32)); stores.push(store)
  const ledger = store.maintenance()
  ledger.configure({ revision: 1, enabled: true, currency: 'USD', mode: 'estimated', dailyMicros: 1000000, monthlyMicros: 2000000 })
  const input = prepareConnection({ adapter: 'hindsight', label: 'Synthetic deployment', endpoint: 'https://memory.example.invalid', location: 'server', scope: projectId ? 'project' : 'global', token: 'SYNTHETIC_PRIVATE_CREDENTIAL',
    destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'https://memory.example.invalid/' : 'disabled' })) }, projectId)
  store.saveConnection(input.connection, input.token)
  const connection = { ...input.connection, state: 'reachable' as const, revision: 2 }; store.saveConnection(connection)
  const binding: ProviderBinding = { id: crypto.randomUUID(), scope: connection.scope, adapter: 'hindsight', adapterVersion: 'fixture-immutable-pin', namespaceRef: connection.namespaceRef, connectionRef: connection.id, policyRevision: 1, enabled: true, writesCertified: true }
  store.configureBinding(binding)
  const now = new Date().toISOString()
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: projectId ? 'project' : 'global', projectId, category: 'preference', statement: 'Synthetic fixture: prefer metric units.', evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] }
  if (projectId) store.commitProject(projectId, { version: 1, revision: 1, memories: [record] }); else store.save(record)
  const job = store.claimJob()!
  const certificate: ProviderCertificate = { id: crypto.randomUUID(), bindingId: binding.id, bindingPolicyRevision: 1, connectionId: connection.id, connectionDigest: connectionDigest(connection), adapterVersion: binding.adapterVersion,
    providerId: 'synthetic', scope: connection.scope, isolation: 'native', expiresAt: new Date(Date.now() + 60000).toISOString(), timeoutMs: 1000, maxTokens: 2000,
    operations: { upsert: { processing: 'paid', estimateMicros: 200000, pricingVersion: 'fixture-price-v1', pricingExpiresAt: new Date(Date.now() + 60000).toISOString(), boundedOperation: true }, read: { processing: 'paid', estimateMicros: 10000, pricingVersion: 'fixture-price-v1', pricingExpiresAt: new Date(Date.now() + 60000).toISOString(), boundedOperation: true }, delete: { processing: 'non-billable' } } }
  const state = { lease: { id: crypto.randomUUID(), projectId }, allowed: true, certificate: certificate as ProviderCertificate | undefined }
  const provider: MemoryProviderDef = { id: 'synthetic', label: 'Synthetic conformance only', apiVersion: 1, location: { kind: 'external', connectionId: connection.id },
    capabilities: { lexicalSearch: true, semanticSearch: false, temporalSearch: false, readById: true, upsert: true, deleteBySource: true, deleteScope: false, export: false, reflection: false, usageReporting: true, scopeIsolation: 'native' },
    dispatch: vi.fn<MemoryProviderDef['dispatch']>(async (request, host) => ({ status: 'ok', operationId: host.idempotencyKey, complete: true, records: request.operation === 'upsert' ? request.records : [],
      ...(request.operation === 'read' ? { evidence: [{ sourceId: record.id, canonicalId: record.id, revision: record.revision, text: record.statement, authority: 'provider-derived' }] } : {}), usage: { currency: 'USD', cost: .01, estimated: false } })),
  }
  const port: ProviderRoutingPort = {
    lease: () => ({ ...state.lease }), currentJob: async id => store.currentJob(id, [connection.scope]), connection: async id => store.connection(id),
    certificate: async () => state.certificate, credential: vi.fn(async reference => store.credential(reference)),
    authorised: (lease, saved, certified, suppliedJob) => state.allowed && lease.id === state.lease.id && state.certificate?.id === certified.id
      && connectionDigest(store.connection(saved.id)!) === certified.connectionDigest && Boolean(store.currentJob(suppliedJob.operation.id, [connection.scope])),
    provider: vi.fn(() => provider), maintenancePolicy: async () => ledger.policy(),
    maintenance: { reserve: vi.fn(async input => ledger.reserve(input)), markDispatched: async id => ledger.markDispatched(id), settle: async (...args) => ledger.settle(...args) },
  }
  const runnerPort: OutboxPort = { scopes: () => [connection.scope], claim: async (_scopes, at) => store.claimJob(at, [connection.scope]), claimPending: async (_scopes, at) => store.claimPendingJob(at, [connection.scope]),
    current: async (id, scopes) => store.currentJob(id, scopes), complete: async (id, receipt, at) => store.completeJob(id, receipt, at), resolve: (job, reconciliation, signal) => resolveProviderRoute(job, reconciliation, signal, port) }
  return { store, ledger, binding, record, connection, job, certificate, state, provider, port, runnerPort }
}

it('resolves only one certified host binding and reserves before any provider content is dispatched', async () => {
  const { job, port, provider, ledger } = fixture()
  const route = await resolveProviderRoute(job, false, new AbortController().signal, port)
  expect(provider.dispatch).not.toHaveBeenCalled()
  expect(port.credential).toHaveBeenCalledOnce()
  expect(ledger.summary().outstandingMicros).toBe(200000)
  await route.beforeDispatch!()
  await route.settle({ status: 'ok', operationId: job.operation.id, records: [], complete: true, usage: { currency: 'USD', cost: .02, estimated: false } }, true)
  expect(ledger.summary()).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 20000 })
})

it.each(['missing', 'expired', 'version', 'namespace', 'destination', 'scope', 'isolation', 'pricing', 'unbounded', 'consent', 'unsupported'] as const)('blocks %s deployment approval before credential access or spend reservation', async fault => {
  const { job, port, state, certificate, connection } = fixture()
  if (fault === 'missing') state.certificate = undefined
  if (fault === 'expired') certificate.expiresAt = '2026-01-01T00:00:00Z'
  if (fault === 'version') certificate.adapterVersion = 'another-pin'
  if (fault === 'namespace') port.connection = async () => ({ ...connection, namespaceRef: 'another_bank' })
  if (fault === 'destination') port.connection = async () => ({ ...connection, destinations: connection.destinations.map(item => item.purpose === 'embeddings' ? { ...item, destination: 'unknown' } : item) })
  if (fault === 'scope') certificate.scope = `project:${crypto.randomUUID()}`
  if (fault === 'isolation') certificate.isolation = 'unsupported' as 'native'
  if (fault === 'pricing' && certificate.operations.upsert?.processing === 'paid') certificate.operations.upsert.pricingExpiresAt = '2026-01-01T00:00:00Z'
  if (fault === 'unbounded' && certificate.operations.upsert?.processing === 'paid') certificate.operations.upsert.boundedOperation = false as true
  if (fault === 'consent') state.allowed = false
  if (fault === 'unsupported') delete certificate.operations.upsert
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow()
  expect(port.credential).not.toHaveBeenCalled()
  expect(port.provider).not.toHaveBeenCalled()
  expect(port.maintenance.reserve).not.toHaveBeenCalled()
})

it('refuses forged or superseded canonical payloads before resolving credentials', async () => {
  const { job, port } = fixture()
  job.record!.statement = 'Forged replacement of the canonical statement'
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow('STALE_OPERATION')
  expect(port.credential).not.toHaveBeenCalled()
})

it('does not route saved-project work after switching to scratch during local preparation', async () => {
  const { job, port, state } = fixture(crypto.randomUUID())
  const connection = port.connection
  port.connection = async id => { const value = await connection(id); state.lease = { id: crypto.randomUUID(), projectId: null }; return value }
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow('SCOPE_CHANGED')
  expect(port.credential).not.toHaveBeenCalled()
})

it('detects a canonical edit during certification lookup before credential access', async () => {
  const { job, port, store, record, certificate } = fixture()
  port.certificate = async () => { store.save({ ...record, revision: 2, statement: 'Synthetic correction' }); return certificate }
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow()
  expect(port.credential).not.toHaveBeenCalled()
})

it('blocks missing authentication and read-only adapter capabilities without opening a provider call', async () => {
  const { job, port, provider } = fixture()
  port.credential = vi.fn(async () => undefined)
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow('CREDENTIAL_UNAVAILABLE')
  expect(provider.dispatch).not.toHaveBeenCalled()
  const next = fixture()
  next.provider.capabilities.deleteBySource = false
  await expect(resolveProviderRoute(next.job, false, new AbortController().signal, next.port)).rejects.toThrow('PROVIDER_UNCERTIFIED')
  expect(next.provider.dispatch).not.toHaveBeenCalled()
})

it.each(['cancel', 'consent', 'connection', 'certificate'] as const)('rechecks %s changes during credential lookup before constructing a provider', async change => {
  const { job, port, state, certificate, store, connection, ledger } = fixture()
  const abort = new AbortController()
  port.credential = async () => {
    if (change === 'cancel') abort.abort()
    if (change === 'consent') state.allowed = false
    if (change === 'connection') store.saveConnection({ ...connection, revision: 3 })
    if (change === 'certificate') state.certificate = { ...certificate, id: crypto.randomUUID() }
    return 'synthetic-unused-credential'
  }
  await expect(resolveProviderRoute(job, false, abort.signal, port)).rejects.toThrow('POLICY_REFUSED')
  expect(port.provider).not.toHaveBeenCalled()
  expect(ledger.summary().outstandingMicros).toBe(0)
})

it('keeps background consent separate from a valid deployment certificate', async () => {
  const { job, port, ledger, provider } = fixture()
  ledger.configure({ ...ledger.policy(), revision: 2, enabled: false })
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow('off')
  expect(provider.dispatch).not.toHaveBeenCalled()
})

it('gives each paid reconciliation read its own reservation without releasing the unknown write charge', async () => {
  const { job, port, ledger, store, connection } = fixture()
  const first = await resolveProviderRoute(job, false, new AbortController().signal, port)
  await first.beforeDispatch!(); await first.settle(undefined, true)
  store.completeJob(job.operation.id, { status: 'pending' })
  const recovered = store.claimPendingJob(Date.now() + 31000, [connection.scope])!
  const read = await resolveProviderRoute(recovered, true, new AbortController().signal, port)
  expect(ledger.summary().outstandingMicros).toBe(210000)
  await read.beforeDispatch!()
  await read.settle({ operationId: job.operation.id, status: 'ok', records: [], usage: { currency: 'USD', cost: .003, estimated: false }, complete: true }, true)
  expect(ledger.summary()).toMatchObject({ outstandingMicros: 200000, dailySpentMicros: 3000 })
})

it('runs the pinned Hindsight adapter behind the certified route while preserving unknown monetary usage', async () => {
  const { job, port, certificate, provider, ledger, store, runnerPort } = fixture()
  certificate.providerId = 'hindsight'
  const request = vi.fn<JsonTransport>(async (_path, _method, body) => ({ success: true, items_count: (body as { items: unknown[] }).items.length, usage: { input_tokens: 100, output_tokens: 20 } }))
  port.provider = () => createHindsightProvider(job.binding.connectionRef, request)
  const claim = runnerPort.claim
  let initial = true
  runnerPort.claim = async (...args) => { if (initial) { initial = false; return job }; return claim(...args) }
  await new OutboxRunner(runnerPort).run(1)
  expect(provider.dispatch).not.toHaveBeenCalled()
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0][0]).toContain(`/banks/${job.binding.namespaceRef}/memories`)
  expect(request.mock.calls[0][2]).toMatchObject({ async: false, items: [{ document_id: job.record!.id, content: job.record!.statement }] })
  expect(store.outbox()[0].status).toBe('confirmed')
  expect(ledger.summary()).toMatchObject({ outstandingMicros: 200000, dailySpentMicros: 0 })
})

it('does not release another route\'s dispatched reservation when duplicate preparation loses the atomic race', async () => {
  const { job, port, ledger } = fixture()
  const first = await resolveProviderRoute(job, false, new AbortController().signal, port)
  const second = await resolveProviderRoute(job, false, new AbortController().signal, port)
  await first.beforeDispatch!()
  await expect(second.beforeDispatch!()).rejects.toThrow('receipt')
  await second.settle(undefined, false)
  expect(ledger.summary().outstandingMicros).toBe(200000)
  await first.settle(undefined, true)
  expect(ledger.summary().outstandingMicros).toBe(200000)
  await first.settle({ status: 'ok', operationId: job.operation.id, records: [], usage: { currency: 'USD', cost: .02, estimated: false }, complete: true }, true)
  expect(ledger.summary()).toMatchObject({ outstandingMicros: 0, dailySpentMicros: 20000 })
})


it.each(['scope', 'revocation', 'deletion'] as const)('refuses %s changes while an asynchronous provider factory is preparing', async change => {
  const { job, port, state, store, record, provider, ledger } = fixture()
  port.provider = async () => {
    await Promise.resolve()
    if (change === 'scope') state.lease = { id: crypto.randomUUID(), projectId: null }
    if (change === 'revocation') state.allowed = false
    if (change === 'deletion') store.forget(record.id)
    return provider
  }
  await expect(resolveProviderRoute(job, false, new AbortController().signal, port)).rejects.toThrow()
  expect(provider.dispatch).not.toHaveBeenCalled()
  expect(ledger.summary().outstandingMicros).toBe(0)
})
