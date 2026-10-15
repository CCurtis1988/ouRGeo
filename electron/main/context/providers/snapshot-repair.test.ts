import { afterEach, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from '../storage'
import { prepareConnection } from './connection-policy'
import type { ProviderBinding } from '../../../../src/lib/context/providers/outbox'
import type { MemoryRecord } from '../../../../src/lib/context/types'

const stores: MemoryStorage[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture() {
  const store = new MemoryStorage(':memory:', randomBytes(32)); stores.push(store)
  const prepared = prepareConnection({ adapter: 'mnemosyne', label: 'Synthetic snapshot repair', endpoint: 'http://127.0.0.1:19834', location: 'loopback', scope: 'global', destinations: ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'].map(purpose => ({ purpose, destination: purpose === 'storage' ? 'http://127.0.0.1:19834' : 'disabled' })) }, null)
  const connection = { ...prepared.connection, localServer: true as const, runtimeId: 'mnemosyne-lexical-v1', state: 'reachable' as const }
  store.saveConnection(connection)
  const binding: ProviderBinding = { id: crypto.randomUUID(), scope: 'global', adapter: 'mnemosyne', adapterVersion: 'synthetic-pin', connectionRef: connection.id, namespaceRef: connection.namespaceRef, policyRevision: 1, enabled: true, writesCertified: true }
  const record = (): MemoryRecord => ({ id: crypto.randomUUID(), scope: 'global', projectId: null, revision: 1, category: 'preference', statement: 'Synthetic approved metric preference', assertion: 'user-declared', evidence: [], status: 'active', supersedes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
  const unapproved = record(); store.save(unapproved)
  store.configureBinding(binding)
  const approved = record(); store.save(approved)
  const job = store.claimJob()!; store.completeJob(job.operation.id, { status: 'confirmed' })
  return { store, binding, approved, unapproved }
}
it('repairs a reactivated bank using only previously approved current revisions', () => {
  const { store, binding, approved, unapproved } = fixture()
  store.configureBinding({ ...binding, policyRevision: 2, enabled: false })
  const changed = { ...unapproved, revision: 2, statement: 'Edited while provider paused' }; store.save(changed)
  const restored = { ...binding, id: crypto.randomUUID() }; store.configureBinding(restored)
  const snapshot = store.bindingSnapshot(restored.id, 'global')
  expect(snapshot.records).toEqual([approved])
  expect(store.repairBindingSnapshot(restored.id, 'global', snapshot.generation)).toBe(true)
  expect(store.repairBindingSnapshot(restored.id, 'global', snapshot.generation)).toBe(false)
  const job = store.claimJob()!
  expect(job.binding.id).toBe(restored.id); expect(job.record?.id).toBe(approved.id)
  store.completeJob(job.operation.id, { status: 'pending' })
  expect(store.repairBindingSnapshot(restored.id, 'global', snapshot.generation)).toBe(false)
  expect(store.list()).toContainEqual(changed)
})
it('refuses stale generations, foreign scopes and revoked bindings before queuing repair', () => {
  const { store, binding } = fixture()
  const snapshot = store.bindingSnapshot(binding.id, 'global'), before = store.outbox()
  expect(() => store.repairBindingSnapshot(binding.id, 'global', snapshot.generation + 1)).toThrow('STALE_SELECTION')
  expect(() => store.repairBindingSnapshot(binding.id, `project:${crypto.randomUUID()}`, snapshot.generation)).toThrow('POLICY_REFUSED')
  expect(store.outbox()).toEqual(before)
  store.configureBinding({ ...binding, enabled: false, policyRevision: 2 })
  expect(() => store.repairBindingSnapshot(binding.id, 'global', snapshot.generation)).toThrow('POLICY_REFUSED')
})
it('reconnects a reviewed Hindsight bank with outstanding tombstones without replaying ingestion', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32)); stores.push(store)
  const prepared = prepareConnection({ adapter: 'hindsight', label: 'Synthetic dedicated Hindsight', endpoint: 'http://127.0.0.1:19835', location: 'loopback', scope: 'global', token: 'synthetic-initial', destinations: ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'].map(purpose => ({ purpose, destination: ['storage', 'embeddings', 'reranking'].includes(purpose) ? 'http://127.0.0.1:19835' : 'disabled' })) }, null)
  const connection = { ...prepared.connection, namespaceRef: crypto.randomUUID(), localProfile: 'hindsight-local-chunks-v1' as const, profileDirectory: '/private/hindsight', state: 'reachable' as const }
  store.saveConnection(connection, prepared.token)
  const binding: ProviderBinding = { id: crypto.randomUUID(), scope: 'global', adapter: 'hindsight', adapterVersion: 'synthetic-pin', connectionRef: connection.id, namespaceRef: connection.namespaceRef, enabled: true, writesCertified: true, policyRevision: 1 }
  store.configureBinding(binding)
  const now = new Date().toISOString(), record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'finding', statement: 'Synthetic forgotten remote copy', assertion: 'user-declared', evidence: [], status: 'active', supersedes: [], createdAt: now, updatedAt: now }
  store.save(record)
  const initial = store.claimJob()!; store.completeJob(initial.operation.id, { status: 'confirmed' })
  store.saveConnection({ ...connection, revision: 2, state: 'disconnected' })
  store.forget(record.id)
  const renewed = { ...connection, revision: 3 }
  store.renewHindsightServer(renewed, connection.namespaceRef + '.' + 'b'.repeat(64))
  const snapshot = store.scopeSnapshot('global'), restored = { ...binding, id: crypto.randomUUID() }
  store.activateBinding(restored, snapshot.generation, [], 3)
  const job = store.claimJob()!
  expect(job.binding.id).toBe(restored.id)
  expect(job.operation.operation).toBe('delete')
  expect(job.operation.canonicalId).toBe(record.id)
  expect(store.outbox().some(item => item.bindingId === restored.id && item.operation === 'upsert')).toBe(false)
  expect(store.list()).toEqual([])
})
