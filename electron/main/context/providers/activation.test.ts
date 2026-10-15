import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from '../storage'
import type { MemoryRecord } from '../../../../src/lib/context/types'
import type { ProviderBinding } from '../../../../src/lib/context/providers/outbox'
import { prepareConnection } from './connection-policy'
import { DeploymentRegistry, type DeploymentReview } from './certification'
import { connectionDigest } from './routing'
import { HINDSIGHT_PROFILE } from './hindsight'
import { ProviderActivation, type ActivationHost } from './activation'
import { MNEMOSYNE_LOCAL_CANDIDATE } from '../runtime-catalogue'
import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture(projectId: string | null = null, provider?: ActivationHost['provider']) {
  const store = new MemoryStorage(':memory:', randomBytes(32)); cleanups.push(() => store.close())
  store.maintenance().configure({ revision: 1, enabled: true, currency: 'USD', mode: 'estimated', dailyMicros: 1000000, monthlyMicros: 2000000 })
  const { connection: configured, token } = prepareConnection({ adapter: 'hindsight', label: 'Synthetic deployment only', endpoint: 'https://memory.example.invalid', location: 'server', scope: projectId ? 'project' : 'global', token: 'synthetic-unused-secret',
    destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'https://memory.example.invalid/' : 'disabled' })) }, projectId)
  store.saveConnection(configured, token)
  const connection = { ...configured, revision: 2, state: 'reachable' as const }; store.saveConnection(connection)
  let now = Date.now()
  const review: DeploymentReview = { id: 'synthetic-review-only', adapter: 'hindsight', adapterVersion: HINDSIGHT_PROFILE.commit, providerId: 'hindsight', connectionDigest: connectionDigest(connection), reviewedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(),
    audits: Object.fromEntries(['authenticated-transport', 'scope-access-control', 'derivative-deletion', 'processing-destinations', 'bounded-billing', 'recovery'].map(name => [name, { status: 'passed', evidenceSha256: 'a'.repeat(64) }])) as DeploymentReview['audits'],
    conformance: { version: 1, certification: 'not-issued', checks: ['probe and response contract', 'permission revocation', 'cancellation', 'canonical ingestion and idempotent retry', 'namespace isolation', 'bounded response', 'revision replacement', 'source deletion preserves unrelated records', 'cleanup first', 'cleanup second'].map(name => ({ name, status: 'passed' })) },
    isolation: 'native', timeoutMs: 1000, maxTokens: 2000,
    operations: { read: { processing: 'non-billable' }, delete: { processing: 'non-billable' }, upsert: { processing: 'paid', estimateMicros: 200000, boundedOperation: true, pricingVersion: 'synthetic-v1', pricingExpiresAt: new Date(now + 3600000).toISOString() } } }
  const registry = new DeploymentRegistry([review], () => now)
  const lease = { id: crypto.randomUUID(), projectId }
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: projectId ? 'project' : 'global', projectId, category: 'preference', statement: 'Synthetic fixture metric units', evidence: [], assertion: 'user-declared', status: 'active', supersedes: [], createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }
  if (projectId) store.commitProject(projectId, { version: 1, revision: 1, memories: [record] }); else store.save(record)
  const dispatch = vi.fn<ActivationHost['dispatch']>(async (operation, value, guard) => {
    if (['activateBinding', 'importBinding', 'configureBinding'].includes(operation)) activation.invalidate()
    guard?.()
    const input = value as Record<string, unknown>
    switch (operation) {
      case 'scopedProviderState': { const scopes = value as string[]; return { connections: store.connections().filter(item => scopes.includes(item.scope)), bindings: store.bindings().filter(item => scopes.includes(item.scope)) } }
      case 'scopeSnapshot': return store.scopeSnapshot(String(value))
      case 'beginBuiltinMigration': return store.beginBuiltinMigration(String(input.sourceBindingId), Number(input.generation))
      case 'beginMigration': return store.beginMigration(String(input.sourceBindingId), input.binding as ProviderBinding, Number(input.generation), input.ids as string[], Number(input.connectionRevision))
      case 'migrationStatuses': return store.migrationStatuses(value as string[])
      case 'migrationBindings': return store.migrationBindings(String(input.id), input.scopes as string[])
      case 'migrationUncertainWrites': return store.migrationUncertainWrites(String(input.id), input.scopes as string[])
      case 'acknowledgeMigrationWrites': return store.acknowledgeMigrationWrites(String(input.id), input.scopes as string[], input.receipts as Array<{ id: string; revision: number }>)
      case 'finishMigration': return store.finishMigration(String(input.id), input.scopes as string[], input.choice as 'retain' | 'delete', input.binding as ProviderBinding | undefined, input.connectionRevision as number | undefined)
      case 'cancelMigration': return store.cancelMigration(String(input.id), input.scopes as string[])
      case 'maintenanceStatus': return { policy: store.maintenance().policy(), summary: store.maintenance().summary() }
      case 'importBinding': return store.importBinding(input.binding as ProviderBinding, Number(input.generation), input.ids as string[], Number(input.connectionRevision))
      case 'activateBinding': return store.activateBinding(input.binding as ProviderBinding, Number(input.generation), input.ids as string[], Number(input.connectionRevision))
      case 'configureBinding': return store.configureBinding(value as ProviderBinding)
      case 'claimPendingOutbox': return store.claimPendingJob(Number(input.now), input.scopes as string[])
      case 'claimOutbox': return store.claimJob(Number(input.now), input.scopes as string[])
      case 'currentOutbox': return store.currentJob(String(input.id), input.scopes as string[])
      case 'scopedConnection': return store.connections().find(item => item.id === input.id && (input.scopes as string[]).includes(item.scope))
      case 'scopedCredential': return store.credential(String(input.reference))
      case 'reserveMaintenance': return store.maintenance().reserve(value as Parameters<ReturnType<MemoryStorage['maintenance']>['reserve']>[0])
      case 'dispatchMaintenance': return store.maintenance().markDispatched(String(value))
      case 'settleMaintenance': return store.maintenance().settle(String(input.id), input.result as Parameters<ReturnType<MemoryStorage['maintenance']>['settle']>[1], Boolean(input.dispatched), Boolean(input.prepared))
      case 'completeOutbox': return store.completeJob(String(input.id), input.receipt as Parameters<MemoryStorage['completeJob']>[1], Number(input.now))
      default: throw new Error(`Unsupported fixture operation ${operation}`)
    }
  })
  const approve = vi.fn<ActivationHost['approve']>(async () => true)
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, items_count: 1 })))
  const activation = new ProviderActivation({ dispatch, lease: () => ({ ...lease }), registry, approve, fetcher, provider, now: () => now }); cleanups.push(() => activation.stop())
  return { store, connection, record, registry, review, lease, activation, dispatch, approve, fetcher, advance: (ms: number) => { now += ms } }
}

