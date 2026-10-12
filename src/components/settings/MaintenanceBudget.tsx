import { useCallback, useEffect, useState } from 'react'
import { useContextStore } from '@/store/context'
import { chargeMicros, type MaintenanceStatus } from '@/lib/context/providers/maintenance'

export function MaintenanceBudget(): React.ReactElement {
  const available = useContextStore(state => state.personalMemoryAvailable)
  const [status, setStatus] = useState<MaintenanceStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [daily, setDaily] = useState('0'), [monthly, setMonthly] = useState('0')
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const apply = useCallback((value: MaintenanceStatus) => {
    setStatus(value); setEnabled(value.policy.enabled)
    setDaily(String(value.policy.dailyMicros / 1e6)); setMonthly(String(value.policy.monthlyMicros / 1e6))
  }, [])
  const refresh = useCallback(async () => {
    setBusy(true); setError(null)
    try { apply(await window.electronAPI.context.maintenanceStatus()) }
    catch (failure) { setStatus(null); setError(String(failure)) }
    finally { setBusy(false) }
  }, [apply])
  useEffect(() => { if (available) void refresh(); else setStatus(null) }, [available, refresh])
  const save = async (): Promise<void> => {
    if (!status) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const dailyMicros = daily.trim() ? chargeMicros(Number(daily)) : undefined
      const monthlyMicros = monthly.trim() ? chargeMicros(Number(monthly)) : undefined
      if (dailyMicros === undefined || monthlyMicros === undefined) throw new Error('Enter non-negative USD estimates for both limits.')
      const lease = await window.electronAPI.context.lease()
      apply(await window.electronAPI.context.configureMaintenance({ ...status.policy, revision: status.policy.revision + 1, enabled, dailyMicros, monthlyMicros }, lease.id))
      setNotice('Maintenance budget saved. Provider access requires its own connection and processing permissions.')
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  const money = (micros: number): string => (micros / 1e6).toLocaleString('en-GB', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 })
  return <details aria-label="Memory maintenance budget" className="text-[11px] text-geo-muted border border-geo-border rounded p-2">
    <summary className="cursor-pointer">Estimated memory maintenance budget</summary>
    <p className="mt-2">Paid background processing is off by default. These limits cover memory processing, separately from chat inference. They are estimated budgets; provider charges may exceed estimates.</p>
    <p className="mt-1">No paid memory processor is active yet. Saving a budget does not connect or start a provider.</p>
    {!available ? <p className="mt-2">Enable protected memory storage to configure a maintenance budget.</p> : <>
      <label className="flex items-center gap-2 mt-2"><input type="checkbox" aria-label="Allow budgeted paid memory maintenance" checked={enabled} disabled={busy || !status} onChange={event => setEnabled(event.target.checked)} />Allow budgeted paid memory maintenance</label>
      <div className="flex flex-wrap gap-3 mt-2">
        <label className="flex items-center gap-2">Daily (USD)<input aria-label="Daily memory maintenance estimate in USD" type="number" min="0" step="0.01" value={daily} disabled={busy || !status} onChange={event => setDaily(event.target.value)} className="w-24 bg-geo-bg border border-geo-border rounded p-1" /></label>
        <label className="flex items-center gap-2">Monthly (USD)<input aria-label="Monthly memory maintenance estimate in USD" type="number" min="0" step="0.01" value={monthly} disabled={busy || !status} onChange={event => setMonthly(event.target.value)} className="w-24 bg-geo-bg border border-geo-border rounded p-1" /></label>
      </div>
      <div className="flex gap-3 mt-2"><button disabled={busy || !status} className="text-geo-accent disabled:opacity-50" onClick={() => void save()}>Save maintenance budget</button><button disabled={busy} className="text-geo-accent disabled:opacity-50" onClick={() => void refresh()}>Refresh maintenance usage</button></div>
      {status && <p className="mt-2">Reported today: {money(status.summary.dailySpentMicros)} · This month: {money(status.summary.monthlySpentMicros)} · Reserved or unknown: {money(status.summary.outstandingMicros)} ({status.summary.unresolvedOperations} operations).</p>}
      {status?.summary.exceeded && <p className="mt-1">Estimated budget exceeded. Further paid maintenance is blocked until receipts or limits are reviewed.</p>}
      <p className="mt-1">Unknown charges stay reserved after cancellation, disconnection or a date change. Local processing has no monetary entry here; external usage without a confirmed price remains unknown.</p>
    </>}
    {error && <p role="alert" className="mt-2 text-geo-error">{error}</p>}
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </details>
}
