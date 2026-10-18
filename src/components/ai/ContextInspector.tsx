import { ContextSourceBrowser } from './ContextSourceBrowser'
import type { ContextTrace } from '@/lib/context/types'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { totalUsage } from '@/lib/context/usage'

export function ContextInspector({ trace }: { trace: ContextTrace }): React.ReactElement {
  const excluded = useContextStore(s => s.excluded)
  const exclude = useContextStore(s => s.exclude)
  const projectId = useProjectStore(s => s.projectId)
  const epoch = useProjectStore(s => s.workspaceEpoch)
  const currentScope = trace.identity.projectId === projectId && trace.identity.workspaceEpoch === epoch
  const reported = trace.usage ?? []
  const totals = totalUsage(reported)
  return <details className="mx-2 mb-3 text-[11px] text-geo-muted border border-geo-border rounded p-2">
    <summary className="cursor-pointer">{trace.evidenceExpired ? 'Context evidence expired · usage retained' : trace.selected.length ? `Context: ${[...new Set(trace.selected.map(s => s.title))].join(', ')}` : 'Conversation only'}</summary>
    <p className="mt-2">{trace.evidenceExpired ? 'Diagnostic evidence has expired; the remaining receipt contains accounting metadata only.' : `Destination: ${trace.target}. Delivery: ${trace.state}.`} Prompt counts are estimated; reported usage is labelled separately. Already transmitted content cannot be recalled.</p>
    {trace.limitations?.map((limitation, index) => <p key={index}>{limitation}</p>)}
    {trace.target.startsWith('claude-cli/') && <p>Claude retains its own transcript. Internal invocation count and retained occupancy are not confirmed by this trace.</p>}
    <p>{trace.retrievalCalls} retrieval calls; {trace.invocations.reduce((total, call) => total + call.inputTokens, 0).toLocaleString()} estimated input tokens across {trace.invocations.length} invocation(s).</p>
    {reported.length > 0 && <>
      <p>Reported usage: {reported.some(report => report.inputTokens !== undefined) ? totals.input.toLocaleString() : 'unknown'} input; {reported.some(report => report.outputTokens !== undefined) ? totals.output.toLocaleString() : 'unknown'} output{reported.some(report => report.cachedInputTokens !== undefined) ? `; ${totals.cached.toLocaleString()} cached input` : ''}{reported.some(report => report.reasoningTokens !== undefined) ? `; ${totals.reasoning.toLocaleString()} reasoning` : ''} tokens.</p>
      {reported.some(report => report.scope === 'transport-run') && <p>Claude reports totals for its entire run, including internal calls. This does not establish their individual context occupancy.</p>}
      {(totals.unreportedInput > 0 || totals.unreportedOutput > 0 || reported.length < trace.invocations.length) && <p>Some requests or token categories were not reported; these totals are incomplete.</p>}
      {trace.state === 'uncertain' && <p>The request ended without confirmed completion. Usage after the last receipt may be missing.</p>}
      <p>Cached and reasoning counts are breakdowns, with provider-specific inclusion in input/output. Monetary cost is unavailable here; subscription token estimates are not invoices. Cancelled requests may still be billed.</p>
    </>}
    {trace.selected.map((source, index) => <details key={`${source.ref}:${index}`} className="mt-2 border-t border-geo-border pt-1">
      <summary>{source.title} · {source.scope} · {source.delivery ?? 'delivery unverified'} · {source.estimatedTokens} estimated tokens · {source.completeness}</summary>
      <p>Revision {source.revision}; selected because {source.reason}.</p>
      {source.location && <p>File location: {source.location.kind === 'pdf' ? `physical page ${source.location.page}${source.location.endPage ? `–${source.location.endPage}` : ''}` : source.location.kind === 'sheet' ? `${source.location.sheet}${source.location.range ? ` · ${source.location.range}` : ''}` : source.location.kind === 'lines' ? `lines ${source.location.start}–${source.location.end}` : source.location.kind === 'docx' ? `section ${source.location.section}` : 'image rendition'}. {source.location.kind === 'image' && source.estimatedTokens >= 8192 ? 'Visual context usage is a conservative estimate.' : ''}</p>}
      {!currentScope && <p>This is evidence from an earlier workspace. Change current source access through the browser below.</p>}
      <pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto text-foreground">{source.content}</pre>
      <button disabled={!currentScope} className="text-geo-accent" onClick={() => void exclude(source.sourceId, source.scope, trace.identity.projectId).catch(() => undefined)}>{excluded.includes(source.sourceId) ? 'Allow source again' : 'Exclude from future retrieval'}</button>
    </details>)}
    <ContextSourceBrowser />
    {!trace.evidenceExpired && <p className="mt-2">Other authorised sources are available through search. They were not all selected or sent. Cancelled requests can have uncertain delivery.</p>}
  </details>
}
