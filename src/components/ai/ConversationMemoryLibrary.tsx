import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { selectActiveChat, useAiStore } from '@/store/ai'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { conversationMemories, type ConversationMemory } from '@/lib/context/conversation-memory'

export function ConversationMemoryLibrary(): React.ReactElement {
  const chat = useAiStore(selectActiveChat)
  const path = useProjectStore(state => state.path)
  const fieldId = useId()
  const [statement, setStatement] = useState('')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState('')
  const [busy, setBusy] = useState(false)
  const records = chat ? conversationMemories(chat).filter(record => record.statement.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : []
  const act = async (action: () => Promise<unknown> | void): Promise<void> => {
    setBusy(true)
    try { await action(); setError('') } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const forget = (record: ConversationMemory): void => {
    useAiStore.getState().setConversationMemory(chat!.id, record.statement, record.id, { kind: 'forget' })
    useContextStore.getState().revokeDelivery()
  }
  const move = async (record: ConversationMemory, scope: 'project' | 'global'): Promise<void> => {
    const epoch = useProjectStore.getState().workspaceEpoch
    await useContextStore.getState().remember(record.statement, scope)
    if (useProjectStore.getState().workspaceEpoch !== epoch || useAiStore.getState().activeChatId !== chat!.id) throw new Error('The workspace or conversation changed. The destination was saved; the original conversation memory was kept. Review both libraries.')
    forget(record)
    setReceipt(scope === 'project' ? 'Moved to Project. Save the project to keep this change.' : 'Moved to About you.')
  }
  return <div key={chat?.id} className="space-y-3">
    <p className="font-medium">Current conversation: {chat?.title ?? 'No chat selected'}</p>
    <p className="text-geo-muted">These memories apply to this chat. Corrections apply on future requests. Removing or moving a memory keeps its original chat messages; those messages may still contain the instruction. Saved projects keep chat memories; scratch chat memories end when the app closes normally.</p>
    <form className="space-y-2 rounded-md border border-geo-border bg-geo-panel p-3" onSubmit={event => {
      event.preventDefault()
      if (busy || !chat || !statement.trim()) return
      void act(() => {
        useAiStore.getState().setConversationMemory(chat.id, statement)
        useContextStore.getState().revokeDelivery()
        setStatement(''); setQuery(''); setReceipt('Memory added to this conversation without running a model.')
      })
    }}>
      <label htmlFor={fieldId} className="block font-medium">Add a memory</label>
      <textarea id={fieldId} aria-label="New memory" value={statement} disabled={busy || !chat} onChange={event => setStatement(event.target.value)} rows={3} maxLength={4000} placeholder="For example: Use exactly 100 metres for this chat." className="w-full bg-geo-bg border border-geo-border rounded p-2 focus:outline-none focus:border-geo-accent" />
      <Button type="submit" size="sm" disabled={busy || !chat || !statement.trim()}>Remember for this conversation</Button>
    </form>
    <div className="flex items-center justify-between gap-2"><h5 className="font-medium">Conversation memories</h5><span className="text-geo-muted">{records.length} {query ? 'matching' : 'total'}</span></div>
    <input aria-label="Search memories" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search memories" className="w-full bg-geo-bg border border-geo-border rounded p-1" />
    {!records.length && <p className="text-geo-muted">{query ? 'No memories match your search.' : 'No conversation memories yet. Add one above or give an instruction in the chat.'}</p>}
    <div className="space-y-3 max-h-64 overflow-y-auto">{records.map(record => <div key={record.id} className="border border-geo-border rounded-md bg-geo-panel p-3 space-y-2">
      {editing === record.id ? <>
        <textarea aria-label="Edit memory" value={editText} disabled={busy} onChange={event => setEditText(event.target.value)} maxLength={4000} className="w-full bg-geo-bg border border-geo-border rounded p-2" />
        <Button type="button" variant="outline" size="sm" disabled={busy || !editText.trim()} onClick={() => void act(() => {
          useAiStore.getState().setConversationMemory(chat!.id, editText, record.id)
          useContextStore.getState().revokeDelivery()
          setEditing(null); setReceipt('Conversation memory corrected. Original messages remain in the chat.')
        })}>Save correction</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} className="ml-2" onClick={() => setEditing(null)}>Cancel</Button>
      </> : <p>{record.statement}</p>}
      <p className="text-geo-muted">{record.sourceMessageId ? chat?.messages.some(message => message.id === record.sourceMessageId) ? 'From a user instruction in this chat' : 'Original source message removed' : 'Added directly to this chat'} · revision {record.revision}</p>
      <label className="flex items-center gap-1 text-geo-muted"><input type="checkbox" disabled={busy} checked={chat?.conversationMemories?.some(note => note.id === record.id && note.pinned !== false) ?? false} onChange={event => void act(() => {
        useAiStore.getState().setConversationMemory(chat!.id, record.statement, record.id, { kind: 'pin', pinned: event.target.checked })
        useContextStore.getState().revokeDelivery()
      })} />Always apply</label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(record.id); setEditText(record.statement) }}>Edit</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(() => { forget(record); setReceipt('Removed from conversation memory. Original messages, older exports and already transmitted content may still contain it.') })}>Forget</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || !path} onClick={() => void act(() => move(record, 'project'))}>Move to project</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(() => move(record, 'global'))}>Move to About you</Button>
      </div>
    </div>)}</div>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(records.map(record => JSON.stringify({ ...record, scope: 'conversation', chatId: chat!.id })).join('\n')))}>Copy readable export</Button>
    {error && <p role="status" className="text-geo-error">{error}</p>}
    {receipt && <p role="status" className="text-geo-muted">{receipt}</p>}
  </div>
}
