import { useState } from 'react'
import { useSessionStore } from '@/store/session'
import { useContextStore } from '@/store/context'
import { useProjectStore } from '@/store/project'
import type { PublicMemoryConnection } from '@/lib/context/providers/connections'

/** A selection is a preview, not authority. Main rechecks committed revisions,
 * exclusions and the active binding after native consent. */
export function MemoryImportSelection({ connection, disabled, review }: {
  connection: PublicMemoryConnection
  disabled: boolean
  review: (ids: string[]) => Promise<boolean>
}): React.ReactElement {
  const globals = useContextStore(state => state.globals)
  const projectContext = useContextStore(state => state.projectContext)
  const committedRevision = useContextStore(state => state.committedRevision)
  const excluded = useContextStore(state => state.excluded)
  const projectId = useProjectStore(state => state.projectId)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const unsaved = connection.scope !== 'global' && projectContext.revision !== committedRevision
  const records = (connection.scope === 'global' ? globals : unsaved ? [] : projectContext.memories)
    .filter(record => record.status === 'active' && (connection.scope === 'global' ? record.scope === 'global' : record.scope === 'project' && record.projectId === projectId)
      && !excluded.includes(`memory:${record.id}`))
  const selectedIds = selected.filter(id => records.some(record => record.id === id))
  const matches = records.filter(record => record.statement.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <details className="mt-2" aria-label={`Import memories to ${connection.label}`}>
    <summary className="cursor-pointer">Import existing committed memories</summary>
    <p className="text-geo-muted">Choose existing memories to copy to this active provider. Canonical records stay in ouRGeo. No other scope or conversation history is imported.</p>
    {unsaved && <p role="status">Save this project before selecting committed project memories.</p>}
    <label className="block mt-1">Find a memory<input aria-label="Find memories to import" value={query} maxLength={256} onChange={event => setQuery(event.target.value)} className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>
    <fieldset disabled={disabled}><legend className="text-geo-muted">{matches.length} matching memories · {selectedIds.length} selected</legend>
      {matches.slice(0, 100).map(record => <label key={record.id} className="flex items-start gap-2 mt-1">
        <input type="checkbox" checked={selectedIds.includes(record.id)} onChange={event => {
          setNotice('')
          setSelected(event.target.checked ? [...selectedIds, record.id].slice(0, 1000) : selectedIds.filter(id => id !== record.id))
        }} /><span className="break-words">{record.statement}</span>
      </label>)}
    </fieldset>
    {matches.length > 100 && <p className="text-geo-muted">Showing the first 100. Narrow the search to find more; selected memories remain selected.</p>}
    <button className="text-geo-accent mt-2 disabled:opacity-50" disabled={disabled || !selectedIds.length} onClick={() => {
      const epoch = useProjectStore.getState().workspaceEpoch
      void review(selectedIds).then(saved => { setNotice(saved ? 'Selected memories queued for import. Processing may be pending; canonical records remain local.' : 'Review cancelled. No memories queued.'); if (saved) { setSelected([]); if (useProjectStore.getState().workspaceEpoch === epoch) useSessionStore.getState().addConsoleEntry('info', '[Context] Selected committed memories queued for provider import.') } }, () => setNotice('Import did not complete. Review the current memories, save project changes and retry.'))
    }}>Review import of {selectedIds.length} {selectedIds.length === 1 ? 'memory' : 'memories'}</button>
    {notice && <p role="status" className="text-geo-muted mt-1">{notice}</p>}
  </details>
}
