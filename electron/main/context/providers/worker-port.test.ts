import { afterEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { Worker } from 'node:worker_threads'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { MemoryStorage } from '../storage'
import { prepareConnection } from './connection-policy'
import { createProviderWorkerPort } from './worker-port'
import type { ProviderRoutingPort } from './routing'
import type { OutboxJob } from '../../../../src/lib/context/providers/outbox'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function fixture() {
  const state = { lease: { id: crypto.randomUUID(), projectId: crypto.randomUUID() as string | null } }
  const routing: Omit<ProviderRoutingPort, 'currentJob' | 'connection' | 'credential' | 'maintenancePolicy' | 'maintenance'> = {
    lease: () => ({ ...state.lease }), certificate: async () => undefined, authorised: () => false,
    provider: () => { throw new Error('No provider is certified in this fixture.') },
  }
  const dispatch = vi.fn<Parameters<typeof createProviderWorkerPort>[0]>(async (_operation, _value, guard) => { guard?.(); return null })
  return { state, dispatch, port: createProviderWorkerPort(dispatch, routing) }
}

it('narrows caller scopes before worker access and never searches another project', async () => {
  const { state, port, dispatch } = fixture()
  const allowed = `project:${state.lease.projectId}`, foreign = `project:${crypto.randomUUID()}`
  await port.claim([foreign], Date.now())
  await port.current('foreign-job', [foreign])
  expect(dispatch).not.toHaveBeenCalled()
  await port.claim([foreign, allowed, 'global'], 123)
  expect(dispatch).toHaveBeenCalledWith('claimOutbox', { scopes: [allowed, 'global'], now: 123 }, expect.any(Function))
  state.lease = { id: crypto.randomUUID(), projectId: null }
  expect(port.scopes()).toEqual(['global'])
})

it('rejects an old read reply after switching workspaces', async () => {
  const { state, port, dispatch } = fixture()
  dispatch.mockImplementation(async () => {
    state.lease = { id: crypto.randomUUID(), projectId: null }
    return { operation: { id: 'old-job' } }
  })
  await expect(port.current('old-job', ['global'])).rejects.toThrow('SCOPE_CHANGED')
  expect(dispatch).toHaveBeenCalledOnce()
})

it.each(['claim', 'claimPending'] as const)('repairs a late unsent %s without exposing its contents to a new workspace', async method => {
  const { state, port, dispatch } = fixture()
  dispatch.mockImplementation(async operation => {
    if (operation === 'completeOutbox') return undefined
    state.lease = { id: crypto.randomUUID(), projectId: null }
    return { operation: { id: 'unsent-job' } } as OutboxJob
  })
  await expect(port[method](['global'], 123)).rejects.toThrow('SCOPE_CHANGED')
  expect(dispatch).toHaveBeenLastCalledWith('completeOutbox', { id: 'unsent-job', receipt: { status: method === 'claimPending' ? 'pending' : 'retry' }, now: 123 })
})

it('checks the lease before a queued worker operation starts', async () => {
  const { state, port, dispatch } = fixture()
  dispatch.mockImplementation(async (_operation, _value, guard) => {
    state.lease = { id: crypto.randomUUID(), projectId: null }
    guard!()
    throw new Error('A stale guard must prevent worker access.')
  })
  await expect(port.claim(['global'], 123)).rejects.toThrow('SCOPE_CHANGED')
  expect(dispatch).toHaveBeenCalledOnce()
})

it('keeps foreign and disconnected credentials unavailable in the actual encrypted worker', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ourgeo-provider-worker-'))
  cleanups.push(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'canonical.db'), key = randomBytes(32), store = new MemoryStorage(path, Buffer.from(key))
  const projectId = crypto.randomUUID()
  const make = (scope: 'global' | 'project') => prepareConnection({ adapter: 'hindsight', label: 'Synthetic boundary fixture', endpoint: 'https://memory.example.invalid', location: 'server', scope, token: `synthetic-${scope}`,
    destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'https://memory.example.invalid/' : 'disabled' })) }, projectId)
  const global = make('global'), project = make('project')
  store.saveConnection(global.connection, global.token)
  store.saveConnection(project.connection, project.token)
  store.close()
  const script = join(folder, 'worker.cjs')
  await build({ entryPoints: ['electron/main/context/worker.ts'], outfile: script, bundle: true, platform: 'node', format: 'cjs' })
  const worker = new Worker(script, { workerData: { path, key } })
  cleanups.push(() => worker.terminate())
  let id = 0
  const request = (op: string, value: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const selected = ++id
    const timer = setTimeout(() => { cleanup(); reject(new Error('Worker fixture timed out.')) }, 5000)
    const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail) }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const receive = (reply: { id: number; result?: unknown; error?: string }) => {
      if (reply.id !== selected) return
      cleanup(); if (reply.error) reject(new Error(reply.error)); else resolve(reply.result)
    }
    worker.on('message', receive); worker.on('error', fail); worker.postMessage({ id: selected, op, value })
  })
  expect(await request('scopedConnection', { id: project.connection.id, scopes: ['global'] })).toBeUndefined()
  expect(await request('scopedCredential', { reference: project.connection.credentialRef, scopes: ['global'] })).toBeUndefined()
  expect(await request('scopedCredential', { reference: global.connection.credentialRef, scopes: ['global'] })).toBe('synthetic-global')
  expect(await request('scopedCredential', { reference: project.connection.credentialRef, scopes: [`project:${projectId}`] })).toBe('synthetic-project')
  await request('saveConnection', { connection: { ...project.connection, state: 'disconnected', revision: 2 } })
  expect(await request('scopedCredential', { reference: project.connection.credentialRef, scopes: [`project:${projectId}`] })).toBeUndefined()
})