it('reviews a switch to built-in memory, keeps canonical records and requires a separate old-copy decision', async () => {
  const { activation, connection, record, lease, store, approve, fetcher } = fixture()
  const preview = await activation.preview(connection.id, [], lease.id)
  await activation.activate(preview.ref)
  approve.mockResolvedValueOnce(false)
  expect(await activation.useBuiltin(connection.id, lease.id)).toBe(false)
  expect(await activation.migrationStatuses()).toEqual([])
  expect(store.bindings().some(binding => binding.enabled)).toBe(true)
  expect(await activation.useBuiltin(connection.id, lease.id)).toBe(true)
  const migration = (await activation.migrationStatuses())[0]
  expect(migration).toMatchObject({ state: 'ready', selectedCount: 1, copiedCount: 1 })
  expect(store.list('global')).toEqual([record])
  expect(store.bindings().some(binding => binding.enabled)).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  expect(await activation.finishMigration(migration.id, 'retain', lease.id)).toBe(true)
  expect((await activation.migrationStatuses())[0].state).toBe('retained')
})

it.each(['expiry', 'workspace', 'revocation'] as const)('rejects %s changes during native built-in migration review', async fault => {
  const { activation, connection, lease, store, approve, advance } = fixture()
  await activation.activate((await activation.preview(connection.id, [], lease.id)).ref)
  approve.mockImplementationOnce(async () => {
    if (fault === 'expiry') advance(61000)
    if (fault === 'workspace') lease.id = crypto.randomUUID()
    if (fault === 'revocation') activation.invalidate()
    return true
  })
  await expect(activation.useBuiltin(connection.id, lease.id)).rejects.toThrow(fault === 'expiry' ? 'STALE_SELECTION' : 'SCOPE_CHANGED')
  expect(store.migrationStatuses(['global'])).toEqual([])
  expect(store.bindings().some(binding => binding.enabled)).toBe(true)
})

