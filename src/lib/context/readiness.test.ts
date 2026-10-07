import { afterEach, expect, it, vi } from 'vitest'
import type { MemoryRecord } from './types'

vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
vi.mock('@/lib/persistence', () => ({ createJsonFileStore: () => ({ read: async () => ({}), write: async () => {} }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function startup(listGlobal: () => Promise<MemoryRecord[]>, exclusions = async () => []) {
  vi.stubGlobal('window', { electronAPI: { context: {
    lease: async () => ({ id: 'lease', projectId: null }), exclusions,
    learningSettings: async () => ({ global: 'suggest', project: 'suggest', scratch: false }), listGlobal,
  } } })
  const { useContextStore: store } = await import('@/store/context')
  const { useProjectStore } = await import('@/store/project')
  useProjectStore.setState({ projectId: null })
  return store
}

it('waits for pinned local memory and shares startup without an R inspection', async () => {
  let complete!: (memories: MemoryRecord[]) => void
  const list = vi.fn(() => new Promise<MemoryRecord[]>(resolve => { complete = resolve }))
  const store = await startup(list)
  const loading = store.getState().init()
  await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
  const pending = store.getState().waitForReady()
  expect(store.getState().ready).toBe(false)
  complete([])
  await Promise.all([loading, pending, store.getState().init()])
  expect(list).toHaveBeenCalledOnce()
  expect(store.getState().personalMemoryAvailable).toBe(true)
})

it('cancels a send waiting for storage without cancelling shared startup', async () => {
  let complete!: (memories: MemoryRecord[]) => void
  const store = await startup(() => new Promise(resolve => { complete = resolve }))
  const loading = store.getState().init()
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  const abort = new AbortController()
  const pending = store.getState().waitForReady(abort.signal)
  abort.abort()
  await expect(pending).rejects.toThrow('cancelled')
  complete([])
  await loading
  expect(store.getState().ready).toBe(true)
})

it('does not restore a deleted snapshot when initial memory loading finishes late', async () => {
  let complete!: (memories: MemoryRecord[]) => void
  const store = await startup(() => new Promise(resolve => { complete = resolve }))
  const loading = store.getState().init()
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  const newer: MemoryRecord[] = []
  store.setState({ globals: newer })
  complete([{ id: 'old' } as MemoryRecord])
  await loading
  expect(store.getState().globals).toBe(newer)
})

it('keeps unreadable privacy policy closed and reports unavailable personal instructions', async () => {
  const store = await startup(async () => { throw new Error('keyring locked') }, async () => { throw new Error('keyring locked') })
  await store.getState().init()
  await store.getState().waitForReady()
  expect(store.getState().ready).toBe(true)
  expect(store.getState().personalMemoryAvailable).toBe(false)
  expect(store.getState().exclusionsLoaded).toBe(false)
  expect(store.getState().error).toContain('pinned personal instructions unavailable')
})
