import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MemoryStorage } from '../storage'
import { MemoryConnections } from './connections'
import { prepareConnection } from './connection-policy'
import { publicConnection, type MemoryConnectionInput } from '../../../../src/lib/context/providers/connections'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const input = (): MemoryConnectionInput => ({ adapter: 'hindsight', label: 'Synthetic private server', endpoint: 'https://memory.example.invalid', location: 'server', scope: 'global', token: 'SYNTHETIC_PRIVATE_CREDENTIAL',
  destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'https://memory.example.invalid' : 'unknown' })) })

it('resolves scope and secrets in the host rather than trusting supplied identities', () => {
  const projectId = crypto.randomUUID()
  const first = prepareConnection({ ...input(), scope: 'project', id: 'untrusted', credentialRef: 'untrusted', scopeId: 'foreign' }, projectId)
  expect(first.connection.scope).toBe(`project:${projectId}`)
  expect(first.connection.id).not.toBe('untrusted')
  expect(first.connection.credentialRef).not.toBe('untrusted')
  expect(publicConnection(first.connection)).not.toHaveProperty('credentialRef')
  expect(publicConnection(first.connection)).not.toHaveProperty('namespaceRef')
  expect(() => prepareConnection({ ...input(), scope: 'project' }, null)).toThrow('Save the workspace')
  expect(() => prepareConnection({ ...input(), endpoint: 'http://192.168.1.2', location: 'loopback' }, null)).toThrow('HTTPS')
  expect(() => prepareConnection({ ...input(), namespace: 'default' }, null)).toThrow('shared default')
  expect(() => prepareConnection({ ...input(), destinations: [] }, null)).toThrow('Declare each')
})

