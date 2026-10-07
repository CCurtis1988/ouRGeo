import { useEffect, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { useSessionStore } from '@/store/session'
import type { ManagedRuntimeStatus } from '@/lib/context/providers/runtimes'

const size = (bytes: number): string => `${Math.ceil(bytes / 1024 / 1024)} MB`
export function ManagedMemoryRuntime(): React.ReactElement {
  const workspaceEpoch = useProjectStore(state => state.workspaceEpoch)
  const [status, setStatus] = useState<ManagedRuntimeStatus | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    void window.electronAPI.context.runtimeStatus().then(status => { if (current) setStatus(status) }, () => { if (current) setError('Runtime settings are unavailable. Reopen Settings and retry.') })
    return () => { current = false }
  }, [workspaceEpoch])
  useEffect(() => {
    if (!busy && status?.state !== 'installing') return
    let current = true
    const timer = setInterval(() => {
      void window.electronAPI.context.runtimeStatus().then(status => { if (current) setStatus(status) }, () => { if (current) setError('Installation status is unavailable. Cancel or reopen Settings to inspect it.') })
    }, 1000)
    return () => { current = false; clearInterval(timer) }
  }, [busy, status?.state])
  const run = async (operation: 'stage' | 'rollback'): Promise<void> => {
    const epoch = useProjectStore.getState().workspaceEpoch
    setBusy(true); setError('')
    try {
      const lease = await window.electronAPI.context.lease()
      if (useProjectStore.getState().workspaceEpoch !== epoch) return
      useSessionStore.getState().addConsoleEntry('info', `[Context] ${operation === 'stage' ? 'Staging experimental managed runtime with synthetic health data.' : 'Restoring the previous managed runtime/data pair.'}`)
      const result = await (operation === 'stage' ? window.electronAPI.context.stageRuntime(lease.id, acknowledged) : window.electronAPI.context.rollbackRuntime(lease.id))
      if (useProjectStore.getState().workspaceEpoch === epoch) setStatus(result)
    } catch {
      if (useProjectStore.getState().workspaceEpoch === epoch) setError('Runtime setup did not complete. Reopen Settings to inspect the preserved installation, then retry or resume.')
    } finally { setBusy(false) }
  }
  return <details className="text-xs border border-geo-border rounded p-2 mt-2" aria-label="Managed memory runtime">
    <summary className="cursor-pointer">Mnemosyne on this device · experimental staging</summary>
    <p className="text-geo-muted mt-2">The built-in manager works without this download. Staging prepares a pinned private Python runtime and runs a synthetic health check. No system Python changes, account, embedding model or paid inference are required.</p>
    <p className="text-geo-muted mt-1">This engine is a beta and is not certified for personal memory. Staging does not enable retrieval or ingestion. Native code runs with access to this machine. Its derived SQLite index is readable; protected canonical memory uses separate encrypted storage.</p>
    <p className="text-geo-muted mt-1">Downloads come from GitHub release/source storage and Python package storage. The candidate disables remote embeddings, extraction and sync; offline behaviour still needs independent certification.</p>
    {status && <>
      <p className="mt-2">{status.label} · {status.version} · {status.state}</p>
      <p className="text-geo-muted">Download ceiling: {size(status.archiveLimitBytes)}. Linux fixture footprint: {size(status.measuredInstalledBytes)}. Installation and updates need additional staging space; memory use is not yet certified.</p>
      {!status.platformSupported ? <p className="text-geo-muted mt-1">Connection-only support on this platform. A managed installation is unavailable until its packaging is tested.</p> : <>
        <label className="flex items-start gap-2 mt-2"><input aria-label="Acknowledge experimental native memory runtime" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand that this is experimental native code and does not yet enable personal memory.</span></label>
        <div className="flex flex-wrap gap-3 mt-2">
          <button className="text-geo-accent disabled:opacity-50" disabled={busy || status.state === 'installing' || !acknowledged} onClick={() => void run('stage')}>Stage verified runtime</button>
          {(busy || status.state === 'installing') && <button className="text-geo-accent" onClick={() => {
            void window.electronAPI.context.cancelRuntime().then(() => setStatus(status => status ? { ...status, state: 'cancelled' } : null), () => setError('Cancellation failed. Reopen Settings and check the installation before retrying.'))
          }}>Cancel installation</button>}
          {status.state === 'ready-for-certification' && status.canRollback && <button className="text-geo-accent disabled:opacity-50" disabled={busy || !acknowledged} onClick={() => void run('rollback')}>Restore previous runtime/data pair</button>}
        </div>
      </>}
      {status.step && <p className="text-geo-muted mt-1">{status.step}{status.receivedBytes !== undefined ? ` · ${size(status.receivedBytes)} received${status.totalBytes ? ` of ${size(status.totalBytes)}` : ''}` : ''}</p>}
      {status.state === 'installing' && status.totalBytes && <progress className="w-full" aria-label="Runtime package download" max={status.totalBytes} value={status.receivedBytes ?? 0} />}
      {status.error && <p className="text-geo-error mt-1">{status.error}</p>}
    </>}
    {error && <p role="status" className="text-geo-error mt-1">{error}</p>}
  </details>
}
