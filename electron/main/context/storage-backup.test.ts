import { afterEach, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { MemoryStorage, MEMORY_SCHEMA_VERSION } from './storage'
import type { MemoryRecord } from '../../../src/lib/context/types'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-memory-migration-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32)
  const memory: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'SYNTHETIC_BACKUP_PREFERENCE: use metric units.', evidence: [], assertion: 'user-declared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'active', supersedes: [] }
  const store = new MemoryStorage(path, Buffer.from(key))
  store.save(memory)
  const database = new DatabaseSync(path)
  database.exec('PRAGMA user_version=9')
  return { directory, path, key, memory, store, database }
}

it('backs up committed WAL data with encrypted payloads before atomically advancing the schema', () => {
  const { directory, path, key, memory, store, database } = fixture()
  try {
    // Keep the original writer open: the snapshot must include its WAL rather
    // than relying on a successful close/checkpoint of the main database file.
    expect(readdirSync(directory)).toContain('canonical.sqlite-wal')
    const migrated = new MemoryStorage(path, Buffer.from(key))
    expect(migrated.search('metric')).toEqual([memory])
    migrated.close()
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(MEMORY_SCHEMA_VERSION)
    const backups = readdirSync(join(directory, 'migration-backups'))
    expect(backups).toHaveLength(1)
    const backupPath = join(directory, 'migration-backups', backups[0])
    expect(readFileSync(backupPath).includes(Buffer.from(memory.statement))).toBe(false)
    const backup = new DatabaseSync(backupPath, { readOnly: true })
    try {
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
      expect(backup.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok')
      expect(backup.prepare('SELECT id FROM memories').all()).toEqual([{ id: memory.id }])
    } finally { backup.close() }
    const reopened = new MemoryStorage(path, Buffer.from(key)); reopened.close()
    expect(readdirSync(join(directory, 'migration-backups'))).toEqual(backups)
  } finally { database.close(); store.close() }
})

it('refuses migration with a wrong key without making backups or changing the original schema', () => {
  const { directory, path, store, database } = fixture()
  try {
    expect(() => new MemoryStorage(path, randomBytes(32))).toThrow()
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
    expect(readdirSync(directory)).not.toContain('migration-backups')
  } finally { database.close(); store.close() }
})

it('keeps canonical data unchanged when the recovery directory is unavailable or redirected', () => {
  const { directory, path, key, memory, store, database } = fixture()
  const foreign = mkdtempSync(join(tmpdir(), 'ourgeo-foreign-backup-')); directories.push(foreign)
  symlinkSync(foreign, join(directory, 'migration-backups'), 'dir')
  try {
    expect(() => new MemoryStorage(path, Buffer.from(key))).toThrow('backup storage')
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
    expect(store.search('metric')).toEqual([memory])
    expect(readdirSync(foreign)).toEqual([])
  } finally { database.close(); store.close() }
})

it('refuses future schemas without writing a migration copy or advancing the file', () => {
  const { directory, path, key, store, database } = fixture()
  database.exec('PRAGMA user_version=100')
  try {
    expect(() => new MemoryStorage(path, Buffer.from(key))).toThrow('newer ouRGeo')
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(100)
    expect(readdirSync(directory)).not.toContain('migration-backups')
  } finally { database.close(); store.close() }
})
