import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from './storage'
import type { MemoryRecord } from '../../../src/lib/context/types'
import type { ProviderBinding } from '../../../src/lib/context/providers/outbox'

const stores: MemoryStorage[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close() })
function fixture(certified = true): { store: MemoryStorage; binding: ProviderBinding; record: MemoryRecord } {
  const store = new MemoryStorage(':memory:', randomBytes(32)); stores.push(store)
  const binding: ProviderBinding = { id: 'connection:global', scope: 'global', adapter: 'hindsight', adapterVersion: 'v0.10.2', namespaceRef: 'private:global', connectionRef: 'connection:1', policyRevision: 1, enabled: true, writesCertified: certified }
  store.configureBinding(binding)
  const now = new Date().toISOString()
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Prefer metric units', evidence: [], assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] }
  return { store, binding, record }
}

describe('transactional provider outbox', () => {
  it('publishes only an atomically committed project snapshot, including draft revision jumps', () => {
    const { store, binding, record } = fixture()
    const projectId = crypto.randomUUID(), scope = `project:${projectId}`
    store.configureBinding({ ...binding, id: 'project-binding', scope, namespaceRef: 'private:project' })
    const memory = { ...record, scope: 'project' as const, projectId }
    const saved = { version: 1 as const, revision: 1, memories: [memory] }
    store.stageProject(projectId, 0, saved)
    expect(store.list(scope)).toEqual([])
    expect(store.outbox()).toEqual([])
    store.commitProject(projectId, saved)
    expect(store.list(scope)).toEqual([memory])
    expect(store.recoverProject(projectId, 0)).toBeNull()
    const first = store.claimJob()!
    expect(first.record).toEqual(memory)
    store.completeJob(first.operation.id, { status: 'confirmed' })
    const revised = { ...memory, revision: 4, statement: 'Use metres for this project' }
    const newer = { ...saved, revision: 4, memories: [revised] }
    // An edit arriving during save remains recoverable against the new base.
    store.stageProject(projectId, 1, { ...newer, revision: 5 })
    store.commitProject(projectId, newer)
    expect(store.recoverProject(projectId, 4)?.revision).toBe(5)
    expect(store.list(scope)).toEqual([revised])
    expect(() => store.commitProject(projectId, saved)).toThrow('newer local memory')
    expect(store.list(scope)).toEqual([revised])
    expect(store.claimJob()?.record).toEqual(revised)
  })
  it('rolls back the whole project publication on a foreign memory identity and honours tombstones', () => {
    const { store, record } = fixture()
    store.save(record)
    const projectId = crypto.randomUUID()
    const independent = { ...record, id: crypto.randomUUID(), scope: 'project' as const, projectId }
    const foreign = { ...independent, id: record.id }
    expect(() => store.commitProject(projectId, { version: 1, revision: 1, memories: [independent, foreign] })).toThrow('another scope')
    expect(store.list(`project:${projectId}`)).toEqual([])
    store.commitProject(projectId, { version: 1, revision: 1, memories: [independent] })
    store.forget(independent.id, [], `project:${projectId}`)
    store.commitProject(projectId, { version: 1, revision: 1, memories: [independent] })
    expect(store.list(`project:${projectId}`)).toEqual([])
    expect(store.list('global')).toEqual([record])
  })
  it('commits once with canonical changes and keeps retry operation IDs stable', () => {
    const { store, record } = fixture()
    store.save(record); store.save(record)
    expect(store.outbox()).toHaveLength(1)
    const first = store.claimJob()!
    expect(first.record).toEqual(record)
    store.completeJob(first.operation.id, { status: 'retry' })
    expect(store.claimJob()).toBeNull()
    const retry = store.claimJob(Date.now() + 3000)!
    expect(retry.operation.id).toBe(first.operation.id)
    expect(retry.operation.attempts).toBe(2)
    store.completeJob(retry.operation.id, { status: 'confirmed' })
    expect(store.claimJob(Date.now() + 60000)).toBeNull()
    expect(store.list()).toEqual([record])
  })

  it('never sends candidates, draft project memories or uncertified writes', () => {
    const { store, record } = fixture(false)
    store.save(record)
    expect(store.claimJob()).toBeNull()
    const second = fixture()
    second.store.save({ ...second.record, status: 'candidate' })
    expect(second.store.claimJob()).toBeNull()
    const projectId = crypto.randomUUID()
    second.store.configureBinding({ ...second.binding, id: 'project-binding', scope: `project:${projectId}`, namespaceRef: 'private:project' })
    second.store.stageProject(projectId, 0, { version: 1, revision: 1, memories: [{ ...record, id: crypto.randomUUID(), scope: 'project', projectId }] })
    expect(second.store.claimJob()).toBeNull()
  })

  it('blocks local retrieval before deleting and compensates for a late ingestion receipt', () => {
    const { store, record } = fixture()
    store.save(record)
    const ingestion = store.claimJob()!
    store.forget(record.id)
    expect(store.search('metric')).toEqual([])
    const deletion = store.claimJob()!
    expect(deletion.operation.operation).toBe('delete')
    expect(deletion.record).toBeUndefined()
    store.completeJob(deletion.operation.id, { status: 'confirmed' })
    // The server finishes the cancelled ingestion after its first deletion.
    store.completeJob(ingestion.operation.id, { status: 'confirmed' })
    const compensation = store.claimJob()!
    expect(compensation.operation.operation).toBe('delete')
    expect(compensation.operation.id).not.toBe(deletion.operation.id)
    expect(() => store.save(record)).toThrow('forgotten')
  })

  it('stops a revoked connection and never reuses its namespace for another scope', () => {
    const { store, binding, record } = fixture()
    store.save(record)
    const job = store.claimJob()!
    store.configureBinding({ ...binding, enabled: false, policyRevision: 2 })
    store.completeJob(job.operation.id, { status: 'confirmed' })
    expect(store.outbox()[0]).toMatchObject({ status: 'cancelled', reason: 'revoked' })
    expect(store.claimJob(Date.now() + 60000)).toBeNull()
    expect(() => store.configureBinding({ ...binding, scope: `project:${crypto.randomUUID()}`, policyRevision: 3 })).toThrow('migration')
    expect(store.list()).toEqual([record])
  })

  it('requires reconciliation after a crashed paid upsert and retries source deletion', () => {
    const { store, record } = fixture()
    store.save(record)
    const running = store.claimJob()!
    expect(store.claimJob(Date.now() + 31000)).toBeNull()
    expect(store.outbox()[0]).toMatchObject({ id: running.operation.id, status: 'pending', reason: 'awaiting-completion' })
    store.completeJob(running.operation.id, { status: 'confirmed' })
    store.forget(record.id)
    const deletion = store.claimJob()!
    const retry = store.claimJob(Date.now() + 31000)!
    expect(retry.operation.id).toBe(deletion.operation.id)
    expect(retry.operation.attempts).toBe(2)
  })

  it('orders revisions and restores the latest copy after an old write finishes late', () => {
    const { store, record } = fixture()
    store.save(record)
    const old = store.claimJob()!
    const revised = { ...record, revision: 2, statement: 'Prefer imperial units' }
    store.save(revised)
    const latest = store.claimJob()!
    expect(latest.record).toEqual(revised)
    store.completeJob(latest.operation.id, { status: 'confirmed' })
    store.completeJob(old.operation.id, { status: 'confirmed' })
    expect(store.claimJob()?.record).toEqual(revised)
    expect(store.list()).toEqual([revised])
  })
})
