import { DurableUsageTotals } from './DurableUsageTotals'
import type { ContextTrace } from '@/lib/context/types'
import { aggregateContextUsage, type UsageAggregate } from '@/lib/context/usage-aggregate'

interface UsageChat { id: string; messages: { contextTrace?: ContextTrace }[] }

function ReceiptTotals({ label, totals }: { label: string; totals: UsageAggregate }): React.ReactElement {
  const number = (value: number | null): string => value === null ? 'unknown' : value.toLocaleString()
  return <div className="mt-2">
    <p className="font-medium text-foreground">{label}</p>
    <p>{totals.turns.toLocaleString()} recorded turns; {totals.receipts.toLocaleString()} usage receipts. Reported: {number(totals.input)} input; {number(totals.output)} output tokens.</p>
    {totals.total !== null && <p>Reported total: {number(totals.total)} tokens{totals.incomplete ? ' (incomplete)' : ''}.</p>}
    {(totals.cached !== null || totals.cacheWrites !== null || totals.reasoning !== null) && <p>Breakdown: {totals.cached !== null && `${number(totals.cached)} cached input; `}{totals.cacheWrites !== null && `${number(totals.cacheWrites)} cache-write input; `}{totals.reasoning !== null && `${number(totals.reasoning)} reasoning; `}inclusion in input/output depends on the provider.</p>}
    <p>{totals.estimatedInput.toLocaleString()} estimated input tokens across {totals.plannedInvocations.toLocaleString()} planned invocations. Estimates are separate from reported totals.</p>
    {totals.localDurationMs !== null && <p>Reported local inference time: {(totals.localDurationMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} seconds.</p>}
    {totals.incomplete && <p>Some usage is missing or unconfirmed; these totals are incomplete.</p>}
    {totals.transportRuns > 0 && <p>Some receipts cover a complete transport run; the number and context occupancy of its internal calls are unknown.</p>}
  </div>
}

/** The caller supplies chats from the active workspace. Identity checks still
 * exclude stale traces after a project switch; scratch totals stay chat-local. */
export function ContextUsageSummary({ chats, chatId, projectId }: { chats: UsageChat[]; chatId: string; projectId: string | null }): React.ReactElement {
  const traces = chats.flatMap(chat => chat.messages.flatMap(message => message.contextTrace ? [message.contextTrace] : []))
  const conversation = aggregateContextUsage(traces, { projectId, chatId })
  const project = projectId === null ? null : aggregateContextUsage(traces, { projectId })
  return <details className="mx-2 mb-2 rounded border border-geo-border p-2 text-[11px] text-geo-muted">
    <summary className="cursor-pointer">Usage totals</summary>
    <ReceiptTotals label="Current conversation · available receipts" totals={conversation} />
    {project && <ReceiptTotals label="Current project · available receipts" totals={project} />}
    <p className="mt-2">These totals cover retained receipts, including reported retries and retrieval follow-ups. Earlier chats without receipts and background/provider processing are not included. Cached and reasoning counts are breakdowns, not additional charges.</p>
    <DurableUsageTotals chatId={chatId} projectId={projectId} />
    <p>Subscription token estimates are not invoices; cancelled requests may still be billed. Optional estimated chat budgets use explicitly reviewed model rates and cannot guarantee a provider invoice limit.</p>
  </details>
}
