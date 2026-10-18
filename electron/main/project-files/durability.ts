import { open } from 'node:fs/promises'

/** Persist directory-entry changes after rename, where the platform supports it.
 * A synced file alone does not keep its new name alive across sudden power loss. */
export async function syncDirectory(path: string): Promise<boolean> {
  try {
    const directory = await open(path, 'r')
    try { await directory.sync() } finally { await directory.close() }
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || ''
    if (['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(code) || process.platform === 'win32' && ['EPERM', 'EACCES', 'EISDIR'].includes(code)) return false
    throw error
  }
}
