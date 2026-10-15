import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { MemoryConnection, PublicMemoryConnection } from '../../../../src/lib/context/providers/connections'
import { publicConnection } from '../../../../src/lib/context/providers/connections'
import type { WorkspaceLease } from '../scope'
import { subscribeContextScope } from '../scope'
import { prepareConnection } from './connection-policy'
import { createJsonTransport } from './transport'
import { createHindsightProvider } from './hindsight'
import { createMnemosyneProvider, createMnemosyneMcpCall } from './mnemosyne'
import { createLocalServerMnemosyne } from './local-server-mnemosyne'

type Dispatch = (operation: string, value?: unknown, guard?: () => void) => Promise<unknown>
export class MemoryConnections {
  private active = new Map<string, AbortController>()
  private revoked = new Map<string, number>()
  constructor(private dispatch: Dispatch, private lease: () => WorkspaceLease, private fetcher: typeof fetch = fetch) {}
  private guard(snapshot: WorkspaceLease): () => void {
    return () => { if (this.lease().id !== snapshot.id) throw new Error('SCOPE_CHANGED: review connection setup in the active workspace.') }
  }
  private async records(snapshot: WorkspaceLease): Promise<MemoryConnection[]> {
    const guard = this.guard(snapshot)
    guard()
    const records = await this.dispatch('connections', undefined, guard) as MemoryConnection[]
    guard()
    return records.filter(connection => connection.scope === 'global' || connection.scope === `project:${snapshot.projectId}`)
  }
  async list(): Promise<PublicMemoryConnection[]> { return (await this.records({ ...this.lease() })).map(publicConnection) }
  async save(input: unknown, suppliedLease: unknown): Promise<PublicMemoryConnection> {
    const snapshot = { ...this.lease() }, guard = this.guard(snapshot)
    if (suppliedLease !== snapshot.id) throw new Error('SCOPE_CHANGED: refresh connection settings.')
    const value = prepareConnection(input, snapshot.projectId)
    await this.dispatch('saveConnection', value, guard)
    guard()
    return publicConnection(value.connection)
  }
  async probe(id: string): Promise<PublicMemoryConnection> {
    if (this.active.has(id)) throw new Error('A connection test is already running. Wait or disconnect to cancel it.')
    const generation = this.revoked.get(id) ?? 0
    const snapshot = { ...this.lease() }, guard = this.guard(snapshot)
    const connection = (await this.records(snapshot)).find(connection => connection.id === id && connection.state !== 'disconnected')
    if (!connection) throw new Error('Choose a connection in the current scope.')
    if (this.active.has(id) || (this.revoked.get(id) ?? 0) !== generation) throw new Error('The connection changed. Refresh its settings before testing it.')
    const abort = new AbortController()
    this.active.set(id, abort)
    try {
      const token = connection.credentialRef ? await this.dispatch('connectionCredential', connection.credentialRef, guard) as string | undefined : undefined
      guard()
      if (connection.credentialRef && !token) throw new Error('Credentials are unavailable. Disconnect and create a new connection.')
      const request = createJsonTransport({ endpoint: connection.endpoint, local: connection.location === 'loopback', token }, this.fetcher)
      const provider = connection.localServer ? createLocalServerMnemosyne(id, request) : connection.adapter === 'hindsight' ? createHindsightProvider(id, request) : createMnemosyneProvider(id, createMnemosyneMcpCall(request))
      const result = await provider.dispatch({ operation: 'probe' }, { namespace: connection.namespaceRef, signal: abort.signal, timeoutMs: 5000, policyRevision: connection.revision,
        maxResults: 1, maxTokens: 256, idempotencyKey: randomUUID(), paidProcessingAllowed: false,
        authorised: () => !abort.signal.aborted && this.lease().id === snapshot.id })
      guard()
      abort.signal.throwIfAborted()
      const updated: MemoryConnection = { ...connection, revision: connection.revision + 1, state: result.status === 'ok' ? 'reachable' : 'failed', checkedAt: new Date().toISOString() }
      await this.dispatch('saveConnection', { connection: updated }, guard)
      guard()
      return publicConnection(updated)
    } finally { if (this.active.get(id) === abort) this.active.delete(id) }
  }
  async disconnect(id: string): Promise<void> {
    // Revoke the in-flight test before waiting for storage; its late health
    // response can never re-enable this connection.
    this.revoked.set(id, (this.revoked.get(id) ?? 0) + 1)
    this.active.get(id)?.abort()
    const snapshot = { ...this.lease() }, guard = this.guard(snapshot)
    const connection = (await this.records(snapshot)).find(connection => connection.id === id)
    if (!connection) throw new Error('Choose a connection in the current scope.')
    if (connection.state === 'disconnected') return
    await this.dispatch('saveConnection', { connection: { ...connection, revision: connection.revision + 1, state: 'disconnected' } }, guard)
    guard()
  }
  async remove(id: string): Promise<void> {
    const snapshot = { ...this.lease() }, guard = this.guard(snapshot)
    const connection = (await this.records(snapshot)).find(connection => connection.id === id)
    if (!connection || connection.state !== 'disconnected') throw new Error('Disconnect before removing these settings.')
    await this.dispatch('removeConnection', id, guard)
    guard()
  }
  cancel(): void { for (const abort of this.active.values()) abort.abort(); this.active.clear() }
}

export function registerMemoryConnectionHandlers(ipc: IpcMain, authorised: (event: IpcMainInvokeEvent) => void, dispatch: Dispatch, lease: () => WorkspaceLease): void {
  const connections = new MemoryConnections(dispatch, lease)
  subscribeContextScope(() => connections.cancel())
  const id = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) throw new Error('Choose a saved connection.')
    return value
  }
  ipc.handle('context:connections', event => { authorised(event); return connections.list() })
  ipc.handle('context:saveConnection', (event, input, suppliedLease) => { authorised(event); return connections.save(input, suppliedLease) })
  ipc.handle('context:probeConnection', (event, value) => { authorised(event); return connections.probe(id(value)) })
  ipc.handle('context:disconnectConnection', (event, value) => { authorised(event); return connections.disconnect(id(value)) })
  ipc.handle('context:removeConnection', (event, value) => { authorised(event); return connections.remove(id(value)) })
}
