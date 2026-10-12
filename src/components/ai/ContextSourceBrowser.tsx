import { useEffect, useState } from 'react'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import { useColumnDisclosureStore } from '@/store/column-disclosure'
import { workspaceSourceScan } from '@/lib/context/sources/workspace'
import { sourceBrowserPage, type SourceBrowserCard } from '@/lib/context/source-browser'
import type { ContextSource } from '@/lib/context/types'
import { useAiStore } from '@/store/ai'
import { conversationSourceId } from '@/lib/context/source-identity'

function* discoverySources(): Iterable<ContextSource> {
  yield* workspaceSourceScan(['environment', 'console', 'document', 'skill', 'action', 'memory'])
  const project = useProjectStore.getState(), ai = useAiStore.getState()
  for (const chat of ai.chats) {
    if (!project.path && chat.id !== ai.activeChatId) continue
    yield { id: conversationSourceId(chat.id), kind: 'conversation', scope: chat.id === ai.activeChatId ? 'conversation' : 'project', title: chat.title, summary: `${chat.messages.length} messages; conversation history`, revision: String(chat.updatedAt), trust: 'untrusted', read: () => '' }
  }
}

/** Closed inspectors perform no discovery. A deliberate browse/search reads
 * current local descriptors, never R, remote providers or source bodies. */
export function ContextSourceBrowser(): React.ReactElement {
  const activeChat = useAiStore(state => state.activeChatId)
  const projectId = useProjectStore(state => state.projectId)
  const epoch = useProjectStore(state => state.workspaceEpoch)
  const policy = useContextStore(state => state.policyRevision)
  const loaded = useContextStore(state => state.exclusionsLoaded)
  const columnLoaded = useColumnDisclosureStore(state => state.loaded)
  const [pageIdentity, setPageIdentity] = useState('')
  const [page, setPage] = useState<ReturnType<typeof sourceBrowserPage> | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'available' | 'excluded'>('all')
  const [start, setStart] = useState(0)
  const [error, setError] = useState('')
  const allowed = loaded && (!projectId || columnLoaded)
  const identity = `${projectId}:${epoch}:${policy}:${activeChat}:${allowed}`
  const currentPage = pageIdentity === identity ? page : null
  useEffect(() => { setPage(null); setStart(0); setError('') }, [projectId, epoch, policy, activeChat, allowed])
  const browse = (nextQuery = query, nextStart = 0, nextFilter = filter): void => {
    if (!allowed) { setError('Privacy settings are unavailable. Reload protected settings before browsing sources.'); return }
    try {
      setPage(sourceBrowserPage(nextQuery, discoverySources, useContextStore.getState().excluded, nextStart, nextFilter))
      setPageIdentity(identity)
      setStart(nextStart); setError('')
    } catch (failure) { setPage(null); setError(String(failure)) }
  }
  const changeExclusion = async (card: SourceBrowserCard): Promise<void> => {
    const project = useProjectStore.getState(), privacy = useContextStore.getState()
    if (project.workspaceEpoch !== epoch || project.projectId !== projectId || privacy.policyRevision !== policy || !privacy.exclusionsLoaded) { setPage(null); setError('The workspace or privacy policy changed. Browse current sources again.'); return }
    try { await privacy.exclude(card.id, card.scope, projectId) }
    catch (failure) { setError(`Source privacy could not be changed: ${String(failure)}`) }
  }
  return <section className="mt-2 border-t border-geo-border pt-2" aria-label="Current context sources">
    <p>Available and excluded sources below describe the current workspace. They are separate from this answer’s historical selection and delivery receipt.</p>
    {!currentPage && <button type="button" className="text-geo-accent" disabled={!allowed} onClick={() => browse()}>Browse current context sources</button>}
    {!allowed && <p>Source browsing is paused until protected privacy settings are loaded.</p>}
    {currentPage && <>
      <label className="block mt-1">Search current source descriptions<input aria-label="Search current context sources" value={query} maxLength={300} className="block w-full bg-geo-bg border border-geo-border rounded p-1" onChange={event => { setQuery(event.target.value); browse(event.target.value) }} /></label>
      <label className="block mt-1">Source state<select aria-label="Context source state" className="bg-geo-bg border border-geo-border rounded p-1 ml-1" value={filter} onChange={event => { const value = event.target.value as typeof filter; setFilter(value); browse(query, 0, value) }}><option value="all">Available and excluded</option><option value="available">Available</option><option value="excluded">Excluded</option></select></label>
      <p>{currentPage.total.toLocaleString()} matching descriptions. Available means searchable; it does not mean selected or sent.</p>
      <ul>{currentPage.cards.map(card => <li key={card.id} className="mt-2 border-t border-geo-border pt-1"><p>{card.title} · {card.kind} · {card.scope} · {card.state}</p><p>Revision {card.revision}; {card.reason}.</p><p className="break-words">{card.summary}</p><button type="button" className="text-geo-accent" onClick={() => void changeExclusion(card)}>{card.state === 'excluded' ? 'Allow source again' : 'Exclude source'}</button></li>)}</ul>
      <div className="flex gap-3 mt-2"><button type="button" disabled={start === 0} onClick={() => browse(query, Math.max(0, start - 10))}>Previous sources</button><button type="button" disabled={start + 10 >= currentPage.total || start >= 10000} onClick={() => browse(query, start + 10)}>Next sources</button><button type="button" onClick={() => browse()}>Refresh source descriptions</button></div>
      {start >= 10000 && start + 10 < currentPage.total && <p>Narrow the search to browse further matches.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