it('encrypts connection endpoints, credentials and namespaces and removes authentication on disconnect', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-connection-test-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32)
  const store = new MemoryStorage(path, Buffer.from(key)), { connection, token } = prepareConnection(input(), null)
  store.saveConnection(connection, token)
  expect(store.credential(connection.credentialRef!)).toBe(token)
  for (const file of readdirSync(directory)) for (const privateValue of [token!, connection.endpoint, connection.namespaceRef]) expect(readFileSync(join(directory, file)).includes(Buffer.from(privateValue))).toBe(false)
  store.close()
  const recovered = new MemoryStorage(path, Buffer.from(key))
  expect(recovered.connection(connection.id)).toEqual(connection)
  recovered.saveConnection({ ...connection, revision: 2, state: 'disconnected' })
  expect(recovered.credential(connection.credentialRef!)).toBeUndefined()
  expect(publicConnection(recovered.connection(connection.id)!)).toMatchObject({ authenticated: false })
  recovered.close()
})
it('rotates owned local-server credentials atomically without allowing public credential replacement', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32))
  try {
    const initial = prepareConnection({ ...input(), adapter: 'mnemosyne', endpoint: 'http://127.0.0.1:19001', location: 'loopback', destinations: input().destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? 'http://127.0.0.1:19001' : 'disabled' })) }, null)
    const connection = { ...initial.connection, localServer: true as const, state: 'reachable' as const, runtimeId: 'mnemosyne-lexical-v1' }
    store.saveConnection(connection, initial.token)
    const endpoint = 'http://127.0.0.1:19002'
    const renewed = { ...connection, revision: 2, endpoint, destinations: connection.destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? endpoint : 'disabled' })) }
    const token = randomBytes(32).toString('base64url')
    expect(() => store.saveConnection(renewed, token)).toThrow('new connection')
    expect(() => store.renewLocalServer({ ...renewed, endpoint: 'https://external.example.invalid' }, token)).toThrow('owned local-server')
    expect(store.credential(connection.credentialRef!)).toBe(initial.token)
    expect(store.connection(connection.id)).toEqual(connection)
    store.renewLocalServer(renewed, token)
    expect(store.credential(connection.credentialRef!)).toBe(token)
    expect(store.connection(connection.id)).toEqual(renewed)
    expect(() => store.renewLocalServer(renewed, randomBytes(32).toString('base64url'))).toThrow('changed')
    expect(store.credential(connection.credentialRef!)).toBe(token)
  } finally { store.close() }
})
it('restricts Hindsight credential renewal to a paused native deployment in the same private folder', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32))
  try {
    const endpoint = 'http://127.0.0.1:19111'
    const prepared = prepareConnection({ ...input(), endpoint, location: 'loopback', destinations: input().destinations.map(item => ({ ...item, destination: ['storage', 'embeddings', 'reranking'].includes(item.purpose) ? endpoint : 'disabled' })) }, null)
    const initial = { ...prepared.connection, namespaceRef: crypto.randomUUID(), state: 'reachable' as const, localProfile: 'hindsight-local-chunks-v1' as const, profileDirectory: '/private/deployment' }
    store.saveConnection(initial, prepared.token)
    const renewal = { ...initial, revision: 2 }, token = initial.namespaceRef + '.' + 'a'.repeat(64)
    expect(() => store.saveConnection(renewal, token)).toThrow('new connection')
    expect(() => store.renewHindsightServer({ ...renewal, endpoint: 'https://foreign.invalid' }, token)).toThrow('Pause the reviewed Hindsight')
    expect(() => store.renewHindsightServer({ ...renewal, profileDirectory: '/another/deployment' }, token)).toThrow('Pause the reviewed Hindsight')
    expect(store.credential(initial.credentialRef!)).toBe(prepared.token)
    store.renewHindsightServer(renewal, token)
    expect(store.credential(initial.credentialRef!)).toBe(token)
    expect(publicConnection(renewal)).not.toHaveProperty('profileDirectory')
    const binding = { id: crypto.randomUUID(), scope: initial.scope, adapter: initial.adapter, adapterVersion: 'synthetic-pin', namespaceRef: initial.namespaceRef, connectionRef: initial.id, enabled: true, writesCertified: true, policyRevision: 1 }
    store.configureBinding(binding)
    expect(() => store.renewHindsightServer({ ...renewal, revision: 3 }, token)).toThrow('Pause the reviewed Hindsight')
    expect(store.connection(initial.id)?.revision).toBe(2)
  } finally { store.close() }
})
it('negotiates MCP before testing the owned local-server snapshot tool', async () => {
  const prepared = prepareConnection({ ...input(), adapter: 'mnemosyne', location: 'loopback', endpoint: 'http://127.0.0.1:19001/mcp', destinations: input().destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? 'http://127.0.0.1:19001/mcp' : 'disabled' })) }, null)
  let connection = { ...prepared.connection, localServer: true as const, namespaceRef: crypto.randomUUID() }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize' ? { protocolVersion: '2025-11-25' } : { content: [{ type: 'text', text: JSON.stringify({ generation: 0, evidence: [], complete: true }) }] } }))
  })
  const controller = new MemoryConnections(async (operation, value) => {
    if (operation === 'connections') return [connection]
    if (operation === 'connectionCredential') return prepared.token
    if (operation === 'saveConnection') { connection = (value as { connection: typeof connection }).connection; return }
    throw new Error(operation)
  }, () => ({ id: 'synthetic-lease', projectId: null }), fetcher)
  const result = await controller.probe(connection.id)
  expect(result.state).toBe('reachable')
  expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:19001/mcp')
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ method: 'initialize' })
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ method: 'tools/call', params: { name: 'ourgeo_mnemosyne_snapshot', arguments: { operation: 'probe', namespace: connection.namespaceRef, bank: connection.namespaceRef } } })
})

it('migrates a previous database without losing records and only removes disconnected settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-connection-migration-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32)
  const original = new MemoryStorage(path, Buffer.from(key)), { connection, token } = prepareConnection(input(), null)
  original.saveConnection(connection, token)
  original.close()
  const previous = new DatabaseSync(path)
  previous.exec('PRAGMA user_version=8;')
  previous.close()
  const migrated = new MemoryStorage(path, Buffer.from(key))
  try {
    expect(migrated.connection(connection.id)).toEqual(connection)
    expect(migrated.credential(connection.credentialRef!)).toBe(token)
    expect(() => migrated.removeConnection(connection.id)).toThrow('Disconnect')
    migrated.saveConnection({ ...connection, revision: 2, state: 'disconnected' })
    migrated.removeConnection(connection.id)
    expect(migrated.connections()).toEqual([])
    expect(migrated.credential(connection.credentialRef!)).toBeUndefined()
  } finally { migrated.close() }
})

