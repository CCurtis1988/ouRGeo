import { useEffect, useState } from 'react'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { useSessionStore } from '@/store/session'
import type { MemoryCleanupStatus } from '@/lib/context/types'

export function MemoryCleanup(): React.ReactElement {
  const available = useContextStore(s => s.personalMemoryAvailable)
  const policyRevision = useContextStore(s => s.policyRevision)
  const projectId = useProjectStore(s => s.projectId)
  const [status, setStatus] = useState<MemoryCleanupStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    setStatus(null); setError(null)
    if (!available) return
    void window.electronAPI.context.cleanupStatus().then(value => { if (current) setStatus(value) }, error => { if (current) setError(String(error)) })
    return () => { current = false }
  }, [available, policyRevision, projectId])
  const refresh = async (retry: boolean): Promise<void> => {
    setBusy(true); setError(null)
    try {
      const lease = await window.electronAPI.context.lease()
      const value = retry ? await window.electronAPI.context.retryCleanup(lease.id) : await window.electronAPI.context.cleanupStatus()
      if ((await window.electronAPI.context.lease()).id !== lease.id) throw new Error('The workspace changed. Refresh cleanup status.')
      setStatus(value)
      if (retry) useSessionStore.getState().addConsoleEntry('info', `[Context] Local cache cleanup retried. ${value.pending + value.needsReview} operations remain pending; forgotten memories stay excluded.`, 'ai')
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <details aria-label="Local memory cleanup" className="text-[11px] text-geo-muted border border-geo-border rounded p-2">
    <summary className="cursor-pointer">Local memory cleanup{status && status.pending + status.needsReview > 0 ? ` (${status.pending + status.needsReview} pending)` : ''}</summary>
    <p className="mt-2">Forgotten memories stop appearing immediately. Private derived caches retry removal after a failure or restart. Canonical memories, installed runtimes, remote services and exported backups have separate retention.</p>
    {!available ? <p className="mt-1">Restore protected memory storage to inspect cleanup receipts.</p> : <>
      {status && <p className="mt-1">Awaiting retry: {status.pending} · Needs attention: {status.needsReview}.</p>}
      {status?.needsReview ? <p className="mt-1">Automatic retries stopped after six failures. Restore access to the private runtime directory, then retry local cleanup.</p> : null}
      <div className="flex gap-3 mt-2">
        <button disabled={busy} onClick={() => void refresh(false)} className="text-geo-accent disabled:opacity-50">Refresh cleanup status</button>
        <button disabled={busy || !status || status.pending + status.needsReview === 0} onClick={() => void refresh(true)} className="text-geo-accent disabled:opacity-50">Retry local cleanup</button>
      </div>
    </>}
    {error && <p role="alert" className="mt-2 text-geo-error">{error}</p>}
  </details>
}
