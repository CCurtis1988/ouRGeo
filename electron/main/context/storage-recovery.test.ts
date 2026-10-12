import { afterEach, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStorage, MEMORY_SCHEMA_VERSION } from './storage'
import { memoryBackupCatalog, verifyMemoryBackup } from './storage-recovery'
import { MemoryWriteRecovery, memoryStorageFailure } from '../../../src/lib/context/storage-recovery'
import { memoryRetention } from '../../../src/lib/context/retention'
import type { MemoryRecord } from '../../../src/lib/context/types'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-memory-restore-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32)
  const store = new MemoryStorage(path, Buffer.from(key))
  const record: MemoryRecord = { id: randomUUID(), scope: 'global', projectId: null, revision: 1, category: 'preference', statement: 'Synthetic preference: metric units', status: 'active', assertion: 'user-declared', evidence: [], supersedes: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  return { path, key, store, record, directory }
}
function damageUsageIndex(path: string): void {
  const db = new DatabaseSync(path)
  const page = Number(db.prepare('SELECT rootpage FROM sqlite_master WHERE name=?').get('inference_usage_scope')?.rootpage)
  const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size)
  db.close()
  const bytes = readFileSync(path), base = (page - 1) * pageSize
  // This fixture has one index row. Change only its derived key, preserving
  // valid page/record structure and every authoritative table byte.
  expect(bytes[base]).toBe(10)
  expect(bytes.readUInt16BE(base + 3)).toBe(1)
  const cell = base + bytes.readUInt16BE(base + 8)
  let payload = cell
  while (bytes[payload++] & 128) { /* Skip the payload-length varint. */ }
  const key = payload + bytes[payload]
  bytes[key] = bytes[key] === 97 ? 98 : 97
  writeFileSync(path, bytes)
}
it('repairs only a derived usage index after preserving original bytes and authenticating current rows', () => {
  const { store, path, key, record, directory } = fixture()
  store.save(record); store.forget(record.id, [], 'global')
  const input = { chatId: randomUUID(), turnId: randomUUID(), invocation: 1, attempt: 0, accountingScope: 'invocation' as const, provider: 'openai' as const, delivery: 'acknowledged' as const, final: true, reported: { inputTokens: 100, outputTokens: 20 } }
  store.recordInferenceUsage(input, 'global')
  store.close(); damageUsageIndex(path)
  const original = readFileSync(path), db = new DatabaseSync(path)
  expect(String(db.prepare('PRAGMA integrity_check').get()?.integrity_check)).toContain('inference_usage_scope')
  db.close()
  const recovered = new MemoryStorage(path, Buffer.from(key))
  try {
    expect(recovered.indexRepair?.preservedFiles).toBeGreaterThan(0)
    expect(recovered.inferenceUsageSummary('global').reportedTotalTokens).toBe(120)
    expect(recovered.filterDeleted([record.id])).toEqual([])
    expect(recovered.list()).toEqual([])
    const copies = join(directory, 'recovery-copies'), id = readdirSync(copies)[0]
    expect(readFileSync(join(copies, id, 'canonical.sqlite'))).toEqual(original)
    expect(recovered.outbox()).toEqual([])
  } finally { recovered.close() }
})
it('refuses index repair with a wrong profile key before creating copies or touching canonical rows', () => {
  const { store, path, record, directory } = fixture()
  store.save(record)
  store.recordInferenceUsage({ chatId: randomUUID(), turnId: randomUUID(), invocation: 1, attempt: 0, accountingScope: 'invocation', provider: 'openai', delivery: 'sent', final: false }, 'global')
  store.close(); damageUsageIndex(path)
  const before = readFileSync(path)
  expect(() => new MemoryStorage(path, randomBytes(32))).toThrow()
  expect(existsSync(join(directory, 'recovery-copies'))).toBe(false)
  expect(readFileSync(path)).toEqual(before)
})

it('authenticates a backup read-only without exposing plaintext or modifying its bytes', () => {
  const { path, key, store, record, directory } = fixture()
  try {
    store.save({ ...record, createdAt: '2020-01-01T00:00:00.000Z' })
    const receipt = store.createBackup(), backupPath = join(directory, 'migration-backups', receipt.id)
    const bytes = readFileSync(backupPath)
    expect(bytes.includes(Buffer.from(record.statement))).toBe(false)
    expect(verifyMemoryBackup(path, receipt.id, key, MEMORY_SCHEMA_VERSION).preferences).toEqual([{ ...record, createdAt: '2020-01-01T00:00:00.000Z' }])
    expect(() => verifyMemoryBackup(path, receipt.id, randomBytes(32), MEMORY_SCHEMA_VERSION)).toThrow()
    expect(readFileSync(backupPath)).toEqual(bytes)
    expect(() => verifyMemoryBackup(path, '../canonical.sqlite', key, MEMORY_SCHEMA_VERSION)).toThrow('local recovery list')
  } finally { store.close() }
})