it('never reuses a disconnected or removed remote namespace for a different project', () => {
  const store = new MemoryStorage(':memory:', randomBytes(32))
  try {
    const { connection, token } = prepareConnection({ ...input(), namespace: 'private_scope_bank' }, null)
    store.saveConnection(connection, token)
    const projectId = crypto.randomUUID()
    const conflicting = prepareConnection({ ...input(), endpoint: `${input().endpoint}/`, namespace: 'private_scope_bank', scope: 'project' }, projectId)
    expect(() => store.saveConnection(conflicting.connection, conflicting.token)).toThrow('dedicated bank')
    store.saveConnection({ ...connection, revision: 2, state: 'disconnected' })
    store.removeConnection(connection.id)
    expect(() => store.saveConnection(conflicting.connection, conflicting.token)).toThrow('dedicated bank')
    expect(store.connections()).toEqual([])
  } finally { store.close() }
})

function service(fetcher: typeof fetch) {
  const store = new MemoryStorage(':memory:', randomBytes(32)), snapshot = { id: crypto.randomUUID(), projectId: null as string | null }
  const dispatch = vi.fn(async (operation: string, value?: unknown, guard?: () => void): Promise<unknown> => {
    guard?.()
    if (operation === 'connections') return store.connections()
    if (operation === 'connectionCredential') return store.credential(String(value))
    if (operation === 'removeConnection') { store.removeConnection(String(value)); return }
    if (operation === 'saveConnection') { const input = value as Parameters<typeof prepareConnection>[0] & { connection: Parameters<MemoryStorage['saveConnection']>[0]; token?: string }; store.saveConnection(input.connection, input.token); return }
    throw new Error('Unsupported fixture operation')
  })
  return { service: new MemoryConnections(dispatch, () => snapshot, fetcher), store, snapshot }
}

it('tests only reachability without sending memories, namespaces or enabling writes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"status":"ok"}'))
  const { service: manager, store, snapshot } = service(fetcher)
  try {
    const connection = await manager.save(input(), snapshot.id)
    const result = await manager.probe(connection.id)
    expect(result).toMatchObject({ state: 'reachable', certification: 'pending' })
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body')
    expect(store.claimJob()).toBeNull()
    await expect(manager.remove(connection.id)).rejects.toThrow('Disconnect')
    await manager.disconnect(connection.id)
    await manager.remove(connection.id)
    expect(await manager.list()).toEqual([])
  } finally { manager.cancel(); store.close() }
})

it('cancels a pending test before disconnecting and refuses a late success', async () => {
  let complete!: (response: Response) => void
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { complete = resolve }))
  const { service: manager, store, snapshot } = service(fetcher)
  try {
    const connection = await manager.save(input(), snapshot.id)
    const testing = manager.probe(connection.id)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    await manager.disconnect(connection.id)
    complete(new Response('{"status":"ok"}'))
    await expect(testing).rejects.toThrow()
    expect(store.connection(connection.id)?.state).toBe('disconnected')
    expect(store.credential(store.connection(connection.id)!.credentialRef!)).toBeUndefined()
  } finally { manager.cancel(); store.close() }
})

it('rejects a probe response after a workspace switch and hides other project settings', async () => {
  let complete!: (response: Response) => void
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { complete = resolve }))
  const { service: manager, store, snapshot } = service(fetcher)
  snapshot.projectId = crypto.randomUUID()
  try {
    const connection = await manager.save({ ...input(), scope: 'project' }, snapshot.id)
    const testing = manager.probe(connection.id)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    snapshot.id = crypto.randomUUID(); snapshot.projectId = crypto.randomUUID()
    complete(new Response('{"status":"ok"}'))
    await expect(testing).rejects.toThrow('SCOPE_CHANGED')
    expect(await manager.list()).toEqual([])
    expect(store.connection(connection.id)?.state).toBe('configured')
  } finally { manager.cancel(); store.close() }
})
