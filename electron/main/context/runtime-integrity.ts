import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export interface RuntimeIntegrity { version: 1; sha256: string; files: number; bytes: number }

/** Verify the installed, materialised files as well as their original archive.
 * Mutable derived databases and the app-owned bridge are outside these roots.
 * This detects damaged distributions; it is not an OS sandbox or protection
 * against someone who can replace the app and its installation records. */
export async function runtimeIntegrity(directory: string, artifacts: { role: string; directory: string; root: string }[], signal?: AbortSignal): Promise<RuntimeIntegrity> {
  const hash = createHash('sha256')
  let files = 0, bytes = 0, entries = 0
  const frames: string[] = [], pending = new Set<Promise<void>>()
  const cancellation = new AbortController(), verificationSignal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal
  let failure: unknown
  async function visit(path: string, relative: string): Promise<void> {
    verificationSignal.throwIfAborted()
    if (failure) throw failure
    if (++entries > 40000) throw new Error('Runtime integrity exceeds its file limit. Restage the pinned release.')
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Runtime integrity refuses linked files. Restage the pinned release.')
    if (info.isDirectory()) {
      frames.push(JSON.stringify(['directory', relative]) + '\n')
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), `${relative}/${name}`)
      return
    }
    if (!info.isFile() || info.size > 128 * 1024 * 1024 || info.nlink !== 1) throw new Error('Runtime integrity found an unsupported file. Restage the pinned release.')
    bytes += info.size; files++
    if (bytes > 800 * 1024 * 1024) throw new Error('Runtime integrity exceeds its size limit. Restage the pinned release.')
    const index = frames.length; frames.push('')
    const job: Promise<void> = (async () => {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      const content = createHash('sha256')
      try {
        const before = await file.stat()
        if (before.ino !== info.ino || before.dev !== info.dev || !before.isFile() || before.size !== info.size || before.mode !== info.mode || before.ctimeMs !== info.ctimeMs) throw new Error('Runtime changed during integrity verification.')
        for await (const chunk of file.createReadStream({ autoClose: false, signal: verificationSignal })) content.update(chunk)
        const after = await file.stat()
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Runtime changed during integrity verification.')
        frames[index] = JSON.stringify(['file', relative, info.size, info.mode & 0o111, content.digest('hex')]) + '\n'
      } finally { await file.close() }
    })().catch(error => { failure ??= error; cancellation.abort(error) }).finally(() => pending.delete(job))
    pending.add(job)
    // Serial file hashing made a cold verified launch miss the 3 s recall
    // deadline. Bound I/O, preserve the exact existing digest/frame order and
    // drain every handle before reporting failure or deleting a staged pair.
    if (pending.size >= 8) await Promise.race(pending)
  }
  try {
    for (const artifact of [...artifacts].sort((a, b) => a.role.localeCompare(b.role))) {
      const parent = join(directory, artifact.directory), info = await lstat(parent)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Runtime integrity refuses linked artifact directories.')
      await visit(join(parent, artifact.root), artifact.role)
    }
    await Promise.all(pending)
    if (failure) throw failure
    verificationSignal.throwIfAborted()
    for (const frame of frames) hash.update(frame)
    return { version: 1, sha256: hash.digest('hex'), files, bytes }
  } catch (error) {
    cancellation.abort(error)
    await Promise.all(pending)
    throw error
  }
}
