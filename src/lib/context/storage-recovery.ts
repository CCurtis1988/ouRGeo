export interface MemoryBackupReceipt {
  id: string
  createdAt: string
  bytes: number
  schema: number
}

export interface MemoryRestoreReceipt {
  recoveredPreferences: number
  recoveredDrafts: number
  skipped: number
}
export interface MemoryBackupInspection {
  preferences: number
  drafts: number
  verified: true
}
export interface MemoryIndexRepair {
  recoveryId: string
  preservedFiles: number
}

export interface MemoryStorageHealth {
  state: 'ready' | 'disk-full' | 'damaged'
  recovery: string
}

/** SQLITE_FULL may arrive through a worker as text, while filesystem writes
 * expose ENOSPC. Both must preserve the draft rather than imply it was saved. */
export function memoryStorageFailure(error: unknown): MemoryStorageHealth | null {
  const value = error as { code?: unknown; errcode?: unknown; message?: unknown }
  const message = String(value?.message ?? error)
  if (value?.code === 'ENOSPC' || value?.errcode === 13 || /SQLITE_FULL|database or disk is full|no space left on device/iu.test(message)) return {
    state: 'disk-full', recovery: 'Memory storage is full. Unsaved changes have not been committed. Free disk space, then retry storage; keep this workspace open or save its project bundle to another location.',
  }
  if (value?.errcode === 11 || /SQLITE_CORRUPT|database disk image is malformed|file is not a database|Memory storage is damaged/iu.test(message)) return {
    state: 'damaged', recovery: 'Memory storage is damaged. Writes are paused and the original file is preserved. Inspect a verified backup; recovered records require review because the current deletion ledger may be unavailable.',
  }
  return null
}

export class MemoryWriteRecovery {
  private health: MemoryStorageHealth = { state: 'ready', recovery: '' }
  status(): MemoryStorageHealth { return { ...this.health } }
  assertWritable(): void { if (this.health.state !== 'ready') throw new Error(this.health.recovery) }
  failed(error: unknown): MemoryStorageHealth | null {
    const failure = memoryStorageFailure(error)
    if (failure) this.health = failure
    return failure
  }
  retry(probe: () => void): MemoryStorageHealth {
    try { probe(); this.health = { state: 'ready', recovery: '' } }
    catch (error) { this.failed(error); throw error }
    return this.status()
  }
}