it('cancels native cleanup without a delete binding and rejects connection changes during approval', async () => {
  const { activation, connection, lease, store, approve } = fixture()
  await activation.activate((await activation.preview(connection.id, [], lease.id)).ref)
  await activation.useBuiltin(connection.id, lease.id)
  const migration = (await activation.migrationStatuses())[0]
  approve.mockResolvedValueOnce(false)
  expect(await activation.finishMigration(migration.id, 'delete', lease.id)).toBe(false)
  expect(store.bindings().some(binding => binding.cleanupOnly)).toBe(false)
  approve.mockImplementationOnce(async () => { store.saveConnection({ ...connection, revision: connection.revision + 1 }); activation.invalidate(); return true })
  await expect(activation.finishMigration(migration.id, 'delete', lease.id)).rejects.toThrow('SCOPE_CHANGED')
  expect(store.bindings().some(binding => binding.cleanupOnly)).toBe(false)
})

it('requires reviewed deployment evidence rather than health or a conformance pass alone', async () => {
  const { connection, review } = fixture()
  expect(new DeploymentRegistry([]).review(connection)).toBeUndefined()
  for (const audit of Object.keys(review.audits) as Array<keyof DeploymentReview['audits']>) {
    const altered = structuredClone(review); delete (altered.audits as Partial<DeploymentReview['audits']>)[audit]
    expect(new DeploymentRegistry([altered]).review(connection)).toBeUndefined()
  }
  const unsupported = structuredClone(review); unsupported.conformance.checks[4].status = 'unsupported'
  expect(new DeploymentRegistry([unsupported]).review(connection)).toBeUndefined()
})
it('reconciles a snapshot profile’s uncertain old write without replaying ingestion before cleanup', async () => {
  const calls: string[] = []
  const provider: MemoryProviderDef = { id: 'mnemosyne-managed', label: 'Synthetic snapshot profile', apiVersion: 1, location: { kind: 'managed-local', runtimeId: MNEMOSYNE_LOCAL_CANDIDATE.id },
    capabilities: { lexicalSearch: true, semanticSearch: false, temporalSearch: false, readById: true, upsert: true, deleteBySource: true, deleteScope: false, export: false, reflection: false, usageReporting: false, scopeIsolation: 'dedicated-instance' },
    dispatch: async (operation, host) => {
      calls.push(operation.operation)
      return { status: 'ok', operationId: host.idempotencyKey, complete: true, records: operation.operation === 'upsert' ? operation.records : [], evidence: [], usage: { estimated: true } }
    } }
  const { activation, store, connection: prior, review, registry, record, lease } = fixture(null, async () => provider)
  const connection = { ...prior, id: crypto.randomUUID(), namespaceRef: crypto.randomUUID(), revision: 1, adapter: 'mnemosyne' as const, location: 'managed-local' as const, runtimeId: MNEMOSYNE_LOCAL_CANDIDATE.id, endpoint: 'on-device', credentialRef: null,
    destinations: prior.destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? 'on-device' : 'disabled' })) }
  store.saveConnection(connection)
  registry.registerManaged({ ...review, connectionId: connection.id, connectionDigest: connectionDigest(connection), adapter: 'mnemosyne', adapterVersion: MNEMOSYNE_LOCAL_CANDIDATE.provider.commit, providerId: 'mnemosyne-managed', isolation: 'dedicated-instance',
    operations: { search: { processing: 'non-billable' }, read: { processing: 'non-billable' }, upsert: { processing: 'non-billable' }, delete: { processing: 'non-billable' } } })
  store.activateBinding(registry.binding(connection), store.scopeSnapshot('global').generation, [record.id], connection.revision)
  expect(store.claimJob()).toBeTruthy() // Simulate a crash after claim, before a final receipt.
  await activation.useBuiltin(connection.id, lease.id)
  const migration = (await activation.migrationStatuses())[0]
  expect(store.migrationUncertainWrites(migration.id, ['global'])).toHaveLength(1)
  expect(await activation.finishMigration(migration.id, 'delete', lease.id)).toBe(true)
  expect(calls.filter(value => value === 'upsert')).toHaveLength(0)
  expect(calls).toContain('read')
  expect(store.migrationUncertainWrites(migration.id, ['global'])).toEqual([])
  expect(store.list('global')).toEqual([record])
})

