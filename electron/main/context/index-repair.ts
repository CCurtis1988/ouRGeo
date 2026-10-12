import type { DatabaseSync } from 'node:sqlite'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'
import { constants, chmodSync, closeSync, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MemoryIndexRepair } from '../../../src/lib/context/storage-recovery'
export type { MemoryIndexRepair } from '../../../src/lib/context/storage-recovery'
const encryptedTables = new Set(['memories', 'journals', 'provider_bindings', 'outbox', 'file_links', 'exclusions', 'project_locations', 'memory_connections', 'memory_credentials', 'provider_snapshots', 'maintenance_budget', 'local_cleanup', 'column_policies', 'inference_usage', 'chat_budget'])
const tables = new Set([...encryptedTables, 'tombstones', 'suppressed_sources', 'record_scopes', 'remote_namespaces'])

/** Only a rebuildable secondary index may be repaired. Unreadable pages,
 * privacy/deletion tables and unknown schema failures remain fail-closed. No
 * historical backup is imported and no canonical row is reconstructed. */
export function repairMemoryUsageIndex(database: DatabaseSync, path: string, key: Buffer): MemoryIndexRepair | undefined {
  const errors = database.prepare('PRAGMA integrity_check').all().map(row => String(row.integrity_check))
  if (errors.length === 1 && errors[0] === 'ok') return undefined
  if (path === ':memory:' || !errors.length || errors.some(error => !/^(?:row \d+ missing from index inference_usage_scope|wrong # of entries in index inference_usage_scope)$/u.test(error))) throw new Error('Memory storage is damaged. Preserve it and inspect a supported backup before writing; the current deletion ledger must remain authoritative.')
  const index = database.prepare('SELECT tbl_name FROM sqlite_master WHERE type=? AND name=?').get('index', 'inference_usage_scope')
  if (index?.tbl_name !== 'inference_usage') throw new Error('The damaged memory index is unsupported. Preserve the store for recovery.')
  const schemaTables = database.prepare('SELECT name FROM sqlite_master WHERE type=? ORDER BY name').all('table').map(row => String(row.name))
  if (schemaTables.some(table => !tables.has(table))) throw new Error('The memory schema needs review before index repair. Preserve the original store.')
  const digest = (): string => {
    const hash = createHash('sha256')
    for (const table of schemaTables) {
      hash.update(table)
      // NOT INDEXED avoids trusting the index whose contents caused the fault.
      if (Number(database.prepare(`SELECT count(*) AS count FROM ${table} NOT INDEXED`).get()?.count) > 100_001) throw new Error('Memory storage is damaged and exceeds the bounded repair limit. Preserve it for separate recovery.')
      for (const row of database.prepare(`SELECT * FROM ${table} NOT INDEXED ORDER BY rowid`).all()) {
        if (encryptedTables.has(table)) {
          const payload = Buffer.from(row.payload as Uint8Array), decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
          decipher.setAAD(Buffer.from(String(row.id))); decipher.setAuthTag(payload.subarray(12, 28))
          JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'))
        }
        hash.update(JSON.stringify(row, (_, value) => typeof value === 'bigint' ? String(value) : value))
      }
    }
    return hash.digest('hex')
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    const before = digest()
    const root = join(dirname(path), 'recovery-copies')
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Choose a private memory recovery directory before repairing the index.')
    chmodSync(root, 0o700)
    if (readdirSync(root).length >= 100) throw new Error('Memory storage is damaged and its recovery-copy limit is reached. Preserve and archive the existing encrypted copies before retrying.')
    const recoveryId = randomUUID(), directory = join(root, recoveryId)
    mkdirSync(directory, { mode: 0o700 })
    let preservedFiles = 0
    for (const suffix of ['', '-wal', '-shm']) {
      const source = `${path}${suffix}`
      let info
      try { info = lstatSync(source) } catch (error) { if (suffix && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 250 * 1024 * 1024) throw new Error('Memory storage is damaged and needs a private recovery location without linked aliases or oversized files.')
      const target = join(directory, `canonical.sqlite${suffix}`)
      copyFileSync(source, target, constants.COPYFILE_EXCL); chmodSync(target, 0o600)
      const file = openSync(target, constants.O_RDONLY)
      try { fsyncSync(file) } finally { closeSync(file) }
      preservedFiles++
    }
    if (process.platform !== 'win32') {
      for (const location of [directory, root, dirname(root)]) { const file = openSync(location, constants.O_RDONLY); try { fsyncSync(file) } finally { closeSync(file) } }
    }
    database.exec('DROP INDEX inference_usage_scope; CREATE INDEX inference_usage_scope ON inference_usage(scope, chat, id);')
    if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || digest() !== before) throw new Error('Index repair could not preserve every canonical/privacy/accounting row. The original copy is retained; inspect a verified backup.')
    database.exec('COMMIT')
    return { recoveryId, preservedFiles }
  } catch (error) {
    try { database.exec('ROLLBACK') } catch (failure) { if (!/no transaction is active/iu.test(String(failure))) throw failure }
    throw error
  }
}
