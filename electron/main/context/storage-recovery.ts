import { DatabaseSync } from 'node:sqlite'
import { createDecipheriv } from 'node:crypto'
import { lstatSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MemoryRecord, ProjectContext } from '../../../src/lib/context/types'
import { validateProjectContext } from '../../../src/lib/context/memory-schema'
import type { MemoryBackupReceipt } from '../../../src/lib/context/storage-recovery'

const backupName = /^schema-(\d+)-[a-f0-9-]{36}\.sqlite$/iu
const maximumBytes = 250 * 1024 * 1024
export interface VerifiedMemoryBackup {
  receipt: MemoryBackupReceipt
  preferences: MemoryRecord[]
  drafts: { projectId: string; baseRevision: number; context: ProjectContext }[]
}

function privateDirectory(path: string): string {
  const directory = join(dirname(path), 'migration-backups')
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backup storage is unavailable. Preserve the original and repair the private backup directory.')
  return directory
}

/** Names are host-created opaque selectors, never arbitrary paths. Inspection
 * opens read-only and authenticates every encrypted row before offering data. */
export function memoryBackupCatalog(path: string): MemoryBackupReceipt[] {
  let directory: string
  try { directory = privateDirectory(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  return readdirSync(directory).filter(name => backupName.test(name)).slice(0, 100).flatMap(id => {
    const info = lstatSync(join(directory, id))
    return info.isFile() && !info.isSymbolicLink() && info.size <= maximumBytes
      ? [{ id, createdAt: info.mtime.toISOString(), bytes: info.size, schema: Number(backupName.exec(id)![1]) }] : []
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function verifyMemoryBackup(path: string, id: string, key: Buffer, maximumSchema: number): VerifiedMemoryBackup {
  if (!backupName.test(id)) throw new Error('Choose a backup from the local recovery list.')
  const receipt = memoryBackupCatalog(path).find(item => item.id === id)
  if (!receipt) throw new Error('This backup is unavailable. Refresh the recovery list.')
  const backup = new DatabaseSync(join(privateDirectory(path), id), { readOnly: true })
  try {
    const schema = Number(backup.prepare('PRAGMA user_version').get()?.user_version)
    if (schema < 1 || schema > maximumSchema || schema !== receipt.schema || backup.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('The backup is damaged or needs a newer ouRGeo version. Preserve it and choose a supported backup.')
    const decrypt = (row: Record<string, unknown>): unknown => {
      const payload = Buffer.from(row.payload as Uint8Array)
      const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
      decipher.setAAD(Buffer.from(String(row.id))); decipher.setAuthTag(payload.subarray(12, 28))
      return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'))
    }
    const preferences: MemoryRecord[] = [], drafts: VerifiedMemoryBackup['drafts'] = []
    const deleted = new Set(backup.prepare('SELECT id FROM tombstones').all().map(row => String(row.id)))
    let rows = 0
    for (const table of backup.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const name = String(table.name)
      if (!/^[a-z_]+$/u.test(name)) throw new Error('The backup contains an unsupported table. Preserve it for recovery.')
      if (!backup.prepare(`PRAGMA table_info(${name})`).all().some(column => column.name === 'payload')) continue
      const count = Number(backup.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count)
      if (rows + count > 100_000) throw new Error('The backup exceeds the recovery limit. Use a supported offline export.')
      rows += count
      for (const row of backup.prepare(`SELECT * FROM ${name}`).all()) {
        const value = decrypt(row)
        if (name === 'memories') {
          const record = value as MemoryRecord
          if (!record || !['global', 'project'].includes(record.scope) || (record.scope === 'project' && !/^[a-f0-9-]{36}$/iu.test(String(record.projectId)))) throw new Error('A backup memory scope is invalid. Preserve it for manual recovery.')
          // Reuse portable validation by temporarily expressing global records
          // as project records. Restore never adopts unchecked provider data.
          const validated = validateProjectContext({ version: 1, revision: 0, memories: [{ ...record, scope: 'project', projectId: 'recovery' }] }, 'recovery').memories[0]
          if (!validated || validated.id !== row.id) throw new Error('A backup memory is invalid. Preserve it for manual recovery.')
          if (record.scope === 'global' && record.projectId === null && !deleted.has(record.id)) preferences.push({ ...validated, scope: 'global', projectId: null })
        }
        if (name === 'journals') {
          const projectId = String(row.id).replace(/^draft:/u, '')
          const draft = value as { baseRevision: number; context: ProjectContext }
          if (!String(row.id).startsWith('draft:') || !/^[a-f0-9-]{36}$/iu.test(projectId) || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0) throw new Error('A backup draft is invalid. Preserve it for manual recovery.')
          const context = validateProjectContext(draft.context, projectId)
          if (context.memories.length !== draft.context.memories.length) throw new Error('A backup draft is incomplete. Preserve it for manual recovery.')
          drafts.push({ projectId, baseRevision: draft.baseRevision, context: { ...context, memories: context.memories.filter(record => !deleted.has(record.id)) } })
        }
      }
    }
    return { receipt, preferences, drafts }
  } finally { backup.close() }
}
