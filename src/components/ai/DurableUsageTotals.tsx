import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import type { InferenceUsageSummary } from '@/lib/context/inference-usage'

function Totals({ label, value }: { label: string; value: InferenceUsageSummary }): React.ReactElement {
  const number = (count: number | null): string => count === null ? 'unknown' : count.toLocaleString()
  return <div className="mt-2">
    <p className="font-medium text-foreground">{label}</p>
    <p>{value.turns.toLocaleString()} recorded turns; {value.receipts.toLocaleString()} receipts. Reported: {number(value.reportedInputTokens)} input; {number(value.reportedOutputTokens)} output tokens.</p>
    <p>{number(value.estimatedInputTokens)} estimated input tokens. Estimates are separate from reported usage.</p>
    {(value.reportedCachedInputTokens !== null || value.reportedReasoningTokens !== null) && <p>Breakdown: {number(value.reportedCachedInputTokens)} cached input; {number(value.reportedReasoningTokens)} reasoning tokens. These may already be included in reported totals.</p>}
    {value.incomplete && <p>Some counters or delivery acknowledgements are missing; totals are incomplete.</p>}
    {value.transportRuns > 0 && <p>Transport-run receipts do not establish the number or occupancy of internal model calls.</p>}
    {value.cost && <p>Price-based estimate: {value.cost.estimatedMicros === null ? 'unknown' : `$${(value.cost.estimatedMicros / 1e6).toFixed(6)}`} USD; ${(value.cost.outstandingMicros / 1e6).toFixed(6)} pending reserves. {value.cost.unknownPriceReceipts} unpriced receipts. Estimates are not provider invoices.</p>}
  </div>
}

/** Explicit local lookup, without corpus or transcript ingestion. The host owns
 * the active project namespace; late results cannot follow a workspace switch. */
export function DurableUsageTotals({ chatId, projectId }: { chatId: string; projectId: string | null }): React.ReactElement {
  const [result, setResult] = useState<{ conversation: InferenceUsageSummary; project?: InferenceUsageSummary } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => { const ownership = generation; ownership.current++; setResult(null); setError(null); setBusy(false); return () => { ownership.current++ } }, [chatId, projectId])
  const load = async (): Promise<void> => {
    const version = ++generation.current
    const epoch = useProjectStore.getState().workspaceEpoch
    const current = (): boolean => version === generation.current && useProjectStore.getState().workspaceEpoch === epoch && useProjectStore.getState().projectId === projectId
    setBusy(true); setError(null)
    try {
      const lease = await window.electronAPI.context.lease()
      if (!current()) return
      const conversation = await window.electronAPI.context.inferenceUsageSummary(chatId, lease.id)
      if (!current()) return
      const project = projectId ? await window.electronAPI.context.inferenceUsageSummary(undefined, lease.id) : undefined
      if (current()) setResult({ conversation, project })
    } catch (failure) { if (current()) setError(`Protected usage totals are unavailable: ${String(failure)}`) }
    finally { if (version === generation.current) setBusy(false) }
  }
  return <div className="mt-2 border-t border-geo-border pt-2">
    <button className="rounded border border-geo-border px-2 py-1 text-foreground disabled:opacity-50" disabled={busy} onClick={() => void load()}>{busy ? 'Loading protected usage totals…' : 'Load protected usage totals'}</button>
    {result && <><Totals label="Current conversation · protected local ledger" value={result.conversation} />{result.project && <Totals label="Current project · protected local ledger" value={result.project} />}</>}
    {error && <p role="status">{error}</p>}
    <p>Content-free receipts survive chat deletion and restart on this device. Interrupted requests retain their estimates; missing counters stay unknown. Earlier trace-free activity and background/provider charges are not included. Project exports omit this ledger. Prices and estimated chat budgets are configured in Settings → AI Assistant → Budgets.</p>
  </div>
}
