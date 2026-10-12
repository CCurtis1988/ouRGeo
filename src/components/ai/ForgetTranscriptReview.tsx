import { useMemo, useState } from 'react'
import type { AiChat } from '@/store/ai'
import type { MemoryRecord } from '@/lib/context/types'
import { inspectTranscriptCopy, planTranscriptForget, reviewTranscriptCopies, snapshotTranscriptCopy, type TranscriptCopy, type TranscriptForgetPlan, type TranscriptForgetScope } from '@/lib/context/transcript-forgetting'

interface Props {
  memory: MemoryRecord
  chats: AiChat[]
  scope: TranscriptForgetScope
  onForget: (plan: TranscriptForgetPlan) => Promise<unknown>
  onCancel: () => void
}

export function ForgetTranscriptReview({ memory, chats, scope, onForget, onCancel }: Props): React.ReactElement {
  const [reviewScope] = useState(() => ({ ...scope }))
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TranscriptCopy[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const candidates = useMemo(() => reviewTranscriptCopies(memory, chats, reviewScope, query), [memory, chats, reviewScope, query])
  const sourceCount = new Set([...memory.evidence, ...selected.map(copy => copy.messageId)]).size
  const changed = scope.workspaceEpoch !== reviewScope.workspaceEpoch || scope.projectId !== reviewScope.projectId || scope.activeChatId !== reviewScope.activeChatId
  const submit = async (): Promise<void> => {
    setPending(true)
    try { await onForget(planTranscriptForget(memory, selected, reviewScope)); onCancel() }
    catch (failure) { setError(String(failure)) }
    finally { setPending(false) }
  }
  return <section aria-label="Review forgetting memory and transcript copies" className="border border-geo-border rounded p-2 space-y-2 text-xs">
    <p className="font-medium">Forget this memory and selected message copies</p>
    <p>{memory.statement}</p>
    <p className="text-geo-muted">Scope: {reviewScope.savedProject ? 'chats currently loaded in this saved project' : 'this scratch conversation only'}. Each checked item removes the entire message, including any instructions and tool results it contains. Other projects, backups, exports and external assistant retention are not erased.</p>
    <input aria-label="Find transcript copies to forget" value={query} disabled={pending || changed} onChange={event => setQuery(event.target.value)} placeholder="Search exact wording; source messages are also listed" className="w-full bg-geo-bg border border-geo-border rounded p-1" />
    {candidates.length === 100 && <p className="text-geo-muted">Showing the first 100 matches. Use more exact wording to find another copy.</p>}
    {!candidates.length && <p>No matching copies in this scope. The memory can still be forgotten.</p>}
    <div className="max-h-48 overflow-auto space-y-2">
      {candidates.map(copy => {
        const checked = selected.some(item => item.chatId === copy.chatId && item.messageId === copy.messageId)
        const additional = !memory.evidence.includes(copy.messageId) && !selected.some(item => item.messageId === copy.messageId)
        const key = `${copy.chatId}:${copy.messageId}`
        const inspection = expanded === key ? inspectTranscriptCopy(copy) : null
        return <div key={key} className="block border-t border-geo-border pt-1"><label>
          <input type="checkbox" checked={checked} disabled={pending || changed || (!checked && (selected.length >= 32 || (additional && sourceCount >= 32)))} onChange={event => setSelected(items => event.target.checked ? [...items, snapshotTranscriptCopy(copy)] : items.filter(item => item.chatId !== copy.chatId || item.messageId !== copy.messageId))} />
          <span className="ml-1">{copy.chatTitle} · {copy.role === 'user' ? 'Your message' : 'Assistant message'}{copy.originalEvidence ? ' · original memory source' : ''}</span>
          </label><p className="text-geo-muted whitespace-pre-wrap">Excerpt: {copy.preview || '(No text; this message contains tool results.)'}</p>
          <button disabled={pending} className="text-geo-accent" onClick={() => setExpanded(expanded === key ? null : key)}>{expanded === key ? 'Hide original message' : 'Inspect original message'}</button>
          {inspection && <><pre className="whitespace-pre-wrap break-words max-h-48 overflow-auto">{inspection.text}</pre>{!inspection.complete && <p className="text-geo-muted">Display limited to 100,000 characters. Deletion still removes the entire message and its tool results.</p>}</>}
        </div>
      })}
    </div>
    {selected.length > 0 && <details><summary>Review all {selected.length} selected messages</summary>{selected.map(copy => <div key={`${copy.chatId}:${copy.messageId}`} className="border-t border-geo-border py-1"><p>{copy.chatTitle} · {copy.role} · {copy.preview.slice(0, 120)}</p><button disabled={pending} className="text-geo-accent" onClick={() => setSelected(items => items.filter(item => item.chatId !== copy.chatId || item.messageId !== copy.messageId))}>Keep this message</button></div>)}</details>}
    <p>{selected.length} complete messages selected · {sourceCount}/32 source suppression links, including the memory’s original evidence.</p>
    {changed && <p role="alert">The conversation or workspace changed. Cancel and review this action in the current workspace.</p>}
    <button disabled={pending || changed || sourceCount > 32} className="text-geo-accent disabled:opacity-50" onClick={() => void submit()}>Forget memory and remove {selected.length} selected messages</button>
    <button disabled={pending} className="ml-2" onClick={onCancel}>Cancel</button>
    {error && <p role="alert">{error}</p>}
  </section>
}
