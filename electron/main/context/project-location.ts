import { realpath, stat } from 'node:fs/promises'

/** Paths are a local duplicate warning, never a memory identity. A renamed
 * bundle retains its UUID; two surviving files require an explicit choice.
 * Symlink/hardlink aliases of one file do not constitute an independent copy. */
export async function duplicateProjectLocation(previous: string | null, incoming: string): Promise<boolean> {
  if (!previous || previous === incoming) return false
  let oldPath: string
  try {
    oldPath = await realpath(previous)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw new Error('Could not verify the project’s previous location. Restore access or open a separately saved copy.')
  }
  try {
    const newPath = await realpath(incoming)
    if (oldPath === newPath) return false
    const [oldFile, newFile] = await Promise.all([stat(oldPath), stat(newPath)])
    if (oldFile.ino !== 0 && oldFile.dev === newFile.dev && oldFile.ino === newFile.ino) return false
    return true
  } catch {
    // Only absence proves the old location was moved. Access errors cannot
    // silently approve sharing a writable provider namespace.
    throw new Error('Could not verify the project’s previous location. Restore access or open a separately saved copy.')
  }
}