it('recovers missing preferences as candidates without overwriting current records or replaying remote ingestion', () => {
  const { store, record, path } = fixture()
  try {
    store.save({ ...record, createdAt: '2020-01-01T00:00:00.000Z' })
    const backup = store.createBackup()
    // Simulate a missing row, rather than a user forget, which creates a tombstone.
    const db = new DatabaseSync(path); db.prepare('DELETE FROM memories WHERE id=?').run(record.id); db.close()
    expect(store.restoreBackup(backup.id, ['global'])).toEqual({ recoveredPreferences: 1, recoveredDrafts: 0, skipped: 0 })
    expect(store.list('global')[0].status).toBe('candidate')
    expect(store.list('global')[0].createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(memoryRetention(store.list('global')[0]).expired).toBe(false)
    expect(store.search('metric')).toEqual([])
    expect(store.restoreBackup(backup.id, ['global']).skipped).toBe(1)
    expect(store.outbox()).toEqual([])
  } finally { store.close() }
})

it('keeps newer deletions and scope restrictions authoritative over historical backup content', () => {
  const { store, record } = fixture()
  try {
    store.save(record)
    const backup = store.createBackup()
    store.forget(record.id, [], 'global')
    expect(store.restoreBackup(backup.id, ['global']).skipped).toBe(1)
    expect(store.list()).toEqual([])
    expect(store.filterDeleted([record.id])).toEqual([])
    expect(store.restoreBackup(backup.id, []).recoveredPreferences).toBe(0)
  } finally { store.close() }
})

it('restores only the authorised missing draft and leaves a current unsaved draft intact', () => {
  const { store } = fixture(), projectId = randomUUID()
  try {
    const draft = { version: 1 as const, revision: 3, memories: [] }
    store.stageProject(projectId, 2, draft)
    const backup = store.createBackup()
    store.discardProject(projectId)
    expect(store.restoreBackup(backup.id, ['global']).recoveredDrafts).toBe(0)
    expect(store.restoreBackup(backup.id, [`project:${projectId}`]).recoveredDrafts).toBe(1)
    expect(store.recoverProject(projectId, 2)).toEqual(draft)
    store.stageProject(projectId, 2, { ...draft, revision: 4 })
    expect(store.restoreBackup(backup.id, [`project:${projectId}`]).skipped).toBe(1)
    expect(store.recoverProject(projectId, 2)?.revision).toBe(4)
  } finally { store.close() }
})

it('rejects redirected backup directories while preserving the original canonical store', () => {
  const { path, store, directory } = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'ourgeo-restore-foreign-')); directories.push(outside)
  try {
    symlinkSync(outside, join(directory, 'migration-backups'), 'dir')
    expect(() => memoryBackupCatalog(path)).toThrow('private backup directory')
    expect(() => store.createBackup()).toThrow('backup storage')
    store.probeWritable()
  } finally { store.close() }
})

it('inspects a verified backup after canonical corruption without changing the damaged original or enabling recovery records', () => {
  const { path, key, store, record } = fixture()
  store.save(record)
  const backup = store.createBackup()
  store.close()
  const damaged = Buffer.from('SYNTHETIC_DAMAGED_CANONICAL_STORE')
  writeFileSync(path, damaged)
  expect(() => new MemoryStorage(path, Buffer.from(key))).toThrow()
  expect(verifyMemoryBackup(path, backup.id, key, MEMORY_SCHEMA_VERSION).preferences).toEqual([record])
  expect(readFileSync(path)).toEqual(damaged)
})

it('pauses writes after a real SQLITE_FULL transaction and resumes only after a successful write probe', () => {
  const { path, store } = fixture(), guard = new MemoryWriteRecovery()
  const db = new DatabaseSync(path)
  try {
    const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count)
    db.exec(`PRAGMA max_page_count=${pages}`)
    let failure: unknown
    try { db.prepare('INSERT INTO journals VALUES (?, ?)').run('synthetic-full', Buffer.alloc(1024 * 1024)) } catch (error) { failure = error }
    expect(memoryStorageFailure(failure)?.state).toBe('disk-full')
    guard.failed(failure)
    expect(() => guard.assertWritable()).toThrow('Free disk space')
    expect(db.prepare('SELECT id FROM journals WHERE id=?').get('synthetic-full')).toBeUndefined()
    db.exec('PRAGMA max_page_count=1000000')
    expect(guard.retry(() => store.probeWritable()).state).toBe('ready')
    expect(() => guard.assertWritable()).not.toThrow()
  } finally { db.close(); store.close() }
})

it('preserves the previous recovery draft and reports SQLITE_FULL when a real journal transaction runs out of pages', () => {
  const { store, record } = fixture(), projectId = randomUUID()
  const database = (store as unknown as { db: DatabaseSync }).db
  try {
    const previous = { version: 1 as const, revision: 1, memories: [] }
    store.stageProject(projectId, 0, previous)
    const pages = Number(database.prepare('PRAGMA page_count').get()?.page_count)
    database.exec(`PRAGMA max_page_count=${pages}`)
    const memories = Array.from({ length: 1000 }, () => ({ ...record, id: randomUUID(), scope: 'project' as const, projectId, statement: 'synthetic '.repeat(400) }))
    let failure: unknown
    try { store.stageProject(projectId, 0, { ...previous, revision: 2, memories }) } catch (error) { failure = error }
    expect(memoryStorageFailure(failure)?.state).toBe('disk-full')
    expect(String(failure)).not.toContain('no transaction is active')
    expect(store.recoverProject(projectId, 0)).toEqual(previous)
    database.exec('PRAGMA max_page_count=1000000')
    store.probeWritable()
  } finally { store.close() }
})