it.each(['digest', 'pin', 'expired', 'duplicate', 'failed', 'price'] as const)('refuses %s certification evidence without granting a binding', fault => {
  const { review, connection } = fixture()
  if (fault === 'digest') review.connectionDigest = 'b'.repeat(64)
  if (fault === 'pin') review.adapterVersion = 'unreviewed-latest'
  if (fault === 'expired') review.expiresAt = '2026-01-01T00:00:00Z'
  if (fault === 'duplicate') review.conformance.checks.push(review.conformance.checks[0])
  if (fault === 'failed') review.conformance.checks[0].status = 'failed'
  if (fault === 'price' && review.operations.upsert?.processing === 'paid') review.operations.upsert.pricingExpiresAt = '2026-01-01T00:00:00Z'
  expect(() => new DeploymentRegistry([review]).binding(connection)).toThrow('PROVIDER_UNCERTIFIED')
})

it('previews selected committed memory without sending it and cancels native consent without writes', async () => {
  const { activation, connection, record, lease, store, approve, fetcher } = fixture()
  const preview = await activation.preview(connection.id, [record.id], lease.id)
  expect(preview).toMatchObject({ selectedCount: 1, estimatedIngestionMicros: 200000, futureWrites: true })
  expect(preview).not.toHaveProperty('namespace')
  expect(fetcher).not.toHaveBeenCalled()
  approve.mockResolvedValue(false)
  expect(await activation.activate(preview.ref)).toBe(false)
  expect(store.bindings()).toEqual([])
  expect(store.outbox()).toEqual([])
})

it('activates only the approved selection and dispatches through the reviewed adapter with spend held for unknown usage', async () => {
  const { activation, connection, record, lease, store, fetcher, advance } = fixture()
  const preview = await activation.preview(connection.id, [record.id], lease.id)
  expect(await activation.activate(preview.ref)).toBe(true)
  advance(1000); activation.wake()
  await vi.waitFor(() => expect(store.outbox()[0]?.status).toBe('confirmed'))
  expect(fetcher).toHaveBeenCalledOnce()
  expect(store.maintenance().summary().outstandingMicros).toBe(200000)
  await activation.pause(connection.id)
  expect(store.bindings()[0].enabled).toBe(false)
  expect(await activation.status()).toMatchObject([{ state: 'paused' }])
  const resume = await activation.preview(connection.id, [], lease.id)
  expect(await activation.activate(resume.ref)).toBe(true)
  expect(await activation.status()).toMatchObject([{ state: 'active' }])
  expect(store.bindings().filter(binding => binding.enabled)).toHaveLength(1)
  expect(fetcher).toHaveBeenCalledOnce()
})

it.each(['edit', 'forget', 'switch', 'disconnect', 'expire'] as const)('rejects %s after preview rather than activating stale consent', async change => {
  const { activation, connection, record, lease, store, approve, advance, fetcher } = fixture()
  const preview = await activation.preview(connection.id, [record.id], lease.id)
  approve.mockImplementation(async () => {
    if (change === 'edit') store.save({ ...record, revision: 2, statement: 'Synthetic changed preference' })
    if (change === 'forget') store.forget(record.id, [], 'global')
    if (change === 'switch') lease.id = crypto.randomUUID()
    if (change === 'disconnect') store.saveConnection({ ...connection, state: 'disconnected', revision: 3 })
    if (change === 'expire') advance(61000)
    return true
  })
  await expect(activation.activate(preview.ref)).rejects.toThrow()
  expect(store.bindings()).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})

it('never exports foreign memories or draft project records in an activation selection', async () => {
  const { activation, connection, lease, store, record } = fixture(crypto.randomUUID())
  const draft = { ...record, id: crypto.randomUUID(), statement: 'Synthetic unsaved decision' }
  store.stageProject(lease.projectId!, 1, { version: 1, revision: 2, memories: [record, draft] })
  await expect(activation.preview(connection.id, [draft.id], lease.id)).rejects.toThrow('committed')
  await expect(activation.preview(connection.id, [crypto.randomUUID()], lease.id)).rejects.toThrow('committed')
  expect(store.bindings()).toEqual([])
})

