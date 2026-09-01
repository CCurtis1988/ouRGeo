// Shared helpers for the small JSON config files we persist under the Electron
// app data directory. Previously every `*-persistence.ts` module re-implemented
// `ensureDataPath()`, the per-file path getter, and the read/merge/try-catch
// boilerplate; this centralizes all three.

let dataPathPromise: Promise<string> | null = null

/** The Electron app data directory, resolved once over IPC and cached. */
export async function getDataPath(): Promise<string> {
  if (!dataPathPromise) dataPathPromise = window.electronAPI.app.getDataPath()
  return dataPathPromise
}

export interface JsonFileStore {
  /** Parsed JSON object, or `{}` when the file is missing/unreadable. */
  read<T = Record<string, unknown>>(): Promise<T>
  /** Overwrite the file with `data`. Errors are logged, never thrown. */
  write(data: unknown): Promise<void>
  /** Read the existing object, shallow-merge `patch`, and write it back. */
  merge(patch: Record<string, unknown>): Promise<void>
}

/**
 * Creates a tiny store bound to `<dataPath>/<fileName>`. `logLabel` is used in
 * the `[label] Failed to save:` warning emitted when a write fails.
 *
 * **Writes are serialized per file.** `merge` is a read-modify-write across two
 * IPC round trips, and callers fire several at once as a matter of course —
 * `setTheme` alone writes the app theme, the code theme and the markdown theme
 * in the same tick. Run concurrently, two merges each read the pre-write file
 * and the second's write erases the first's key; worse, two overlapping
 * `writeFile`s to one path have been observed leaving a SPLICE of both
 * payloads on disk, which is not valid JSON at all — and an unparseable
 * `theme.json` means the app silently reverts to Dark on the next launch.
 * The queue is one promise chain per store, so every operation on a file sees
 * the previous one's result.
 */
export function createJsonFileStore(fileName: string, logLabel: string): JsonFileStore {
  const filePath = async (): Promise<string> => `${await getDataPath()}/${fileName}`

  // Rejections are handled inside each task, so the chain can never be poisoned
  // by an earlier failure.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.then(() => undefined, () => undefined)
    return run
  }

  async function readRaw(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await window.electronAPI.file.read(await filePath()))
    } catch {
      return {}
    }
  }

  async function writeRaw(data: unknown): Promise<void> {
    try {
      await window.electronAPI.file.write(await filePath(), JSON.stringify(data))
    } catch (err) {
      console.warn(`[${logLabel}] Failed to save:`, err)
    }
  }

  return {
    async read<T = Record<string, unknown>>(): Promise<T> {
      // Reads queue too: a read that overtook a pending merge would return the
      // state the caller is in the middle of replacing.
      return serial(readRaw) as Promise<T>
    },
    write(data: unknown): Promise<void> {
      return serial(() => writeRaw(data))
    },
    merge(patch: Record<string, unknown>): Promise<void> {
      return serial(async () => {
        const existing = await readRaw()
        await writeRaw({ ...existing, ...patch })
      })
    },
  }
}
