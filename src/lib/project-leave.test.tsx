import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore, type TabState } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { useEnvironmentStore } from '@/store/environment'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore } from '@/store/plotting'
import { usePromptPreferences } from '@/store/prompt-preferences'

const asked = vi.hoisted(() => ({ answers: [] as { choice: string; checked: boolean }[], titles: [] as string[] }))
const mocks = vi.hoisted(() => ({ saveAs: vi.fn(), save: vi.fn(), flush: vi.fn(), checkpoint: vi.fn(), recently: vi.fn() }))
vi.mock('@/store/ask', () => ({ ask: vi.fn(async (req: { title: string }) => { asked.titles.push(req.title); return asked.answers.shift() ?? { choice: 'cancel', checked: false } }) }))
vi.mock('@/lib/project-persistence', () => ({ saveCurrentProject: mocks.save, saveProjectAs: mocks.saveAs, loadProjectFromPath: vi.fn(), newProject: vi.fn() }))
vi.mock('@/lib/project-draft', () => ({ flushDraft: mocks.flush, checkpointNow: mocks.checkpoint, envChangedSinceCheckpoint: () => true }))
vi.mock('@/store/recently-closed', () => ({ addRecentlyClosed: mocks.recently }))
vi.mock('@/lib/persistence', () => ({ createJsonFileStore: () => ({ read: async () => ({}), write: async () => {}, merge: async () => {} }) }))
import { leaveCurrentWorkspace, scratchLosses, describeLosses } from './project-leave'
import { useProjectSettingsStore } from '@/store/project-settings'

const write = vi.fn(async () => undefined)
const tab = (id: string, patch: Partial<TabState> = {}): TabState => ({ id, filePath: `/f/${id}.R`, fileName: `${id}.R`, content: 'edited', savedContent: 'disk', isDirty: true, type: 'code', ...patch })

beforeEach(() => {
  asked.answers = []; asked.titles = []
  Object.values(mocks).forEach(m => m.mockReset())
  mocks.flush.mockResolvedValue(undefined)
  write.mockReset(); write.mockResolvedValue(undefined)
  vi.stubGlobal('window', { electronAPI: { file: { write, read: vi.fn(async () => 'disk') }, dialog: { saveFile: vi.fn(async () => null) } } })
  usePromptPreferences.setState({ askScratchSave: true })
  useSpatialStore.setState({ layers: [] }); usePlottingStore.setState({ plots: [] })
  useEnvironmentStore.setState({ environments: [{ name: '.GlobalEnv', isSearchPath: false, objects: [{ name: 'x' } as never, { name: 'server' } as never] }], systemNames: ['server'], rdataLoadedNames: {} })
})

describe('leaving scratch (§2.3–§2.4)', () => {
  beforeEach(() => useProjectStore.setState({ path: null, isDirty: false }))

  it('counts what would be lost, leaving out ouRGeo\'s own objects', () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a'), tab('u', { filePath: null })], activeTabId: 'a', untitledCounter: 1 })
    expect(scratchLosses()).toMatchObject({ objects: 1, files: 1 })
    expect(describeLosses(scratchLosses())).toEqual(['1 R object', '1 open file'])
  })

  it('Cancel on prompt 1 leaves everything as it was (S2)', async () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a')], activeTabId: 'a', untitledCounter: 1 })
    asked.answers = [{ choice: 'cancel', checked: false }]
    expect(await leaveCurrentWorkspace('quit')).toBe(false)
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['a'])
  })

  it('Save as project skips prompt 2 (S3)', async () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a')], activeTabId: 'a', untitledCounter: 1 })
    mocks.saveAs.mockResolvedValue(true)
    asked.answers = [{ choice: 'save', checked: false }]
    expect(await leaveCurrentWorkspace('switch')).toBe(true)
    expect(asked.titles).toEqual(['Save scratch as a project?'])
    expect(write).not.toHaveBeenCalled()
  })

  it('Don\'t save, then prompt 2 per dirty file with Apply to all; files dropped to Recently closed (S4)', async () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a'), tab('b'), tab('c'), tab('u', { filePath: null, content: 'note', savedContent: '' })], activeTabId: 'a', untitledCounter: 1 })
    asked.answers = [{ choice: 'drop', checked: false }, { choice: 'apply', checked: false }, { choice: 'drop', checked: true }]
    expect(await leaveCurrentWorkspace('quit')).toBe(true)
    expect(asked.titles).toEqual(['Save scratch as a project?', 'Apply your edits to a.R?', 'Apply your edits to b.R?'])
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('/f/a.R', 'edited')
    expect(mocks.recently).toHaveBeenCalledWith(['/f/a.R', '/f/b.R', '/f/c.R'])
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['u'])
  })

  it('a write failure stops and names the file; Cancel keeps scratch as it was', async () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a')], activeTabId: 'a', untitledCounter: 1 })
    write.mockRejectedValue(new Error('EACCES: permission denied'))
    asked.answers = [{ choice: 'drop', checked: false }, { choice: 'apply', checked: false }, { choice: 'cancel', checked: false }]
    expect(await leaveCurrentWorkspace('quit')).toBe(false)
    expect(asked.titles[2]).toBe('Could not write a.R')
    expect(useEditorStore.getState().tabs.map(t => t.id)).toEqual(['a'])
  })

  it('only untitled documents: no prompt at all (S1)', async () => {
    useEnvironmentStore.setState({ environments: [] })
    useEditorStore.getState().loadFromSession({ tabs: [tab('u', { filePath: null, content: 'note', savedContent: '' })], activeTabId: 'u', untitledCounter: 1 })
    expect(await leaveCurrentWorkspace('quit')).toBe(true)
    expect(asked.titles).toEqual([])
  })

  it('"Don\'t ask again" silences prompt 1 and behaves as Don\'t save (S5)', async () => {
    useEditorStore.getState().loadFromSession({ tabs: [tab('a', { isDirty: false })], activeTabId: 'a', untitledCounter: 1 })
    asked.answers = [{ choice: 'drop', checked: true }]
    await leaveCurrentWorkspace('quit')
    expect(usePromptPreferences.getState().askScratchSave).toBe(false)
    useEditorStore.getState().loadFromSession({ tabs: [tab('b', { isDirty: false })], activeTabId: 'b', untitledCounter: 1 })
    asked.titles = []
    expect(await leaveCurrentWorkspace('quit')).toBe(true)
    expect(asked.titles).toEqual([])
  })
})

describe('leaving a named project (§1.3)', () => {
  beforeEach(() => useProjectStore.setState({ path: '/p/work.ourgeoproj', name: 'work', isDirty: true }))
  it('keeps changes on this computer by default, without asking', async () => {
    useProjectSettingsStore.setState({ closeBehavior: 'keep', loaded: true })
    expect(await leaveCurrentWorkspace('quit')).toBe(true)
    expect(asked.titles).toEqual([])
    expect(mocks.checkpoint).toHaveBeenCalledWith({ sync: true })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('saves automatically when set to', async () => {
    useProjectSettingsStore.setState({ closeBehavior: 'save', loaded: true })
    mocks.save.mockResolvedValue(true)
    expect(await leaveCurrentWorkspace('switch')).toBe(true)
    expect(mocks.save).toHaveBeenCalled()
  })
  it('asks when set to, and Don\'t Save keeps the draft', async () => {
    useProjectSettingsStore.setState({ closeBehavior: 'ask', loaded: true })
    asked.answers = [{ choice: 'keep', checked: false }]
    expect(await leaveCurrentWorkspace('quit')).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.flush).toHaveBeenCalled()
  })
})
