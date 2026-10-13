import { Button } from '@/components/ui/button'
import { useId, useMemo, useState } from 'react'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { estimateTokens } from '@/lib/context/budget'
import { useAiStore, selectMessages, selectActiveChat } from '@/store/ai'
import { buildWorkingState } from '@/lib/context/working-state'
import { memoryRetention } from '@/lib/context/retention'
import type { MemoryRecord } from '@/lib/context/types'
import { ConversationMemoryLibrary } from './ConversationMemoryLibrary'
import { ForgetTranscriptReview } from './ForgetTranscriptReview'

export function MemoryLibrary({ placement = 'assistant' }: { placement?: 'assistant' | 'settings' }): React.ReactElement {
  const globals = useContextStore(s => s.globals)
  const project = useContextStore(s => s.projectContext)
  const storageError = useContextStore(s => s.error)
  const ready = useContextStore(s => s.ready)
  const path = useProjectStore(s => s.path)
  const messages = useAiStore(selectMessages)
  const chats = useAiStore(state => state.chats)
  const sourceTitles = useMemo(() => new Map(chats.flatMap(chat => chat.messages.map(message => [message.id, chat.title] as const))), [chats])
  const recordedWorkingState = useAiStore(state => selectActiveChat(state)?.workingState)
  const newMemoryId = useId()
  const [scope, setScope] = useState<'conversation' | 'project' | 'global'>('global')
  const [statement, setStatement] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [receipt, setReceipt] = useState('')
  const [forgetReview, setForgetReview] = useState<MemoryRecord | null>(null)
  const projectId = useProjectStore(state => state.projectId)
  const workspaceEpoch = useProjectStore(state => state.workspaceEpoch)
  const activeChatId = useAiStore(state => state.activeChatId)
  const [visibleCount, setVisibleCount] = useState(50)
  const records = (scope === 'global' ? globals : project.memories).filter(m => m.statement.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && !memoryRetention(m).expired)
  const workingState = scope === 'conversation' ? recordedWorkingState ?? buildWorkingState(messages) : null
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try { await action(); setError('') } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <section aria-label="Memory library" className={`border border-geo-border rounded-lg bg-geo-bg/40 p-3 text-xs space-y-3 ${placement === 'assistant' ? 'max-h-80 overflow-y-auto' : ''}`}>
    <h4 className="text-sm font-semibold text-foreground">Memory Library</h4>
    <nav aria-label="Memory scopes" className="flex flex-wrap gap-2">
      {([['global', 'About you'], ['project', 'Project'], ['conversation', 'Conversation']] as const).map(([value, label]) => <button
        key={value} type="button" disabled={busy} aria-pressed={scope === value}
        onClick={() => { setScope(value); setVisibleCount(50); setEditing(null); setReceipt('') }}
        className={`rounded-md border px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent ${scope === value ? 'border-geo-accent bg-geo-accent/10 text-geo-accent font-semibold' : 'border-geo-border bg-geo-panel text-geo-muted hover:text-foreground hover:border-geo-muted'}`}
      >{label}</button>)}
    </nav>
    <p className="text-geo-muted">{scope === 'global' ? 'About you: personal preferences available across projects and chats.' : scope === 'project' ? 'Project: instructions for this saved project. Save the project to keep changes.' : 'Conversation: instructions and memories for the current chat.'} Selected context may be sent to your chosen assistant.</p>
    {!ready && <p role="status">Loading local memory settings…</p>}
    {scope === 'conversation' ? <>
      <ConversationMemoryLibrary key={activeChatId} />
      <details><summary className="cursor-pointer text-geo-muted">Other working context from original messages</summary>
      <p className="text-geo-muted">Derived working state for this chat. Original messages remain in the chat; this is not durable project or personal memory.</p>
      {workingState?.requests.map(span => <p key={span.messageId}>{span.text}</p>)}
      {workingState && [
        { label: 'Questions to check against the conversation', spans: workingState.questions },
        { label: 'Referenced objects and identifiers', spans: workingState.entities },
        { label: 'Reported failed attempts', spans: workingState.failedAttempts },
      ].filter(group => group.spans.length).map(group => <details key={group.label}>
        <summary className="cursor-pointer text-geo-muted">{group.label}</summary>
        {group.spans.map((span, index) => <p key={`${span.messageId}:${index}`}>{span.text}</p>)}
      </details>)}
      {Boolean(workingState?.overflow.length) && <p>More original constraints and requests are available in the conversation through context search.</p>}
      </details>
    </> : scope === 'project' && !path ? <p>Save this workspace as a project to keep project memory.</p> : <>
      <form className="space-y-2 rounded-md border border-geo-border bg-geo-panel p-3" onSubmit={event => {
        event.preventDefault()
        if (busy || !ready || !statement.trim()) return
        void act(async () => {
          await useContextStore.getState().remember(statement, scope)
          setStatement(''); setQuery(''); setVisibleCount(50)
          setReceipt(scope === 'project' ? 'Project memory added. Save the project to keep it.' : 'Memory added to About you.')
        })
      }}>
        <label className="block font-medium" htmlFor={newMemoryId}>Add a memory</label>
        <p className="text-[11px] text-geo-muted">Write a preference or instruction directly. Adding a memory does not run a model.</p>
        <textarea id={newMemoryId} aria-label="New memory" value={statement} disabled={busy} onChange={e => setStatement(e.target.value)} maxLength={4000} rows={3} placeholder={scope === 'project' ? 'For example: Keep the source data unchanged.' : 'For example: I prefer metric units and concise answers.'} className="w-full bg-geo-bg border border-geo-border rounded p-2 focus:outline-none focus:border-geo-accent" />
        <Button type="submit" size="sm" disabled={busy || !ready || !statement.trim()}>{busy ? 'Saving…' : scope === 'project' ? 'Remember on project save' : 'Remember about you'}</Button>
      </form>
      <div className="flex items-center justify-between gap-2"><h5 className="font-medium">Saved memories</h5><span className="text-geo-muted">{records.length} {query ? 'matching' : 'total'}</span></div>
      <input aria-label="Search memories" value={query} onChange={e => { setQuery(e.target.value); setVisibleCount(50) }} placeholder="Search memories" className="w-full bg-geo-bg border border-geo-border rounded p-1" />
      {!records.length && <p className="text-geo-muted">{query ? 'No memories match your search.' : 'No memories in this scope yet. Add one above.'}</p>}
      <div className="space-y-3 max-h-64 overflow-y-auto">
      {records.slice(0, visibleCount).map(record => <div key={record.id} className="border border-geo-border rounded-md bg-geo-panel p-3 space-y-2">
        {editing === record.id ? <>
          <textarea aria-label="Edit memory" value={editText} onChange={e => setEditText(e.target.value)} maxLength={4000} className="w-full bg-geo-bg border border-geo-border rounded p-1" />
          <Button type="button" variant="outline" size="sm" disabled={busy || !editText.trim()} onClick={() => void act(async () => { await useContextStore.getState().edit(record.id, editText); setEditing(null); setReceipt('Memory corrected.') })}>Save correction</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} className="ml-2" onClick={() => setEditing(null)}>Cancel</Button>
        </> : <p>{record.statement}</p>}
        <p className="text-geo-muted">{record.scope} · {record.status === 'candidate' ? 'suggested, not used by assistant' : record.status === 'active' ? 'remembered' : `${record.status}, not used by assistant`} · {new Date(record.updatedAt).toLocaleDateString()} · revision {record.revision}</p>
        {memoryRetention(record).review && <p className="text-geo-muted">Review this inferred preference: no new supporting evidence for 180 days. Edit to confirm it, or Forget.</p>}
        {record.evidence.length > 0 && <p className="text-geo-muted">Source: {[...new Set(record.evidence.map(source => sourceTitles.get(source) ?? 'removed or unavailable source'))].join(', ')}{record.editedAt ? ' · independently edited' : ''}</p>}
        {record.supersedes.length > 0 && <p className="text-geo-muted">Replaces {record.supersedes.length} earlier preference{record.supersedes.length === 1 ? '' : 's'} in this scope.</p>}
        {record.status === 'active' && <label className="flex items-center gap-1 text-geo-muted"><input type="checkbox" disabled={busy} checked={record.pinned === true} onChange={e => void act(() => useContextStore.getState().setPinned(record.id, e.target.checked))} />Always apply · {estimateTokens(record.statement)} estimated tokens each request</label>}
        {record.status === 'candidate' && <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => void act(() => useContextStore.getState().accept(record.id))}>Accept suggestion</Button>}
        {['active', 'candidate'].includes(record.status) && <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => { setEditing(record.id); setEditText(record.statement) }}>Edit</Button>}
        <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => void act(async () => { await useContextStore.getState().forget(record.id); setReceipt('Forgotten from future retrieval. Older exports, backups and already transmitted content may still contain it.') })}>{record.status === 'candidate' ? 'Dismiss suggestion' : 'Forget'}</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => setForgetReview(record)}>Review transcript copies to forget</Button>
        {['active', 'candidate'].includes(record.status) && <Button type="button" variant="outline" size="sm" disabled={busy || record.scope === 'global' && !path} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => void act(async () => {
          await useContextStore.getState().remember(record.statement, record.scope === 'global' ? 'project' : 'global')
          await useContextStore.getState().forget(record.id)
          setReceipt(record.scope === 'global' ? 'Moved to project memory; save the project to commit it.' : 'Moved to About you; save the project to commit removal.')
        })}>{record.scope === 'global' ? 'Move to project' : 'Move to About you'}</Button>}
        {['active', 'candidate'].includes(record.status) && <Button type="button" variant="outline" size="sm" disabled={busy || !activeChatId} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => void act(async () => {
          useAiStore.getState().setConversationMemory(activeChatId!, record.statement)
          await useContextStore.getState().forget(record.id)
          setReceipt('Moved to this conversation. Save the project to keep chat memories and project-memory removal.')
        })}>Move to conversation</Button>}
      </div>)}
      </div>
      {records.length > visibleCount && <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => setVisibleCount(count => count + 50)}>Show 50 more memories ({records.length - visibleCount} remaining)</Button>}
      <Button type="button" variant="outline" size="sm" disabled={busy} className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" onClick={() => void act(() => navigator.clipboard.writeText(records.map(record => JSON.stringify(record)).join('\n')))}>Copy readable export</Button>
    </>}
    {forgetReview && <ForgetTranscriptReview memory={forgetReview} chats={chats} scope={{ workspaceEpoch, projectId, savedProject: Boolean(path), activeChatId }} onCancel={() => setForgetReview(null)} onForget={async plan => {
      await useContextStore.getState().forgetEverywhere(plan)
      setReceipt(`Memory and selected message copies forgotten in the reviewed scope.${path ? ' Save this project to commit transcript removal.' : ''} Older exports, backups and already transmitted content may still contain them.`)
    }} />}
    {(error || storageError) && <p role="status" className="text-geo-error">{error || storageError}</p>}
    {storageError && <Button type="button" variant="outline" size="sm" className="mr-2 mb-1 h-auto min-h-7 whitespace-normal text-left" disabled={busy || !ready} onClick={() => void act(() => useContextStore.getState().retryLocalMemory())}>Retry local memory</Button>}
    {receipt && <p role="status" className="text-geo-muted">{receipt}</p>}
  </section>
}
