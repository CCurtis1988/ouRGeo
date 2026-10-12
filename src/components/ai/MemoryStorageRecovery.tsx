import { useState } from 'react'
import type { MemoryBackupReceipt, MemoryBackupInspection, MemoryRestoreReceipt, MemoryStorageHealth, MemoryIndexRepair } from '@/lib/context/storage-recovery'

interface Props {
  health: MemoryStorageHealth
  backups: MemoryBackupReceipt[]
  refresh: () => Promise<unknown>
  createBackup: () => Promise<unknown>
  restore: (id: string) => Promise<MemoryRestoreReceipt>
  inspect: (id: string) => Promise<MemoryBackupInspection>
  retry: () => Promise<unknown>
  indexRepair?: MemoryIndexRepair
}

/** Host callbacks resolve authorised scopes. A backup selector never grants
 * the renderer arbitrary file reads or enables historical provider bindings. */
export function MemoryStorageRecovery({ health, backups, refresh, createBackup, restore, inspect, retry, indexRepair }: Props): React.ReactElement {
  const [selected, setSelected] = useState('')
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState('')
  const [error, setError] = useState('')
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setPending(true)
    try { await action(); setError('') } catch (failure) { setError(String(failure)) }
    finally { setPending(false) }
  }
  return <section aria-label="Memory storage recovery" className="border border-geo-border rounded p-2 text-xs space-y-2">
    <p className="font-medium">Memory backups and recovery</p>
    <p className="text-geo-muted">Encrypted local backups need this profile’s protected key. Recovery preserves current records and forgotten-memory markers. Missing preferences return as suggestions; project drafts remain unsaved. Connections and remote writes are not restored.</p>
    {health.state !== 'ready' && <p role="alert">{health.recovery}</p>}
    {indexRepair && <p role="status">The usage lookup index was repaired from current rows. Canonical records, deletion markers and accounting remain unchanged. {indexRepair.preservedFiles} original encrypted files are preserved in context/recovery-copies/{indexRepair.recoveryId} within this profile.</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={pending} onClick={() => void act(refresh)}>Refresh backups</button>
      <button disabled={pending || health.state !== 'ready'} onClick={() => void act(async () => { await createBackup(); setReceipt('Encrypted backup verified. Keep the protected profile key available for recovery.') })}>Create encrypted backup</button>
      {health.state !== 'ready' && <button disabled={pending} onClick={() => void act(async () => { await retry(); setReceipt('Storage verified. Writes can resume.') })}>Retry storage</button>}
    </div>
    <label className="block">Local backup
      <select aria-label="Local memory backup" disabled={pending} value={selected} onChange={event => setSelected(event.target.value)} className="block w-full bg-geo-bg border border-geo-border rounded p-1">
        <option value="">Choose a backup</option>
        {backups.map(backup => <option key={backup.id} value={backup.id}>{new Date(backup.createdAt).toLocaleString()} · schema {backup.schema} · {Math.ceil(backup.bytes / 1024)} KB</option>)}
      </select>
    </label>
    {selected && <button disabled={pending} onClick={() => void act(async () => {
      const result = await inspect(selected)
      setReceipt(`Backup verified: ${result.preferences} preference records and ${result.drafts} project drafts. No records have been restored or sent to a provider.`)
    })}>Inspect encrypted backup</button>}
    {selected && <button className="ml-2" disabled={pending || health.state !== 'ready'} onClick={() => void act(async () => {
      const result = await restore(selected)
      setReceipt(`Recovered ${result.recoveredPreferences} preference suggestions and ${result.recoveredDrafts} project drafts; ${result.skipped} existing, forgotten or out-of-scope items left unchanged.`)
    })}>Recover missing memories for review</button>}
    {health.state === 'damaged' && <p className="text-geo-muted">Automatic restore is paused while the current deletion ledger cannot be verified. Preserve the damaged store and inspect a verified backup before selecting records for a separate recovery workspace.</p>}
    {receipt && <p role="status">{receipt}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
