import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/ai-preferences-persistence', () => ({ loadAiPreferences: vi.fn(), saveAiPreferences: vi.fn() }))
vi.mock('@/lib/persistence', () => ({ createJsonFileStore: () => ({ read: async () => ({}), write: async () => {} }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
async function setup(columnPolicies: () => Promise<unknown>) {
  vi.stubGlobal('window', { electronAPI: { context: { lease: async () => ({ id: 'lease', projectId: 'project' }), exclusions: async () => [], columnPolicies, folderCatalogue: async () => ({ folders: [], documents: [] }) } } })
  const { useContextStore } = await import('@/store/context')
  const { useProjectStore } = await import('@/store/project')
  useProjectStore.setState({ projectId: 'project', path: '/test.ourgeoproj', workspaceEpoch: 1 })
  return useContextStore
}
it('lets the latest project privacy load finish without an empty error from an older load', async () => {
  const complete: ((value: unknown) => void)[] = []
  const read = vi.fn(() => new Promise(resolve => complete.push(resolve)))
  const store = await setup(read)
  const older = store.getState().refreshExclusions()
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  const newer = store.getState().refreshExclusions()
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  complete[0]({ revision: 0, selections: {} }); await older
  expect(store.getState().error).toBeNull()
  expect(store.getState().exclusionsLoaded).toBe(false)
  complete[1]({ revision: 0, selections: {} }); await newer
  expect(store.getState().exclusionsLoaded).toBe(true)
  expect(store.getState().error).toBeNull()
})
it('keeps failed policies closed and clears the privacy warning after a successful retry', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('keyring locked')).mockResolvedValue({ revision: 0, selections: {} })
  const store = await setup(read)
  await store.getState().refreshExclusions()
  expect(store.getState().exclusionsLoaded).toBe(false)
  expect(store.getState().error).toContain('keyring locked')
  await store.getState().refreshExclusions()
  expect(store.getState().exclusionsLoaded).toBe(true)
  expect(store.getState().error).toBeNull()
})
