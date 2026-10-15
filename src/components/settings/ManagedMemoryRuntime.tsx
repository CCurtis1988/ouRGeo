import { useEffect, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { useSessionStore } from '@/store/session'
import type { ManagedRuntimeStatus } from '@/lib/context/providers/runtimes'

const size = (bytes: number): string => `${Math.ceil(bytes / 1024 / 1024)} MB`
export function ManagedMemoryRuntime(): React.ReactElement {
  const workspaceEpoch = useProjectStore(state => state.workspaceEpoch)
  const projectId = useProjectStore(state => state.projectId)
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
    <summary className="cursor-pointer">Mnemosyne on this device · experimental</summary>
    <p className="text-geo-muted mt-2">The built-in manager works without this download. Staging prepares a pinned private Python runtime and runs a synthetic health check. No system Python changes, account, embedding model or paid inference are required.</p>
    <p className="text-geo-muted mt-1">This engine is a beta. The reviewed Linux lexical profile can synchronise future committed memory updates after separate activation. Staging alone grants no memory access. Native code runs with access to this machine. Its derived SQLite index is readable; protected canonical memory uses separate encrypted storage.</p>
    <p className="text-geo-muted mt-1">Downloads come from GitHub release/source storage and Python package storage. The reviewed profile disables embeddings, extraction, reflection and sync. Linux fixtures observe no runtime network calls after installation. Your selected assistant has its own processing destination.</p>
    {status && <>
      <p className="mt-2">{status.label} · {status.version} · {status.state}</p>
      <p className="text-geo-muted">Download ceiling: {size(status.archiveLimitBytes)}. Linux fixture footprint: {size(status.measuredInstalledBytes)}. Installation and updates need additional staging space; memory use is not yet certified.</p>
      {!status.platformSupported ? <p className="text-geo-muted mt-1">Connection-only support on this platform. A managed installation is unavailable until its packaging is tested.</p> : <>
        <label className="flex items-start gap-2 mt-2"><input aria-label="Acknowledge experimental native memory runtime" type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /><span>I understand that this is experimental native code. Staging alone does not enable personal memory.</span></label>
        <div className="flex flex-wrap gap-3 mt-2">
          <button className="text-geo-accent disabled:opacity-50" disabled={busy || status.state === 'installing' || !acknowledged} onClick={() => void run('stage')}>Stage verified runtime</button>
          {(busy || status.state === 'installing') && <button className="text-geo-accent" onClick={() => {
            void window.electronAPI.context.cancelRuntime().then(() => setStatus(status => status ? { ...status, state: 'cancelled' } : null), () => setError('Cancellation failed. Reopen Settings and check the installation before retrying.'))
          }}>Cancel installation</button>}
          {status.state === 'ready-for-certification' && status.canRollback && <button className="text-geo-accent disabled:opacity-50" disabled={busy || !acknowledged} onClick={() => void run('rollback')}>Restore previous runtime/data pair</button>}
          {status.state === 'ready-for-certification' && (['global', ...(projectId ? ['project'] : [])] as Array<'global' | 'project'>).map(scope => <button key={scope} className="text-geo-accent disabled:opacity-50" disabled={busy || !acknowledged} onClick={() => {
            void (async () => {
              const epoch = useProjectStore.getState().workspaceEpoch
              setBusy(true); setError('')
              try {
                const lease = await window.electronAPI.context.lease()
                if (useProjectStore.getState().workspaceEpoch !== epoch) return
                const preview = await window.electronAPI.context.previewManagedActivation(scope, lease.id)
                await window.electronAPI.context.activateProvider(preview.ref)
                useContextStore.getState().refreshProviders()
                if (useProjectStore.getState().workspaceEpoch === epoch) useSessionStore.getState().addConsoleEntry('info', '[Context] Managed memory activation reviewed. Existing memories remain local unless explicitly selected; inspect connection settings for update status.')
              } catch { if (useProjectStore.getState().workspaceEpoch === epoch) setError('Activation did not complete. Review this scope, the pinned runtime and protected storage, then retry.') }
              finally { setBusy(false) }
            })()
          }}>Review activation for {scope === 'global' ? 'About you' : 'this project'}</button>)}
        </div>
        {status.state === 'ready-for-certification' && <section aria-label="Authenticated local memory server" data-ourgeo-id="context.localServer" className="border-t border-geo-border mt-3 pt-2">
          <h4 className="font-medium">Authenticated local server</h4>
          <p className="text-geo-muted">Use the same experimental lexical profile through a private local connection. Starting it shares no memories; review each scope separately, then select existing memories in connection settings. Paid processing stays disabled.</p>
          {(['global', ...(projectId ? ['project'] : [])] as Array<'global' | 'project'>).map(scope => <button key={scope} className="text-geo-accent mr-3 mt-2 disabled:opacity-50" disabled={busy || !acknowledged} onClick={() => {
            void (async () => {
              const epoch = useProjectStore.getState().workspaceEpoch
              setBusy(true); setError('')
              try {
                const lease = await window.electronAPI.context.lease()
                if (useProjectStore.getState().workspaceEpoch !== epoch) return
                const preview = await window.electronAPI.context.previewLocalServerActivation(scope, lease.id, acknowledged)
                await window.electronAPI.context.activateProvider(preview.ref)
              } catch (error) { if (useProjectStore.getState().workspaceEpoch === epoch) setError(error instanceof Error ? error.message : 'Review the local-server connection and this scope, then retry.') }
              finally { if (useProjectStore.getState().workspaceEpoch === epoch) useContextStore.getState().refreshProviders(); setBusy(false) }
            })()
          }}>Review local server for {scope === 'global' ? 'About you' : 'this project'}</button>)}
        </section>}
      </>}
      {status.step && <p className="text-geo-muted mt-1">{status.step}{status.receivedBytes !== undefined ? ` · ${size(status.receivedBytes)} received${status.totalBytes ? ` of ${size(status.totalBytes)}` : ''}` : ''}</p>}
      {status.state === 'installing' && status.totalBytes && <progress className="w-full" aria-label="Runtime package download" max={status.totalBytes} value={status.receivedBytes ?? 0} />}
      {status.error && <p className="text-geo-error mt-1">{status.error}</p>}
    </>}
    {error && <p role="status" className="text-geo-error mt-1">{error}</p>}
  </details>
}
