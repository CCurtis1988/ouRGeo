import { afterEach, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStorage } from '../storage'
import { prepareConnection } from './connection-policy'
import type { ProviderBinding } from '../../../../src/lib/context/providers/outbox'
import type { MemoryRecord } from '../../../../src/lib/context/types'

const stores: MemoryStorage[] = [], directories: string[] = []
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
function fixture(disk = false) {
  const directory = disk ? mkdtempSync(join(tmpdir(), 'ourgeo-migration-')) : null
  if (directory) directories.push(directory)
  const path = directory ? join(directory, 'canonical.sqlite') : ':memory:', key = randomBytes(32)
  const store = new MemoryStorage(path, Buffer.from(key)); stores.push(store)
  const connection = () => {
    const endpoint = 'http://127.0.0.1:19834'
    const prepared = prepareConnection({ adapter: 'hindsight', label: 'Synthetic migration provider', endpoint, location: 'loopback', scope: 'global', destinations: ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'].map(purpose => ({ purpose, destination: purpose === 'storage' ? endpoint : 'disabled' })) }, null)
    store.saveConnection({ ...prepared.connection, state: 'reachable' })
    return { id: crypto.randomUUID(), scope: 'global', adapter: 'hindsight', adapterVersion: 'synthetic-pin', namespaceRef: prepared.connection.namespaceRef, connectionRef: prepared.connection.id, policyRevision: 1, enabled: true, writesCertified: true } satisfies ProviderBinding
  }
  const source = connection(), destination = connection()
  store.configureBinding(source)
  const now = new Date().toISOString()
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'SYNTHETIC_MIGRATION_METRIC_DECISION', evidence: [], assertion: 'user-declared', status: 'active', supersedes: [], createdAt: now, updatedAt: now }
  store.save(record)
  return { store, source, destination, record, path, key }
}
function acknowledge(store: MemoryStorage) { const job = store.claimJob()!; expect(job).toBeTruthy(); store.completeJob(job.operation.id, { status: 'confirmed' }); return job }
it('switches primary routing atomically and leaves canonical identity and old copies unchanged', () => {
  const { store, source, destination, record } = fixture(); acknowledge(store)
  const id = store.beginMigration(source.id, destination, store.scopeSnapshot('global').generation, [record.id], 1)
  expect(store.list('global')).toEqual([record])
  expect(store.bindings().filter(binding => binding.enabled)).toEqual([destination])
  expect(store.migrationStatuses(['global'])[0]).toMatchObject({ id, state: 'copying', copiedCount: 0, oldCopyCount: 1 })
  acknowledge(store)
  expect(store.migrationStatuses(['global'])[0]).toMatchObject({ state: 'ready', copiedCount: 1, removedCount: 0 })
  store.finishMigration(id, ['global'], 'retain')
  expect(store.migrationStatuses(['global'])[0].state).toBe('retained')
})
it('requires current destination revisions before approving old-copy deletion', () => {
  const { store, source, destination, record } = fixture(); acknowledge(store)
  const id = store.beginMigration(source.id, destination, store.scopeSnapshot('global').generation, [record.id], 1)
  expect(() => store.finishMigration(id, ['global'], 'delete')).toThrow('acknowledgements')
  acknowledge(store)
  store.save({ ...record, revision: 2, statement: 'SYNTHETIC_MIGRATION_CORRECTED_DECISION', updatedAt: new Date().toISOString() })
  const cleanup = { ...source, id: crypto.randomUUID(), cleanupOnly: true }
  // A previously ready migration must re-evaluate corrections before cleanup.
  expect(() => store.finishMigration(id, ['global'], 'delete', cleanup)).toThrow('acknowledgements')
})
it('uses delete-only authority without ingesting future changes or deleting canonical memory', () => {
  const { store, source, destination, record } = fixture(); acknowledge(store)
  const id = store.beginMigration(source.id, destination, store.scopeSnapshot('global').generation, [record.id], 1); acknowledge(store)
  const cleanup = { ...source, id: crypto.randomUUID(), cleanupOnly: true }
  store.finishMigration(id, ['global'], 'delete', cleanup)
  expect(store.bindingSnapshot(cleanup.id, 'global').records).toEqual([])
  const deleting = acknowledge(store)
  expect(deleting.operation.operation).toBe('delete')
  expect(store.list('global')).toEqual([record])
  expect(store.migrationStatuses(['global'])[0]).toMatchObject({ state: 'complete', removedCount: 1 })
  store.save({ ...record, revision: 2, updatedAt: new Date().toISOString() })
  expect(store.outbox().filter(job => job.bindingId === cleanup.id).every(job => job.operation === 'delete')).toBe(true)
  expect(store.bindings().find(binding => binding.id === cleanup.id)?.enabled).toBe(false)
})
it('blocks cleanup while old ingestion is unresolved and accepts a late final acknowledgement', () => {
  const { store, source, destination, record } = fixture()
  const unresolved = store.claimJob()!
  const id = store.beginMigration(source.id, destination, store.scopeSnapshot('global').generation, [record.id], 1); acknowledge(store)
  const cleanup = { ...source, id: crypto.randomUUID(), cleanupOnly: true }
  expect(() => store.finishMigration(id, ['global'], 'delete', cleanup)).toThrow('uncertain')
  store.completeJob(unresolved.operation.id, { status: 'confirmed' })
  store.finishMigration(id, ['global'], 'delete', cleanup)
  expect(store.migrationStatuses(['global'])[0].state).toBe('cleaning')
})
it('preserves the old primary after a stale selection and refuses cross-scope cleanup', () => {
  const { store, source, destination, record } = fixture(); acknowledge(store)
  const generation = store.scopeSnapshot('global').generation
  store.save({ ...record, revision: 2, updatedAt: new Date().toISOString() })
  expect(() => store.beginMigration(source.id, destination, generation, [record.id], 1)).toThrow('STALE_SELECTION')
  expect(store.bindings().find(binding => binding.id === source.id)?.enabled).toBe(true)
  const id = store.beginBuiltinMigration(source.id, store.scopeSnapshot('global').generation)
  expect(() => store.finishMigration(id, ['project:foreign'], 'retain')).toThrow('SCOPE_CHANGED')
})
it('includes earlier paused bindings in the same old namespace without widening the destination selection', () => {
  const { store, source, destination, record } = fixture(); acknowledge(store)
  store.configureBinding({ ...source, enabled: false, policyRevision: 2 })
  const resumed = { ...source, id: crypto.randomUUID() }; store.configureBinding(resumed)
  const second = { ...record, id: crypto.randomUUID(), statement: 'SYNTHETIC_RESUMED_PROVIDER_SELECTION' }; store.save(second); acknowledge(store)
  const id = store.beginMigration(resumed.id, destination, store.scopeSnapshot('global').generation, [second.id], 1)
  expect(store.migrationBindings(id, ['global']).migration.sourceIds.sort()).toEqual([record.id, second.id].sort())
  expect(store.outbox().filter(job => job.bindingId === destination.id).map(job => job.canonicalId)).toEqual([second.id])
})
it('keeps acknowledged current imports approved after reactivation without backfilling revisions edited while paused', () => {
  const { store, source, record } = fixture(); acknowledge(store)
  store.configureBinding({ ...source, enabled: false, policyRevision: 2 })
  const resumed = { ...source, id: crypto.randomUUID() }; store.configureBinding(resumed)
  expect(store.bindingSnapshot(resumed.id, 'global').records).toEqual([record])
  store.configureBinding({ ...resumed, enabled: false, policyRevision: 2 })
  store.save({ ...record, revision: 2, statement: 'SYNTHETIC_EDITED_WHILE_PAUSED', updatedAt: new Date().toISOString() })
  const later = { ...source, id: crypto.randomUUID() }; store.configureBinding(later)
  expect(store.bindingSnapshot(later.id, 'global').records).toEqual([])
})
it('accepts only the exact captured old-write revision when recording privileged reconciliation', () => {
  const { store, source, record } = fixture(), pending = store.claimJob()!
  const id = store.beginBuiltinMigration(source.id, store.scopeSnapshot('global').generation)
  expect(store.migrationUncertainWrites(id, ['global'])).toEqual([{ id: pending.operation.id, canonicalId: record.id, revision: 1 }])
  expect(() => store.acknowledgeMigrationWrites(id, ['global'], [{ id: pending.operation.id, revision: 2 }])).toThrow('STALE_OPERATION')
  expect(() => store.acknowledgeMigrationWrites(id, ['project:foreign'], [{ id: pending.operation.id, revision: 1 }])).toThrow('SCOPE_CHANGED')
  store.acknowledgeMigrationWrites(id, ['global'], [{ id: pending.operation.id, revision: 1 }])
  expect(store.migrationUncertainWrites(id, ['global'])).toEqual([])
  expect(store.list('global')).toEqual([record])
  store.finishMigration(id, ['global'], 'delete', { ...source, id: crypto.randomUUID(), cleanupOnly: true })
  expect(store.migrationStatuses(['global'])[0].state).toBe('cleaning')
})
it('does not silently restore approved old copies after migration cleanup and later reactivation', () => {
  const { store, source, record } = fixture(); acknowledge(store)
  const id = store.beginBuiltinMigration(source.id, store.scopeSnapshot('global').generation)
  store.finishMigration(id, ['global'], 'delete', { ...source, id: crypto.randomUUID(), cleanupOnly: true }); acknowledge(store)
  expect(store.migrationStatuses(['global'])[0].state).toBe('complete')
  const resumed = { ...source, id: crypto.randomUUID() }; store.configureBinding(resumed)
  expect(store.bindingSnapshot(resumed.id, 'global').records).toEqual([])
  expect(store.list('global')).toEqual([record])
})
it('switches to built-in memory without any provider write and records deliberate retention', () => {
  const { store, source, record } = fixture(); acknowledge(store)
  const before = store.outbox().length
  const id = store.beginBuiltinMigration(source.id, store.scopeSnapshot('global').generation)
  expect(store.outbox()).toHaveLength(before)
  expect(store.migrationStatuses(['global'])[0]).toMatchObject({ state: 'ready', copiedCount: 1 })
  store.finishMigration(id, ['global'], 'retain')
  expect(store.list('global')).toEqual([record])
})
it('retains encrypted migration progress across a worker restart and cancels without losing canonical data', async () => {
  const { store, source, destination, record, path, key } = fixture(true); acknowledge(store)
  const id = store.beginMigration(source.id, destination, store.scopeSnapshot('global').generation, [record.id], 1)
  store.close(); stores.splice(stores.indexOf(store), 1)
  expect((await readFile(path)).includes(Buffer.from(record.statement))).toBe(false)
  const restarted = new MemoryStorage(path, Buffer.from(key)); stores.push(restarted)
  expect(restarted.migrationStatuses(['global'])[0]).toMatchObject({ id, state: 'copying' })
  restarted.cancelMigration(id, ['global'])
  expect(restarted.migrationStatuses(['global'])[0].state).toBe('cancelled')
  expect(restarted.bindings().filter(binding => binding.enabled)).toEqual([])
  expect(restarted.list('global')).toEqual([record])
})
