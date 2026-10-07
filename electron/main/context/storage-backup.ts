import { DatabaseSync } from 'node:sqlite'
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Only the worker supplies this path. VACUUM INTO includes committed WAL
 * content in a consistent snapshot; copying the main file alone can miss it.
 * Payloads are already encrypted. The key remains in OS-protected storage.
 * https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause */
export function backupMemoryDatabase(database: DatabaseSync, path: string, version: number): string {
  const directory = join(dirname(path), 'migration-backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Memory backup storage is unavailable. Preserve the original store and choose a private recovery location.')
  const target = join(directory, `schema-${version}-${randomUUID()}.sqlite`)
  const temporary = `${target}.partial`
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  closeSync(descriptor)
  try {
    database.prepare('VACUUM INTO ?').run(temporary)
    const backup = new DatabaseSync(temporary, { readOnly: true })
    try {
      if (backup.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
        || Number(backup.prepare('PRAGMA user_version').get()?.user_version) !== version) throw new Error('Memory backup verification failed. The original store has not been migrated.')
    } finally { backup.close() }
    const file = openSync(temporary, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { fsyncSync(file) } finally { closeSync(file) }
    renameSync(temporary, target)
    if (process.platform !== 'win32') {
      const parent = openSync(directory, constants.O_RDONLY)
      try { fsyncSync(parent) } finally { closeSync(parent) }
    }
    return target
  } catch (error) {
    try { unlinkSync(temporary) } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure }
    throw error
  }
}
