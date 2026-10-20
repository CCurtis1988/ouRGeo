import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let files: Map<string, string>
let read: ReturnType<typeof vi.fn>
let write: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetModules()
  files = new Map()
  read = vi.fn(async (path: string) => {
    const contents = files.get(path)
    if (contents === undefined) throw new Error('ENOENT')
    return contents
  })
  write = vi.fn(async (path: string, contents: string) => { files.set(path, contents) })
  vi.stubGlobal('window', { electronAPI: { app: { getDataPath: async () => '/data' }, file: { read, write } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const load = async () => (await import('./ai-task-models')).useAiTaskModelsStore
const path = '/data/ai-task-models.json'

it('uses assistant defaults only for a missing config and coalesces overlapping initialisation', async () => {
  const store = await load()
  await Promise.all([store.getState().init(), store.getState().init()])
  expect(read).toHaveBeenCalledTimes(1)
  expect(store.getState()).toMatchObject({ initialized: true, selections: { document: null, image: null }, analyseOnImport: false })
  expect(write).not.toHaveBeenCalled()
})

it('persists both independently selected routes and opt-in across a fresh store without credentials', async () => {
  const store = await load()
  await Promise.all([
    store.getState().setSelection('document', { provider: 'openai', model: 'custom-document' }),
    store.getState().setSelection('image', { provider: 'ollama', model: 'vision' }),
    store.getState().setAnalyseOnImport(true),
  ])
  vi.resetModules()
  const reopened = await load()
  await reopened.getState().init()
  expect(reopened.getState()).toMatchObject({ selections: { document: { provider: 'openai', model: 'custom-document' }, image: { provider: 'ollama', model: 'vision' } }, analyseOnImport: true })
  expect(Object.keys(JSON.parse(files.get(path)!))).toEqual(['version', 'selections', 'analyseOnImport'])
})

it('refuses malformed persisted destinations and permission errors with an explicit reset path', async () => {
  files.set(path, JSON.stringify({ version: 1, selections: { document: { provider: 'missing-provider', model: 'do-not-inherit' }, image: null } }))
  const store = await load()
  await expect(store.getState().init()).rejects.toThrow(/invalid/)
  expect(store.getState().initialized).toBe(false)
  await expect(store.getState().setAnalyseOnImport(true)).rejects.toThrow()
  expect(write).not.toHaveBeenCalled()
  await store.getState().resetSelections()
  expect(store.getState()).toMatchObject({ initialized: true, error: null, analyseOnImport: false })
  vi.resetModules()
  read.mockRejectedValue(new Error('EACCES'))
  const unreadable = await load()
  await expect(unreadable.getState().init()).rejects.toThrow(/Cannot read/)
  expect(unreadable.getState().initialized).toBe(false)
})

it('keeps the previous route and exposes failed writes, including a failed default reset', async () => {
  const store = await load()
  await store.getState().init()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  write.mockRejectedValue(new Error('ENOSPC'))
  await expect(store.getState().setSelection('document', { provider: 'openai', model: 'analysis' })).rejects.toThrow()
  expect(store.getState().selections.document).toBeNull()
  expect(store.getState().error).toBeTruthy()
  await expect(store.getState().resetSelections()).rejects.toThrow()
})

it('does not lose a selection made while the initial read is pending', async () => {
  let release!: (value: string) => void
  read.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
  const store = await load()
  const init = store.getState().init()
  const change = store.getState().setSelection('document', { provider: 'ollama', model: 'new-model' })
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  release(JSON.stringify({ version: 1, selections: { document: null, image: { provider: 'ollama', model: 'old-image' } }, analyseOnImport: false }))
  await Promise.all([init, change])
  expect(store.getState().selections).toEqual({ document: { provider: 'ollama', model: 'new-model' }, image: { provider: 'ollama', model: 'old-image' } })
})
