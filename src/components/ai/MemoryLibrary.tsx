import { useMemo, useState } from 'react'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { estimateTokens } from '@/lib/context/budget'
import { useAiStore, selectMessages, selectActiveChat } from '@/store/ai'
import { buildWorkingState } from '@/lib/context/working-state'

export function MemoryLibrary(): React.ReactElement {
  const globals = useContextStore(s => s.globals)
  const project = useContextStore(s => s.projectContext)
  const storageError = useContextStore(s => s.error)
  const ready = useContextStore(s => s.ready)
  const path = useProjectStore(s => s.path)
  const messages = useAiStore(selectMessages)
  const chats = useAiStore(state => state.chats)
  const sourceTitles = useMemo(() => new Map(chats.flatMap(chat => chat.messages.map(message => [message.id, chat.title] as const))), [chats])
  const recordedWorkingState = useAiStore(state => selectActiveChat(state)?.workingState)
  const [scope, setScope] = useState<'conversation' | 'project' | 'global'>('global')
  const [statement, setStatement] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [receipt, setReceipt] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const records = (scope === 'global' ? globals : project.memories).filter(m => m.statement.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (m.status !== 'candidate' || Date.now() - Date.parse(m.createdAt) <= 30 * 86400_000))
  const workingState = scope === 'conversation' ? recordedWorkingState ?? buildWorkingState(messages) : null
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    try { await action(); setError('') } catch (error) { setError(String(error)) }
  }
  return <section aria-label="Memory library" className="border border-geo-border rounded p-2 text-xs space-y-2 max-h-64 overflow-auto">
    <div className="flex gap-2">
      <button aria-pressed={scope === 'conversation'} onClick={() => setScope('conversation')}>Conversation</button>
      <button aria-pressed={scope === 'global'} onClick={() => { setScope('global'); setVisibleCount(50) }}>About you</button>
      <button aria-pressed={scope === 'project'} onClick={() => { setScope('project'); setVisibleCount(50) }}>Project</button>
    </div>
    <p className="text-geo-muted">Built-in, on this device. Suggestions require acceptance before retrieval. Selected context may be sent to your chosen assistant.</p>
    {!ready && <p role="status">Loading local memory settings…</p>}
    {scope === 'conversation' ? <>
      <p className="text-geo-muted">Derived working state for this chat. Original messages remain in the chat; this is not durable project or personal memory.</p>
      {workingState?.constraints.map((span, index) => <p key={`${span.messageId}:${index}`}>{span.text}</p>)}
      {workingState?.requests.map(span => <p key={span.messageId}>{span.text}</p>)}
      {workingState && [
        { label: 'Declared decisions', spans: workingState.decisions },
        { label: 'Questions to check against the conversation', spans: workingState.questions },
        { label: 'Referenced objects and identifiers', spans: workingState.entities },
        { label: 'Reported failed attempts', spans: workingState.failedAttempts },
      ].filter(group => group.spans.length).map(group => <details key={group.label}>
        <summary className="cursor-pointer text-geo-muted">{group.label}</summary>
        {group.spans.map((span, index) => <p key={`${span.messageId}:${index}`}>{span.text}</p>)}
      </details>)}
      {Boolean(workingState?.overflow.length) && <p>More original constraints and requests are available in the conversation through context search.</p>}
    </> : scope === 'project' && !path ? <p>Save this workspace as a project to keep project memory.</p> : <>
      <input aria-label="Search memories" value={query} onChange={e => { setQuery(e.target.value); setVisibleCount(50) }} placeholder="Search memories" className="w-full bg-geo-bg border border-geo-border rounded p-1" />
      {records.slice(0, visibleCount).map(record => <div key={record.id} className="border-t border-geo-border pt-1">
        {editing === record.id ? <>
          <textarea aria-label="Edit memory" value={editText} onChange={e => setEditText(e.target.value)} maxLength={4000} className="w-full bg-geo-bg border border-geo-border rounded p-1" />
          <button onClick={() => void act(async () => { await useContextStore.getState().edit(record.id, editText); setEditing(null); setReceipt('Memory corrected.') })}>Save correction</button>
          <button className="ml-2" onClick={() => setEditing(null)}>Cancel</button>
        </> : <p>{record.statement}</p>}
        <p className="text-geo-muted">{record.scope} · {record.status === 'candidate' ? 'suggested, not used by assistant' : record.status === 'active' ? 'remembered' : `${record.status}, not used by assistant`} · {new Date(record.updatedAt).toLocaleDateString()} · revision {record.revision}</p>
        {record.evidence.length > 0 && <p className="text-geo-muted">Source: {[...new Set(record.evidence.map(source => sourceTitles.get(source) ?? 'removed or unavailable source'))].join(', ')}{record.editedAt ? ' · independently edited' : ''}</p>}
        {record.supersedes.length > 0 && <p className="text-geo-muted">Replaces {record.supersedes.length} earlier preference{record.supersedes.length === 1 ? '' : 's'} in this scope.</p>}
        {record.status === 'active' && <label className="flex items-center gap-1 text-geo-muted"><input type="checkbox" checked={record.pinned === true} onChange={e => void act(() => useContextStore.getState().setPinned(record.id, e.target.checked))} />Always apply · {estimateTokens(record.statement)} estimated tokens each request</label>}
        {record.status === 'candidate' && <button className="mr-2 text-geo-accent" onClick={() => void act(() => useContextStore.getState().accept(record.id))}>Accept suggestion</button>}
        {['active', 'candidate'].includes(record.status) && <button className="text-geo-accent" onClick={() => { setEditing(record.id); setEditText(record.statement) }}>Edit</button>}
        <button className="ml-2 text-geo-accent" onClick={() => void act(async () => { await useContextStore.getState().forget(record.id); setReceipt('Forgotten from future retrieval. Older exports, backups and already transmitted content may still contain it.') })}>{record.status === 'candidate' ? 'Dismiss suggestion' : 'Forget'}</button>
        {['active', 'candidate'].includes(record.status) && <button disabled={record.scope === 'global' && !path} className="ml-2 text-geo-accent disabled:opacity-50" onClick={() => void act(async () => {
          await useContextStore.getState().remember(record.statement, record.scope === 'global' ? 'project' : 'global')
          await useContextStore.getState().forget(record.id)
          setReceipt(record.scope === 'global' ? 'Moved to project memory; save the project to commit it.' : 'Moved to About you; save the project to commit removal.')
        })}>{record.scope === 'global' ? 'Move to project' : 'Move to About you'}</button>}
      </div>)}
      {records.length > visibleCount && <button className="text-geo-accent" onClick={() => setVisibleCount(count => count + 50)}>Show 50 more memories ({records.length - visibleCount} remaining)</button>}
      <textarea aria-label="New memory" value={statement} onChange={e => setStatement(e.target.value)} maxLength={4000} placeholder="A preference or project decision to remember" className="w-full bg-geo-bg border border-geo-border rounded p-1" />
      <button disabled={!ready || !statement.trim()} className="text-geo-accent" onClick={() => void act(async () => { await useContextStore.getState().remember(statement, scope); setStatement('') })}>{scope === 'project' ? 'Remember on project save' : 'Remember about you'}</button>
      <button className="ml-2 text-geo-accent" onClick={() => void act(() => navigator.clipboard.writeText(records.map(record => JSON.stringify(record)).join('\n')))}>Copy readable export</button>
    </>}
    {(error || storageError) && <p role="status" className="text-geo-error">{error || storageError}</p>}
    {storageError && <button className="text-geo-accent" disabled={!ready} onClick={() => void act(() => useContextStore.getState().retryLocalMemory())}>Retry local memory</button>}
    {receipt && <p role="status" className="text-geo-muted">{receipt}</p>}
  </section>
}
