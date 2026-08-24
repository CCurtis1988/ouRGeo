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
 */
export function createJsonFileStore(fileName: string, logLabel: string): JsonFileStore {
  const filePath = async (): Promise<string> => `${await getDataPath()}/${fileName}`

  async function readRaw(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await window.electronAPI.file.read(await filePath()))
    } catch {
      return {}
    }
  }

  return {
    async read<T = Record<string, unknown>>(): Promise<T> {
      return (await readRaw()) as T
    },
    async write(data: unknown): Promise<void> {
      try {
        await window.electronAPI.file.write(await filePath(), JSON.stringify(data))
      } catch (err) {
        console.warn(`[${logLabel}] Failed to save:`, err)
      }
    },
    async merge(patch: Record<string, unknown>): Promise<void> {
      const existing = await readRaw()
      try {
        await window.electronAPI.file.write(await filePath(), JSON.stringify({ ...existing, ...patch }))
      } catch (err) {
        console.warn(`[${logLabel}] Failed to save:`, err)
      }
    },
  }
}
