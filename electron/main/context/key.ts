import { randomBytes } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface KeyProtection { encryptString: (value: string) => Buffer; decryptString: (value: Buffer) => string }

/** Losing the key is not permission to create a new one over an existing
 * store. Keep every old byte recoverable, including encrypted empty journals. */
export async function protectedMemoryKey(dir: string, protection: KeyProtection): Promise<Buffer> {
  const path = join(dir, 'key')
  let key: Buffer
  try { key = Buffer.from(protection.decryptString(await readFile(path)), 'base64') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      await stat(join(dir, 'canonical.sqlite'))
      throw new Error('The protected memory key is missing. Preserve the store and restore its key backup; no replacement key was created.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    key = randomBytes(32)
    try { await writeFile(path, protection.encryptString(key.toString('base64')), { flag: 'wx', mode: 0o600 }) }
    catch (error) { key.fill(0); throw error }
  }
  if (key.length !== 32) { key.fill(0); throw new Error('The protected memory key is invalid. Preserve the store and restore a compatible key backup.') }
  return key
}
