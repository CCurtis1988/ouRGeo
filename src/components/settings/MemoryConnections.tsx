import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import type { MemoryAdapter, ProcessingDestination, ProcessingPurpose, PublicMemoryConnection } from '@/lib/context/providers/connections'

const purposes: ProcessingPurpose[] = ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync']
export function MemoryConnections(): React.ReactElement {
  const projectId = useProjectStore(state => state.projectId)
  const workspaceEpoch = useProjectStore(state => state.workspaceEpoch)
  const ready = useContextStore(state => state.ready)
  const personalMemoryAvailable = useContextStore(state => state.personalMemoryAvailable)
  const [connections, setConnections] = useState<PublicMemoryConnection[]>([])
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
    setToken('')
    setError('')
    if (ready && personalMemoryAvailable) void window.electronAPI.context.connections().then(
      connections => { if (current && listing.current === request) setConnections(connections) },
      () => { if (current && listing.current === request) setError('Connection settings are unavailable. Restore protected storage and retry.') })
    return () => { current = false }
  }, [workspaceEpoch, ready, personalMemoryAvailable])
  useEffect(() => { if (!projectId) setScope('global') }, [projectId])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    const epoch = useProjectStore.getState().workspaceEpoch
    pending.current++
    setBusy(true); setError('')
    try {
      await action()
      if (useProjectStore.getState().workspaceEpoch === epoch) {
        const request = ++listing.current
        const connections = await window.electronAPI.context.connections()
        if (useProjectStore.getState().workspaceEpoch === epoch && listing.current === request) setConnections(connections)
      }
    } catch {
      if (useProjectStore.getState().workspaceEpoch === epoch) setError('The connection operation failed. Check its endpoint, authentication and protected storage, then retry.')
    } finally {
      setBusy(--pending.current > 0)
      if (useProjectStore.getState().workspaceEpoch === epoch) setToken('')
    }
  }
  return <details className="text-xs border border-geo-border rounded p-2" aria-label="Memory provider connections">
    <summary className="cursor-pointer">Mnemosyne and Hindsight connections</summary>
    <p className="text-geo-muted mt-2">The built-in manager remains active. These connections currently test reachability only; retrieval and ingestion remain disabled until certification. Testing sends no chat or memory content. A local server may use remote processing.</p>
    {!personalMemoryAvailable && <p className="text-geo-muted mt-1">Restore protected memory storage to save connections and authentication.</p>}
    {connections.map(connection => <div key={connection.id} className="border-t border-geo-border mt-2 pt-2">
      <p>{connection.label} · {connection.adapter} · {connection.location === 'loopback' ? 'Your server, loopback' : 'Your server or hosted service'} · {connection.scope === 'global' ? 'About you' : 'This project'}</p>
      <p className="text-geo-muted break-words">{connection.endpoint}</p>
      <p className="text-geo-muted">{connection.state} · certification pending · authentication {connection.authenticated ? 'stored in protected storage' : 'not stored'}</p>
      <details className="text-geo-muted"><summary>Declared processing destinations</summary>{connection.destinations.map(item => <p key={item.purpose} className="break-words">{item.purpose}: {item.destination}</p>)}</details>
      {connection.state !== 'disconnected' && <>
        <button className="text-geo-accent mr-2" disabled={busy} onClick={() => void act(() => window.electronAPI.context.probeConnection(connection.id))}>Test connection</button>
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
