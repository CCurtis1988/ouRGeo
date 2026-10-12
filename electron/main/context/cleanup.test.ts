import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { MemoryStorage } from './storage'
import { LocalCleanupRunner } from './cleanup'
import type { MemoryRecord } from '../../../src/lib/context/types'

const dirs: string[] = []
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const record = (): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Synthetic secret-looking personal preference for metric units.', evidence: ['source-event'], assertion: 'user-declared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'active', supersedes: [] })
function bind(store: MemoryStorage): string {
  const namespace = crypto.randomUUID()
  store.configureBinding({ id: crypto.randomUUID(), scope: 'global', adapter: 'mnemosyne', adapterVersion: '1', connectionRef: crypto.randomUUID(), namespaceRef: namespace, policyRevision: 1, enabled: false, writesCertified: false })
  return namespace
}

it('commits encrypted content-free cleanup with forgetting and resumes it after reopening a disconnected store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ourgeo-cleanup-')); dirs.push(dir)
  const path = join(dir, 'canonical.sqlite'), key = randomBytes(32), memory = record()
  let store = new MemoryStorage(path, Buffer.from(key))
  const namespace = bind(store)
  store.save(memory); store.forget(memory.id)
  expect(store.search('metric')).toEqual([])
  expect(JSON.stringify(store.cleanupJobs())).not.toContain(memory.statement)
  for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name)).includes(Buffer.from(namespace))).toBe(false)
  store.close()
  store = new MemoryStorage(path, Buffer.from(key))
  expect(store.cleanupStatus(['global']).pending).toBe(1)
  const remove = vi.fn(async () => undefined)
  const runner = new LocalCleanupRunner({ jobs: async () => store.cleanupJobs(), remove, complete: async (job, success, now) => store.completeCleanup(job, success, now) })
  await runner.flush(); runner.stop()
  expect(remove).toHaveBeenCalledWith(namespace)
  expect(store.cleanupStatus(['global'])).toEqual({ pending: 0, needsReview: 0, nextAttemptAt: null })
  expect(store.filterLearningSources(['source-event'])).toEqual([])
  store.close()
})

it('bounds failed cleanup retries and permits a current-scope manual retry without restoring memory', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32)), memory = record()
  bind(store); store.save(memory); store.forget(memory.id)
  for (let attempt = 0; attempt < 6; attempt++) {
    const job = store.cleanupJobs()[0]
    store.completeCleanup(job, false, 1000)
    expect(store.cleanupJobs()[0].attempts).toBe(attempt + 1)
  }
  expect(store.cleanupStatus(['global']).needsReview).toBe(1)
  store.retryCleanup([`project:${crypto.randomUUID()}`])
  expect(store.cleanupStatus(['global']).needsReview).toBe(1)
  store.retryCleanup(['global'])
  expect(store.cleanupJobs()[0]).toMatchObject({ attempts: 0, state: 'pending' })
  expect(store.search('metric')).toEqual([])
  store.close()
})

it('does not let late completion acknowledge a newer purge even after an earlier purge succeeded', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32)), memory = record(), next = record()
  bind(store); store.save(memory); store.forget(memory.id)
  const old = store.cleanupJobs()[0]
  store.completeCleanup(old, true, 0)
  store.save(next); store.forget(next.id)
  store.completeCleanup(old, true, 0)
  expect(store.cleanupStatus(['global']).pending).toBe(1)
  expect(store.cleanupJobs()[0].generation).toBe(old.generation + 1)
  const fresh = store.cleanupJobs()[0]
  store.completeCleanup(fresh, false, 0)
  store.completeCleanup(fresh, true, 0)
  expect(store.cleanupStatus(['global']).pending).toBe(1)
  store.close()
})

it('migrates older forgetting receipts into a recoverable purge without enabling a provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ourgeo-cleanup-migration-')); dirs.push(dir)
  const path = join(dir, 'canonical.sqlite'), key = randomBytes(32), memory = record()
  const original = new MemoryStorage(path, Buffer.from(key))
  bind(original); original.save(memory); original.forget(memory.id); original.close()
  const db = new DatabaseSync(path)
  db.exec('DROP TABLE local_cleanup; PRAGMA user_version=12;'); db.close()
  const migrated = new MemoryStorage(path, Buffer.from(key))
  expect(migrated.cleanupStatus(['global']).pending).toBe(1)
  expect(migrated.bindings()[0].enabled).toBe(false)
  expect(migrated.search('metric')).toEqual([])
  expect(readdirSync(join(dir, 'migration-backups')).length).toBeGreaterThan(0)
  migrated.close()
})

it('retries removal on a timer but stops automatic attempts when durable status requires review', async () => {
  vi.useFakeTimers()
  const store = new MemoryStorage(':memory:', randomBytes(32)), memory = record()
  bind(store); store.save(memory); store.forget(memory.id)
  const remove = vi.fn(async () => { throw new Error('Synthetic permission failure') })
  const runner = new LocalCleanupRunner({ jobs: async () => store.cleanupJobs(), remove, complete: async (job, success, now) => store.completeCleanup(job, success, now) })
  await runner.flush()
  await vi.runAllTimersAsync()
  expect(remove).toHaveBeenCalledTimes(6)
  expect(store.cleanupStatus(['global']).needsReview).toBe(1)
  expect(vi.getTimerCount()).toBe(0)
  runner.stop(); store.close()
})
