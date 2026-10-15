import { MemoryImportSelection } from './MemoryImportSelection'
import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import type { MemoryAdapter, ProcessingDestination, ProcessingPurpose, PublicMemoryConnection } from '@/lib/context/providers/connections'
import type { ProviderActivationStatus } from '@/lib/context/providers/activation'
import type { ProviderMigrationStatus } from '@/lib/context/providers/migration'
import type { PublicProviderContribution } from '@/lib/context/providers/contributions'

const purposes: ProcessingPurpose[] = ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync']
export function MemoryConnections(): React.ReactElement {
  const projectId = useProjectStore(state => state.projectId)
  const workspaceEpoch = useProjectStore(state => state.workspaceEpoch)
  const providerRevision = useContextStore(state => state.providerRevision)
  const ready = useContextStore(state => state.ready)
  const personalMemoryAvailable = useContextStore(state => state.personalMemoryAvailable)
  const [connections, setConnections] = useState<PublicMemoryConnection[]>([])
  const [activation, setActivation] = useState<ProviderActivationStatus[]>([])
  const [migrations, setMigrations] = useState<ProviderMigrationStatus[]>([])
  const [contributions, setContributions] = useState<PublicProviderContribution[]>([])
  const [adapter, setAdapter] = useState<MemoryAdapter>('hindsight')
  const [label, setLabel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [namespace, setNamespace] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [location, setLocation] = useState<'loopback' | 'server'>('server')
  const [destinations, setDestinations] = useState<ProcessingDestination[]>(purposes.map(purpose => ({ purpose, destination: 'unknown' })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(0)
  const listing = useRef(0)
  useEffect(() => {
    let current = true
    const request = ++listing.current
    setConnections([])
    setActivation([])
    setMigrations([])
    setContributions([])
    setToken('')
    setError('')
    if (ready && personalMemoryAvailable) void Promise.all([window.electronAPI.context.connections(), window.electronAPI.context.activationStatus(), window.electronAPI.context.memoryMigrations(), window.electronAPI.context.providerContributions()]).then(
      ([connections, status, migrations, contributions]) => { if (current && listing.current === request) { setConnections(connections); setActivation(status); setMigrations(migrations); setContributions(contributions) } },
      () => { if (current && listing.current === request) setError('Connection settings are unavailable. Restore protected storage and retry.') })
    return () => { current = false }
  }, [workspaceEpoch, ready, personalMemoryAvailable, providerRevision])
  useEffect(() => { if (!projectId) setScope('global') }, [projectId])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    const epoch = useProjectStore.getState().workspaceEpoch
    pending.current++
    setBusy(true); setError('')
    try {
      await action()
      if (useProjectStore.getState().workspaceEpoch === epoch) {
        const request = ++listing.current
        const [connections, status, migrations, contributions] = await Promise.all([window.electronAPI.context.connections(), window.electronAPI.context.activationStatus(), window.electronAPI.context.memoryMigrations(), window.electronAPI.context.providerContributions()])
        if (useProjectStore.getState().workspaceEpoch === epoch && listing.current === request) { setConnections(connections); setActivation(status); setMigrations(migrations); setContributions(contributions) }
      }
    } catch (error) {
      if (useProjectStore.getState().workspaceEpoch === epoch) setError(error instanceof Error ? error.message : 'The connection operation failed. Check its endpoint, authentication and protected storage, then retry.')
    } finally {
      setBusy(--pending.current > 0)
      if (useProjectStore.getState().workspaceEpoch === epoch) setToken('')
    }
  }
  return <details className="text-xs border border-geo-border rounded p-2" aria-label="Memory provider connections">
    <summary className="cursor-pointer">Mnemosyne and Hindsight connections</summary>
    <p className="text-geo-muted mt-2">The built-in manager remains active. Deployment review is required before enabling memory updates; testing reachability grants no access. Activation reviews this scope and future committed updates. Testing sends no chat or memory content. A local server may use remote processing.</p>
    {!personalMemoryAvailable && <p className="text-geo-muted mt-1">Restore protected memory storage to save connections and authentication.</p>}
    <button className="text-geo-accent mt-2" disabled={busy} onClick={() => void act(async () => undefined)}>Refresh provider settings</button>
    {contributions.length > 0 && <section aria-label="Plugin memory profiles" data-ourgeo-id="context.pluginProviders" className="mt-3 border border-geo-border rounded p-2">
      <h4 className="font-medium">Plugin memory profiles</h4>
      <p className="text-geo-muted">Enabling a plugin offers its profiles here. Stage the corresponding runtime below, then separately review each scope. Existing memories stay local until selected for import or migration.</p>
      {contributions.map(item => <div key={`${item.pluginId}:${item.id}`} className="border-t border-geo-border mt-2 pt-2">
        <p>{item.label} · {item.pluginId} · {item.profileId}</p>
        {!item.available ? <p className="text-geo-muted">This profile has no host-reviewed implementation on this platform. Update ouRGeo or choose an available profile.</p> : (['global', ...(projectId ? ['project'] : [])] as Array<'global' | 'project'>).map(scope => <button key={scope} className="text-geo-accent mr-3 mt-1" disabled={busy} onClick={() => void act(async () => {
          const lease = await window.electronAPI.context.lease()
          const preview = await window.electronAPI.context.previewContributedProvider({ pluginId: item.pluginId, id: item.id, manifestSha256: item.manifestSha256 }, scope, lease.id)
          await window.electronAPI.context.activateProvider(preview.ref)
        })}>Review {item.label} for {scope === 'global' ? 'About you' : 'this project'}</button>)}
      </div>)}
    </section>}
    {migrations.length > 0 && <section aria-label="Memory provider migrations" data-ourgeo-id="context.providerMigrations" className="mt-3 border border-geo-border rounded p-2">
      <h4 className="font-medium">Provider migrations</h4>
      <button className="text-geo-accent mt-1" disabled={busy} onClick={() => void act(async () => undefined)}>Refresh migration progress</button>
      {migrations.map(migration => <div key={migration.id} className="border-t border-geo-border mt-2 pt-2">
        <p>{migration.scope === 'global' ? 'About you' : 'This project'} · {migration.state} · {migration.copiedCount}/{migration.selectedCount} copied · {migration.removedCount}/{migration.oldCopyCount} old copies removed</p>
        <p className="text-geo-muted">{migration.recovery}</p>
        {migration.state === 'ready' && <><button className="text-geo-accent mr-3" disabled={busy} onClick={() => void act(async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.finishMemoryMigration(migration.id, 'retain', lease.id) })}>Keep old-provider copies</button><button className="text-geo-accent" disabled={busy} onClick={() => void act(async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.finishMemoryMigration(migration.id, 'delete', lease.id) })}>Review removal of old-provider copies</button></>}
        {['copying', 'ready', 'cleaning'].includes(migration.state) && <button className="text-geo-accent ml-3" disabled={busy} onClick={() => void act(async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.cancelMemoryMigration(migration.id, lease.id) })}>Cancel migration and pause processing</button>}
      </div>)}
    </section>}
    {connections.map(connection => <div key={connection.id} className="border-t border-geo-border mt-2 pt-2">
      <p>{connection.label} · {connection.adapter} · {connection.localServer ? 'On this device, authenticated local server' : connection.location === 'managed-local' ? 'On this device' : connection.location === 'loopback' ? 'Your server, loopback' : 'Your server or hosted service'} · {connection.scope === 'global' ? 'About you' : 'This project'}</p>
      <p className="text-geo-muted break-words">{connection.endpoint}</p>
      <p className="text-geo-muted">{connection.state} · {connection.location === 'managed-local' || connection.localServer ? 'experimental Linux lexical profile' : 'certification pending'} · authentication {connection.authenticated ? 'stored in protected storage' : 'not stored'}</p>
      <p className="text-geo-muted">Memory updates: {activation.find(item => item.connectionId === connection.id)?.state ?? 'review-required'}</p>
      {activation.find(item => item.connectionId === connection.id)?.state === 'review-required' && <p className="text-geo-muted">Review of this exact deployment, isolation, derivative deletion, processing destinations and billing is required.</p>}
      {['ready', 'paused'].includes(activation.find(item => item.connectionId === connection.id)?.state ?? '') && <button className="text-geo-accent mr-2" disabled={busy} onClick={() => void act(async () => {
        const lease = await window.electronAPI.context.lease()
        const preview = await window.electronAPI.context.previewActivation(connection.id, [], lease.id)
        await window.electronAPI.context.activateProvider(preview.ref)
      })}>Review activation of future memory updates</button>}
      {activation.find(item => item.connectionId === connection.id)?.state === 'active' && <button className="text-geo-accent mr-2" disabled={busy} onClick={() => void act(() => window.electronAPI.context.pauseProvider(connection.id))}>Pause memory updates</button>}
      {activation.find(item => item.connectionId === connection.id)?.state === 'active' && <button className="text-geo-accent mr-2" disabled={busy} onClick={() => void act(async () => { const lease = await window.electronAPI.context.lease(); await window.electronAPI.context.useBuiltinMemory(connection.id, lease.id) })}>Use built-in memory instead</button>}
      {['ready', 'paused'].includes(activation.find(item => item.connectionId === connection.id)?.state ?? '') && activation.some(item => item.connectionId !== connection.id && item.state === 'active') && <MemoryImportSelection connection={connection} disabled={busy} migration review={async ids => {
        let accepted = false, failed = false
        await act(async () => {
          try { const lease = await window.electronAPI.context.lease(); const preview = await window.electronAPI.context.previewMemoryMigration(connection.id, ids, lease.id); accepted = await window.electronAPI.context.activateProvider(preview.ref) }
          catch (error) { failed = true; throw error }
        })
        if (failed) throw new Error('Refresh the current selection and retry the migration.')
        return accepted
      }} />}
      {activation.find(item => item.connectionId === connection.id)?.state === 'active' && <MemoryImportSelection connection={connection} disabled={busy} review={async ids => {
        let accepted = false, failed = false
        await act(async () => {
          try {
            const lease = await window.electronAPI.context.lease()
            const preview = await window.electronAPI.context.previewMemoryImport(connection.id, ids, lease.id)
            accepted = await window.electronAPI.context.activateProvider(preview.ref)
          } catch (error) { failed = true; throw error }
        })
        if (failed) throw new Error('Refresh the current selection and retry the import.')
        return accepted
      }} />}
      <details className="text-geo-muted"><summary>Declared processing destinations</summary>{connection.destinations.map(item => <p key={item.purpose} className="break-words">{item.purpose}: {item.destination}</p>)}</details>
      {connection.state !== 'disconnected' && <>
        {connection.location !== 'managed-local' && <button className="text-geo-accent mr-2" disabled={busy} onClick={() => void act(() => window.electronAPI.context.probeConnection(connection.id))}>Test connection</button>}
        <button className="text-geo-accent" onClick={() => void act(async () => { await window.electronAPI.context.disconnectConnection(connection.id); useContextStore.getState().revokeDelivery() })}>Disconnect</button>
      </>}
      {connection.state === 'disconnected' && <>
        <p className="text-geo-muted">Authentication removed. Disconnecting does not delete copies held by a remote service.</p>
        <button className="text-geo-accent" disabled={busy} onClick={() => void act(() => window.electronAPI.context.removeConnection(connection.id))}>Remove these settings</button>
      </>}
    </div>)}
    <form className="space-y-2 mt-3" onSubmit={event => {
      event.preventDefault()
      const epoch = useProjectStore.getState().workspaceEpoch
      void act(async () => {
        const lease = await window.electronAPI.context.lease()
        if (useProjectStore.getState().workspaceEpoch !== epoch) throw new Error('SCOPE_CHANGED')
        await window.electronAPI.context.saveConnection({ adapter, label, endpoint, location, scope, namespace: namespace || undefined, token: token || undefined,
          destinations: destinations.map(item => item.purpose === 'storage' && item.destination === 'unknown' ? { ...item, destination: endpoint } : item) }, lease.id)
      })
    }}>
      <label className="flex justify-between">Provider<select aria-label="Memory connection provider" value={adapter} onChange={event => setAdapter(event.target.value as MemoryAdapter)} className="bg-geo-bg border border-geo-border rounded"><option value="hindsight">Hindsight</option><option value="mnemosyne">Mnemosyne</option></select></label>
      <label className="block">Connection label<input aria-label="Memory connection label" value={label} required maxLength={80} onChange={event => setLabel(event.target.value)} className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>
      <label className="block">Endpoint<input aria-label="Memory connection endpoint" type="url" value={endpoint} required maxLength={2048} onChange={event => setEndpoint(event.target.value)} placeholder="https://your-memory-server.example" className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>
      <label className="flex justify-between">Location<select aria-label="Memory connection location" value={location} onChange={event => setLocation(event.target.value as typeof location)} className="bg-geo-bg border border-geo-border rounded"><option value="server">Your server or hosted service · HTTPS</option><option value="loopback">Loopback local server</option></select></label>
      <label className="flex justify-between">Scope<select aria-label="Memory connection scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)} className="bg-geo-bg border border-geo-border rounded"><option value="global">About you</option><option value="project" disabled={!projectId}>This saved project</option></select></label>
      <label className="block">Authentication token<input aria-label="Memory connection authentication" type="password" autoComplete="off" value={token} maxLength={4096} onChange={event => setToken(event.target.value)} className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>
      <details className="text-geo-muted"><summary>Namespace and processing destinations</summary>
        <p>A dedicated namespace is generated unless you select an existing bank for this scope. Shared default banks are refused. Processing destinations remain declarations until verified.</p>
        <label className="block">Existing bank or namespace<input aria-label="Memory connection namespace" value={namespace} maxLength={64} onChange={event => setNamespace(event.target.value)} className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>
        {destinations.map(item => <label key={item.purpose} className="block">{item.purpose}<input aria-label={`Memory ${item.purpose} destination`} value={item.destination} maxLength={2048} onChange={event => setDestinations(destinations => destinations.map(existing => existing.purpose === item.purpose ? { ...existing, destination: event.target.value } : existing))} className="w-full bg-geo-bg border border-geo-border rounded p-1" /></label>)}
        <p>Enter a destination address, “disabled” or “unknown”. No paid background operation is enabled by this form.</p>
      </details>
      <button type="submit" disabled={busy || !ready || !personalMemoryAvailable} className="text-geo-accent disabled:opacity-50">Save connection settings</button>
    </form>
    {error && <p role="status" className="text-geo-error mt-1">{error}</p>}
  </details>
}
