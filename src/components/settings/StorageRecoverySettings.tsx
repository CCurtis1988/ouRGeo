import { useState } from 'react'
import { MemoryStorageRecovery } from '@/components/ai/MemoryStorageRecovery'
import { useContextStore } from '@/store/context'
import { useSessionStore } from '@/store/session'
import type { MemoryBackupReceipt, MemoryStorageHealth, MemoryIndexRepair } from '@/lib/context/storage-recovery'

/** Backup contents are inspected only on demand. Restoring cannot silently
 * replace the current editor/project draft or reactivate provider ingestion. */
export function StorageRecoverySettings(): React.ReactElement {
  const [health, setHealth] = useState<MemoryStorageHealth>({ state: 'ready', recovery: '' })
  const [backups, setBackups] = useState<MemoryBackupReceipt[]>([])
  const [indexRepair, setIndexRepair] = useState<MemoryIndexRepair>()
  const refresh = async (): Promise<void> => {
    const result = await window.electronAPI.context.memoryRecoveryStatus()
    setHealth(result.health); setBackups(result.backups); setIndexRepair(result.indexRepair)
  }
  const audit = (): void => useSessionStore.getState().addConsoleEntry('info', 'Context memory: local backup recovery operation completed.')
  return <details className="text-[11px] text-geo-muted border border-geo-border rounded p-2">
    <summary onClick={() => void refresh().catch(error => setHealth({ state: 'damaged', recovery: `Backup status unavailable: ${String(error)}. Restore protected storage before recovery.` }))}>Memory backups and recovery</summary>
    <MemoryStorageRecovery health={health} backups={backups} refresh={refresh} indexRepair={indexRepair}
      createBackup={async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.createMemoryBackup(lease.id); await refresh(); audit() }}
      inspect={async id => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.inspectMemoryBackup(id, lease.id) }}
      restore={async id => {
        const lease = await window.electronAPI.context.lease()
        useContextStore.getState().revokeDelivery()
        const result = await window.electronAPI.context.restoreMemoryBackup(id, lease.id)
        const current = await window.electronAPI.context.lease()
        if (current.id !== lease.id) throw new Error('SCOPE_CHANGED: recovery completed in the previous workspace. Reopen it to inspect recovered drafts.')
        useContextStore.setState({ globals: await window.electronAPI.context.listGlobal(), notice: 'Recovered memories await review. Reopen the saved project to inspect recovered unsaved drafts.' })
        await refresh(); audit(); return result
      }}
      retry={async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.retryMemoryStorage(lease.id); await refresh(); await useContextStore.getState().retryLocalMemory(); audit() }} />
  </details>
}