it('keeps existing records local when activation approves future updates only', async () => {
  const { activation, connection, lease, store, fetcher } = fixture()
  const preview = await activation.preview(connection.id, [], lease.id)
  await activation.activate(preview.ref)
  expect(store.bindings()[0].enabled).toBe(true)
  expect(store.outbox()).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})

it('keeps managed rebuild snapshots limited to approved writes rather than exporting existing scope history', () => {
  const { connection, record, store, registry } = fixture()
  const binding = registry.binding(connection), generation = store.scopeSnapshot('global').generation
  store.activateBinding(binding, generation, [], connection.revision)
  expect(store.bindingSnapshot(binding.id, 'global').records).toEqual([])
  const other = { ...record, id: crypto.randomUUID(), statement: 'Synthetic newly approved preference' }
  store.save(other)
  expect(store.bindingSnapshot(binding.id, 'global').records).toEqual([other])
  const before = store.scopeSnapshot('global').generation
  store.exclude('global', `memory:${other.id}`, true)
  expect(store.bindingSnapshot(binding.id, 'global').records).toEqual([])
  expect(store.scopeSnapshot('global').generation).toBeGreaterThan(before)
  expect(store.claimJob(Date.now() + 1000, ['global'])).toBeNull()
  store.exclude('global', `memory:${other.id}`, false)
  store.forget(other.id, [], 'global')
  expect(store.bindingSnapshot(binding.id, 'global').records).toEqual([])
})


it('imports only a separately approved selection into an active binding and retries without duplicate jobs', async () => {
  const { activation, connection, record, store, registry, lease } = fixture()
  const binding = registry.binding(connection)
  store.activateBinding(binding, store.scopeSnapshot('global').generation, [], connection.revision)
  const previousSnapshot = store.bindingSnapshot(binding.id, 'global')
  expect(previousSnapshot.records).toEqual([])
  const canonicalGeneration = store.scopeSnapshot('global').generation
  const preview = await activation.preview(connection.id, [record.id], lease.id, 'import')
  expect(preview).toMatchObject({ operation: 'import', selectedCount: 1 })
  expect(await activation.activate(preview.ref)).toBe(true)
  expect(store.bindingSnapshot(binding.id, 'global').records).toEqual([record])
  expect(store.bindingSnapshot(binding.id, 'global').generation).toBeGreaterThan(previousSnapshot.generation)
  expect(store.scopeSnapshot('global').generation).toBe(canonicalGeneration)
  expect(store.bindingSnapshotCurrent(binding.id, 'global', previousSnapshot.generation)).toBe(false)
  expect(store.bindings()).toHaveLength(1)
  const again = await activation.preview(connection.id, [record.id], lease.id, 'import')
  await activation.activate(again.ref)
  expect(store.outbox()).toHaveLength(1)
})
it('rejects an import if its binding is paused after native review opens', async () => {
  const { activation, connection, record, store, registry, lease, approve } = fixture()
  const binding = registry.binding(connection)
  store.activateBinding(binding, store.scopeSnapshot('global').generation, [], connection.revision)
  const preview = await activation.preview(connection.id, [record.id], lease.id, 'import')
  approve.mockImplementation(async () => { store.configureBinding({ ...binding, enabled: false, policyRevision: 2 }); return true })
  await expect(activation.activate(preview.ref)).rejects.toThrow('STALE_SELECTION')
  expect(store.outbox()).toEqual([])
})

it('retries one revoked status read only while the same workspace lease remains active', async () => {
  const { activation, dispatch } = fixture()
  const original = dispatch.getMockImplementation()!
  dispatch.mockImplementationOnce(async (...args) => { const result = await original(...args); activation.invalidate(); return result })
  expect(await activation.status()).toMatchObject([{ state: 'ready' }])
  expect(dispatch).toHaveBeenCalledTimes(2)
})
it('does not retry a status read into another workspace', async () => {
  const { activation, dispatch, lease } = fixture()
  const original = dispatch.getMockImplementation()!
  dispatch.mockImplementationOnce(async (...args) => { const result = await original(...args); lease.id = crypto.randomUUID(); return result })
  await expect(activation.status()).rejects.toThrow('SCOPE_CHANGED')
  expect(dispatch).toHaveBeenCalledOnce()
})
