import { useEffect, useState } from 'react'
import { useContextStore } from '@/store/context'
import { useEnvironmentStore } from '@/store/environment'
import { useProjectStore } from '@/store/project'
import { useSessionStore } from '@/store/session'
import { useColumnDisclosureStore } from '@/store/column-disclosure'
import { rClient } from '@/lib/r-client'
import { schemaColumns } from '@/lib/context/column-disclosure'
import { environmentSourceId } from '@/lib/context/source-identity'
import { Button } from '@/components/ui/button'

export function ColumnDisclosureSettings(): React.ReactElement {
  const environments = useEnvironmentStore(state => state.environments)
  const savedProject = useProjectStore(state => !!(state.path && state.projectId))
  const epoch = useProjectStore(state => state.workspaceEpoch)
  const rGeneration = useSessionStore(state => state.rGeneration)
  const rStatus = useSessionStore(state => state.rStatus)
  const isExecuting = useSessionStore(state => state.isExecuting)
  const disclosure = useColumnDisclosureStore()
  const [sourceId, setSourceId] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [schema, setSchema] = useState<{ sourceId: string; epoch: number; generation: number; object: object; columns: ReturnType<typeof schemaColumns> } | null>(null)
  const [loadingSchema, setLoadingSchema] = useState(false)
  // sf and other data-frame classes may not have columns in the inventory.
  // Offer them anyway, then use the narrow schema-only endpoint on selection.
  const objects = environments.filter(environment => !environment.isSearchPath).flatMap(environment => environment.objects
    .filter(object => schemaColumns(object.columns).length || /^(data\.frame|sf|tbl_df|tbl|data\.table)$/.test(object.class))
    .map(object => ({ id: environmentSourceId(environment.name, object.name), label: `${environment.name}::${object.name}`, envName: environment.name, object })))
  const selected = objects.find(object => object.id === sourceId)
  const selectedObject = selected?.object
  const selectedEnv = selected?.envName
  const cachedColumns = schemaColumns(selectedObject?.columns)
  const columns = schema?.sourceId === sourceId && schema.epoch === epoch && schema.generation === rGeneration && schema.object === selectedObject ? schema.columns : cachedColumns
  const denied = disclosure.workspaceEpoch === epoch ? disclosure.selections[sourceId] ?? [] : []

  useEffect(() => {
    setSchema(null); setError(''); setLoadingSchema(false)
    if (!selectedObject || !selectedEnv || schemaColumns(selectedObject.columns).length || rStatus !== 'ready' || isExecuting) return
    let current = true
    setLoadingSchema(true)
    void rClient.contextSchema(selectedObject.name, selectedEnv).then(result => {
      if (!current || useProjectStore.getState().workspaceEpoch !== epoch || useSessionStore.getState().rGeneration !== rGeneration) return
      if (!result.success) throw new Error(result.error ?? 'Column metadata is unavailable.')
      setSchema({ sourceId, epoch, generation: rGeneration, object: selectedObject, columns: schemaColumns(result.columns) })
    }).catch(failure => { if (current) setError(`Could not load column names: ${String(failure)}. Refresh workspace objects and try again.`) })
      .finally(() => { if (current) setLoadingSchema(false) })
    return () => { current = false }
  }, [sourceId, selectedObject, selectedEnv, epoch, rGeneration, rStatus, isExecuting])

  const refreshObjects = async (): Promise<void> => {
    setRefreshing(true); setError('')
    const generation = useSessionStore.getState().rGeneration
    try {
      const result = await rClient.listEnvironments()
      if (useProjectStore.getState().workspaceEpoch !== epoch || useSessionStore.getState().rGeneration !== generation) return
      if (!result.success) throw new Error('Workspace objects could not be refreshed.')
      useEnvironmentStore.getState().setEnvironments(result.environments)
    } catch (failure) {
      if (useProjectStore.getState().workspaceEpoch === epoch) setError(String(failure))
    } finally { setRefreshing(false) }
  }

  return <details className="text-xs text-geo-muted border border-geo-border rounded-lg p-3">
    <summary className="cursor-pointer font-medium text-foreground">Workspace column privacy</summary>
    <p className="mt-2">Hide selected column names and types from the assistant’s workspace context. This control loads column metadata on this device, without sampling values or running a model. {savedProject ? 'These choices are saved privately on this device for this project.' : 'These choices end when you load another workspace.'}</p>
    <Button type="button" variant="outline" size="sm" className="mt-3" disabled={refreshing || rStatus !== 'ready' || isExecuting} onClick={() => void refreshObjects()}>{refreshing ? 'Refreshing…' : 'Refresh workspace objects'}</Button>
    {rStatus !== 'ready' ? <p role="status" className="mt-2">Connect to R to load workspace objects.</p> : isExecuting ? <p role="status" className="mt-2">Wait for R to finish, then refresh workspace objects.</p> : !objects.length && <p className="mt-2">No data frames are listed yet. Create or load one in the R console, then choose Refresh workspace objects.</p>}
    <label className="block mt-3 text-foreground">Workspace object
      <select aria-label="Column privacy object" className="block mt-1 w-full bg-geo-bg border border-geo-border rounded p-2" disabled={refreshing} value={selected?.id ?? ''} onChange={event => setSourceId(event.target.value)}>
        <option value="">Choose a data frame</option>
        {objects.map(object => <option key={object.id} value={object.id}>{object.label}</option>)}
      </select>
    </label>
    {loadingSchema && <p role="status" className="mt-2">Loading column names…</p>}
    {selected && columns.length > 0 && <fieldset className="max-h-40 overflow-auto mt-3 text-foreground"><legend>Exclude column metadata</legend>{columns.slice(0, 256).map(column => <label key={column.name} className="flex gap-2 mt-2"><input type="checkbox" disabled={savedProject && !disclosure.loaded} checked={denied.includes(column.name)} onChange={event => {
      try { disclosure.setColumns(sourceId, event.target.checked ? [...denied, column.name] : denied.filter(name => name !== column.name)); setError('') }
      catch (failure) { setError(String(failure)) }
    }} />{column.name}</label>)}</fieldset>}
    {selected && !loadingSchema && !columns.length && !error && <p className="mt-2">No column names are available for this object. Refresh after R is ready, or choose an in-memory data frame.</p>}
    <p className="mt-3">Excluded columns pause assistant execution and other private-source reads that could bypass these filters. You can still use the GUI and R console directly. Original user messages remain available; already sent content cannot be recalled.</p>
    {disclosure.error && <p role="alert" className="mt-2 text-geo-error">{disclosure.error}</p>}
    {savedProject && !disclosure.loaded && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { const lease = useContextStore.getState().projectLease; if (lease) void disclosure.hydrate(lease) }}>Reload column privacy settings</Button>}
    {error && <p role="alert" className="mt-2 text-geo-error">{error}</p>}
  </details>
}
