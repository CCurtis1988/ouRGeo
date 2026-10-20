import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let files: Map<string, string>
let write: ReturnType<typeof vi.fn>
let read: ReturnType<typeof vi.fn>
let forget: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  files = new Map()
  read = vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error('ENOENT')
    return files.get(path)!
  })
  write = vi.fn(async (path: string, value: string) => { files.set(path, value) })
  forget = vi.fn(async () => undefined)
  vi.stubGlobal('window', { electronAPI: { app: { getDataPath: async () => '/data' }, file: { read, write }, themeBackgrounds: { list: async () => [], forget } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const load = async () => (await import('./theme-backgrounds')).useThemeBackgroundStore
const path = '/data/theme-backgrounds.json'

it('keeps independently ordered theme selections and intervals across overlapping saves and reopening', async () => {
  const store = await load()
  await Promise.all([
    store.getState().setSelection('forest', ['folder:one:b', 'default', 'folder:one:b']),
    store.getState().setInterval('forest', 75),
    store.getState().setSelection('arctic', ['arctic:loop']),
  ])
  vi.resetModules()
  const reopened = await load()
  await reopened.getState().init()
  expect(reopened.getState().preferences).toEqual({ forest: { selectedIds: ['folder:one:b', 'default'], intervalSeconds: 75 }, arctic: { selectedIds: ['arctic:loop'], intervalSeconds: 30 } })
  expect(JSON.parse(files.get(path)!)).toEqual({ version: 1, preferences: reopened.getState().preferences })
  await reopened.getState().reset('forest')
  expect(reopened.getState().preferences.arctic.selectedIds).toEqual(['arctic:loop'])
  expect(reopened.getState().preferences.forest).toBeUndefined()
})

it('retains at least one image and forgets only the revoked folder’s choices without deleting files', async () => {
  const store = await load()
  await store.getState().toggleImage('forest', 'default')
  expect(store.getState().preferences.forest.selectedIds).toEqual(['default'])
  await store.getState().setSelection('forest', ['folder:one:missing', 'folder:two:kept'])
  await store.getState().setSelection('arctic', ['folder:one:other'])
  await store.getState().forgetFolder('one')
  expect(forget).toHaveBeenCalledWith('one')
  expect(store.getState().preferences.forest.selectedIds).toEqual(['folder:two:kept'])
  expect(store.getState().preferences.arctic.selectedIds).toEqual(['default'])
})

it('preserves saved choices when a write fails and exposes explicit recovery for damaged settings', async () => {
  const store = await load()
  await store.getState().setSelection('forest', ['forest:1'])
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  write.mockRejectedValue(new Error('ENOSPC'))
  await expect(store.getState().setSelection('forest', ['forest:2'])).rejects.toThrow(/could not be saved/)
  expect(store.getState().preferences.forest.selectedIds).toEqual(['forest:1'])
  expect(store.getState().error).toMatch(/could not be saved/)
  write.mockImplementation(async (path: string, value: string) => { files.set(path, value) })
  vi.resetModules()
  files.set(path, '{damaged')
  const damaged = await load()
  await expect(damaged.getState().init()).rejects.toThrow(/damaged/)
  expect(damaged.getState().initialized).toBe(false)
  await expect(damaged.getState().setInterval('forest', 5)).rejects.toThrow()
  expect(files.get(path)).toBe('{damaged')
  await damaged.getState().resetAll()
  expect(damaged.getState()).toMatchObject({ initialized: true, preferences: {}, error: null })
})

it('does not let a stale folder refresh resurrect a link forgotten while that refresh was pending', async () => {
  const store = await load()
  await store.getState().init()
  const folder = { id: 'one', themeId: 'forest', name: 'Photos', path: '/photos', status: 'ready' as const, images: [] }
  store.setState({ folders: [folder] })
  let release!: (folders: typeof folder[]) => void
  window.electronAPI.themeBackgrounds.list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue([])
  const refresh = store.getState().refreshFolders()
  await store.getState().forgetFolder('one')
  release([folder])
  await refresh
  expect(store.getState().folders).toEqual([])
  expect(window.electronAPI.themeBackgrounds.list).toHaveBeenCalledTimes(2)
})

it('previews immediately and preserves independent visibility endpoints, selections and old settings across reopening', async () => {
  files.set(path, JSON.stringify({ version: 1, preferences: { 'field-linen': { selectedIds: ['field-linen:2'], intervalSeconds: 75 } } }))
  const store = await load()
  await store.getState().init()
  expect(store.getState().preferences['field-linen'].imageStrength).toBeUndefined()
  store.getState().previewStrength('field-linen', 100)
  expect(store.getState().strengthPreview['field-linen']).toBe(100)
  expect(write).not.toHaveBeenCalled()
  await Promise.all([store.getState().setImageStrength('field-linen', 100), store.getState().setImageStrength('field-glacier', 0)])
  expect(store.getState().strengthPreview).toEqual({})
  vi.resetModules()
  const reopened = await load()
  await reopened.getState().init()
  expect(reopened.getState().preferences['field-linen']).toEqual({ selectedIds: ['field-linen:2'], intervalSeconds: 75, imageStrength: 100 })
  expect(reopened.getState().preferences['field-glacier'].imageStrength).toBe(0)
  await reopened.getState().reset('field-linen')
  expect(reopened.getState().preferences['field-linen'].imageStrength).toBe(100)
  await reopened.getState().setImageStrength('field-linen', null)
  expect(reopened.getState().preferences['field-linen'].imageStrength).toBeUndefined()
  expect(reopened.getState().preferences['field-glacier'].imageStrength).toBe(0)
})

it('rolls back a failed visibility save and does not erase a newer drag preview', async () => {
  const store = await load()
  await store.getState().setImageStrength('field-linen', 35)
  store.getState().previewStrength('field-linen', 80)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  write.mockRejectedValueOnce(new Error('ENOSPC'))
  await expect(store.getState().setImageStrength('field-linen', 80)).rejects.toThrow(/could not be saved/)
  expect(store.getState().strengthPreview).toEqual({})
  expect(store.getState().preferences['field-linen'].imageStrength).toBe(35)
  let release!: () => void
  write.mockImplementationOnce(async (path: string, value: string) => { await new Promise<void>(resolve => { release = resolve }); files.set(path, value) })
  store.getState().previewStrength('field-linen', 60)
  const saving = store.getState().setImageStrength('field-linen', 60)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  store.getState().previewStrength('field-linen', 90)
  release(); await saving
  expect(store.getState().strengthPreview['field-linen']).toBe(90)
  await store.getState().setImageStrength('field-linen', 90)
  expect(store.getState().strengthPreview).toEqual({})
})
