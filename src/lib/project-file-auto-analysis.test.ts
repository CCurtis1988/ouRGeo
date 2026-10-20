import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiStore } from '@/store/ai'
import { useAiTaskModelsStore } from '@/store/ai-task-models'
import { useProjectFilesStore } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { startProjectFileAutoAnalysis, useFileAnalysisJobs } from './project-file-auto-analysis'
import { requestProjectFileAnalysis } from './project-file-analysis-events'
import type { FileAnalysisOptions } from './file-analysis'
import type { ProjectFileAnalysisInput, ProjectFileEntry } from './project-files'

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), preview: vi.fn(), setAnalysis: vi.fn(), refresh: vi.fn(), log: vi.fn(), columns: false }))
vi.mock('./file-analysis', () => ({ runFileAnalysis: mocks.run }))
vi.mock('@/store/ai', async () => { const { create } = await import('zustand'); return { useAiStore: create(() => ({ provider: 'ollama', modelByProvider: { ollama: 'assistant-model' }, currentModel: () => 'assistant-model', init: async () => undefined })) } })
vi.mock('@/store/ai-task-models', async () => { const { create } = await import('zustand'); return { useAiTaskModelsStore: create(() => ({ initialized: true, selections: { document: null, image: null }, analyseOnImport: false, revision: 1, init: async () => undefined })) } })
vi.mock('@/store/project-files', async () => { const { create } = await import('zustand'); return { useProjectFilesStore: create(() => ({ catalogue: { projectId: 'project', revision: 0, savedRevision: 0, files: [] }, refresh: mocks.refresh })) } })
vi.mock('@/store/project', async () => { const { create } = await import('zustand'); return { useProjectStore: create(() => ({ projectId: 'project', workspaceEpoch: 1, phase: 'ready' })) } })
vi.mock('@/store/context', async () => { const { create } = await import('zustand'); return { useContextStore: create(() => ({ policyRevision: 1, exclusionsLoaded: true, excluded: [], waitForReady: async () => undefined })) } })
vi.mock('@/store/session', () => ({ useSessionStore: { getState: () => ({ addConsoleEntry: mocks.log }) } }))
vi.mock('@/store/column-disclosure', () => ({ hasColumnExclusions: () => mocks.columns }))

const file = (id = 'file'): ProjectFileEntry => ({ id, name: `${id}.md`, originalName: `${id}.md`, folder: '', role: 'reference', userDescription: 'User-written purpose', generatedDescription: 'Local parser description', sha256: 'a'.repeat(64), bytes: 50, mediaType: 'text/markdown', revision: 'original:1', importedAt: '', updatedAt: '', status: 'searchable', coverage: 'All source lines', saved: false })
function files(...entries: ProjectFileEntry[]): void { useProjectFilesStore.setState(state => ({ catalogue: { ...state.catalogue, revision: state.catalogue.revision + 1, files: entries } })) }
function request(ids = ['file']): void { requestProjectFileAnalysis({ projectId: 'project', workspaceEpoch: 1, ids }) }
async function flush(): Promise<void> { for (let index = 0; index < 25; index++) await Promise.resolve() }
async function settled(): Promise<void> { await vi.waitFor(() => expect(useFileAnalysisJobs.getState().running).toBeNull()); await flush() }
let stop: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks(); mocks.columns = false
  useAiStore.setState({ provider: 'ollama', modelByProvider: { ollama: 'assistant-model' }, currentModel: () => useAiStore.getState().modelByProvider[useAiStore.getState().provider]! })
  useAiTaskModelsStore.setState({ initialized: true, analyseOnImport: false, selections: { document: null, image: null }, revision: 1 })
  useProjectStore.setState({ projectId: 'project', workspaceEpoch: 1, phase: 'ready' })
  useContextStore.setState({ policyRevision: 1, exclusionsLoaded: true, excluded: [] })
  useFileAnalysisJobs.setState({ pending: 0, running: null, completed: 0, error: null })
  files(file())
  mocks.run.mockResolvedValue('AI catalogue description from the selected excerpt.')
  mocks.refresh.mockResolvedValue(undefined)
  mocks.read.mockImplementation(async (id: string, revision: string) => ({ id, revision, title: `${id}.md`, text: 'Self-authored source requirement: 0.6 m.', coverage: 'All source lines', complete: true, location: { kind: 'lines', start: 1, end: 1 } }))
  mocks.preview.mockImplementation(async (id: string, revision: string) => ({ id, revision, kind: 'image', url: 'data:image/png;base64,AAAA', width: 100, height: 200, mediaType: 'image/png', text: '', coverage: 'Bounded rendition', complete: true, imageComplete: false }))
  mocks.setAnalysis.mockImplementation(async (id: string, revision: string, analysis: ProjectFileAnalysisInput) => {
    files(...useProjectFilesStore.getState().catalogue.files.map(entry => entry.id === id ? { ...entry, aiDescription: { ...analysis, revision, createdAt: '2026-10-17T00:00:00Z' } } : entry))
    return useProjectFilesStore.getState().catalogue
  })
  vi.stubGlobal('window', { electronAPI: { context: { lease: async () => ({ id: 'lease', projectId: 'project' }) }, projectFiles: { read: mocks.read, preview: mocks.preview, setAnalysis: mocks.setAnalysis } } })
})
afterEach(async () => { stop?.(); stop = undefined; await flush(); vi.unstubAllGlobals() })

describe('opt-in project-file description queue', () => {
  it('does not infer by default, catalogue hydration or enabling the preference alone', async () => {
    stop = startProjectFileAutoAnalysis(); request(); await flush()
    expect(mocks.run).not.toHaveBeenCalled()
    files(file('hydrated'))
    useAiTaskModelsStore.setState({ analyseOnImport: true, revision: 2 }); await flush()
    expect(mocks.run).not.toHaveBeenCalled()
    request(['hydrated']); await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1)); await settled()
  })
  it('waits for queued and indexing files then runs only one selected model at a time', async () => {
    useAiTaskModelsStore.setState({ analyseOnImport: true })
    files({ ...file('first'), status: 'queued' }, { ...file('second'), status: 'indexing' })
    let release!: (value: string) => void
    mocks.run.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve }))
    stop = startProjectFileAutoAnalysis(); request(['first', 'second']); await flush()
    expect(useFileAnalysisJobs.getState().pending).toBe(2); expect(mocks.run).not.toHaveBeenCalled()
    files(file('first'), file('second'))
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(useFileAnalysisJobs.getState()).toMatchObject({ running: 'first.md', pending: 1 })
    await flush(); expect(mocks.run).toHaveBeenCalledTimes(1)
    release('First result'); await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2)); await settled()
    expect(useFileAnalysisJobs.getState().completed).toBe(2)
    const identities = mocks.run.mock.calls.map(([options]) => (options as FileAnalysisOptions).identity)
    expect(identities[0].chatId).toMatch(/^[a-f0-9-]{36}$/); expect(identities[0].chatId).toBe(identities[1].chatId)
    expect(identities[0]).toMatchObject({ projectId: 'project', workspaceEpoch: 1, policyRevision: 1 })
  })
  it('stores AI metadata separately from user descriptions after real broker reads and current-source validation', async () => {
    useAiTaskModelsStore.setState({ analyseOnImport: true, selections: { document: { provider: 'ollama', model: 'document-analyser' }, image: null } })
    mocks.run.mockImplementation(async (options: FileAnalysisOptions) => { await options.validate(); return 'Generated only from the authorised source.' })
    stop = startProjectFileAutoAnalysis(); request()
    await vi.waitFor(() => expect(mocks.setAnalysis).toHaveBeenCalledTimes(1)); await settled()
    const options: FileAnalysisOptions = mocks.run.mock.calls[0][0]
    expect(options.target).toEqual({ provider: 'ollama', model: 'document-analyser' }); expect(options.task).toBe('document')
    expect(options.evidence.sourceId).toBe('project-file:project:file'); expect(options.evidence.content).toContain('0.6 m')
    expect(mocks.read).toHaveBeenCalledWith('file', 'original:1', 'lease', undefined, 0)
    expect(mocks.setAnalysis).toHaveBeenCalledWith('file', 'original:1', expect.objectContaining({ text: 'Generated only from the authorised source.', provider: 'ollama', model: 'document-analyser', coverage: expect.stringContaining('not a complete document review') }), 'lease')
    expect(useProjectFilesStore.getState().catalogue.files[0]).toMatchObject({ userDescription: 'User-written purpose', generatedDescription: 'Local parser description', aiDescription: { revision: 'original:1' } })
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('does not repeat an existing description for the same revision and effective model', async () => {
    useAiTaskModelsStore.setState({ analyseOnImport: true }); stop = startProjectFileAutoAnalysis(); request()
    await vi.waitFor(() => expect(mocks.setAnalysis).toHaveBeenCalledTimes(1)); await settled()
    request(); await flush(); await settled(); expect(mocks.run).toHaveBeenCalledTimes(1)
    useAiTaskModelsStore.setState({ selections: { document: { provider: 'ollama', model: 'new-document-model' }, image: null }, revision: 2 })
    request(); await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2)); await settled()
  })
  it('uses real bounded image evidence with the selected image route rather than analysing image metadata as a document', async () => {
    files({ ...file(), mediaType: 'image/png', status: 'preview' })
    useAiTaskModelsStore.setState({ analyseOnImport: true, selections: { document: null, image: { provider: 'ollama', model: 'vision-model' } } })
    stop = startProjectFileAutoAnalysis(); request(); await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1)); await settled()
    const options: FileAnalysisOptions = mocks.run.mock.calls[0][0]
    expect(options.task).toBe('image'); expect(options.target.model).toBe('vision-model'); expect(options.image?.width).toBe(100)
    await expect(options.image!.materialise()).resolves.toContain('data:image/')
    expect(mocks.setAnalysis.mock.calls[0][2].coverage).toContain('image rendition only')
  })
  it.each(['policy', 'model', 'epoch', 'disable', 'cancel', 'source'])('aborts in-flight work on %s changes and does not publish stale metadata', async change => {
    useAiTaskModelsStore.setState({ analyseOnImport: true })
    let selected: FileAnalysisOptions | undefined
    mocks.run.mockImplementation((options: FileAnalysisOptions) => { selected = options; return new Promise<string>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) })
    stop = startProjectFileAutoAnalysis(); request(); await vi.waitFor(() => expect(selected).toBeDefined())
    if (change === 'policy') useContextStore.setState({ policyRevision: 2 })
    else if (change === 'model') useAiTaskModelsStore.setState({ revision: 2, selections: { document: { provider: 'ollama', model: 'new-model' }, image: null } })
    else if (change === 'epoch') useProjectStore.setState({ workspaceEpoch: 2 })
    else if (change === 'disable') useAiTaskModelsStore.setState({ analyseOnImport: false, revision: 2 })
    else if (change === 'source') files({ ...file(), revision: 'changed:2' })
    else useFileAnalysisJobs.getState().cancel()
    await vi.waitFor(() => expect(selected!.signal.aborted).toBe(true)); await settled()
    expect(mocks.setAnalysis).not.toHaveBeenCalled(); expect(mocks.run).toHaveBeenCalledTimes(1)
  })
  it('aborts follow-assistant descriptions when the effective assistant model changes', async () => {
    useAiTaskModelsStore.setState({ analyseOnImport: true })
    let selected: FileAnalysisOptions | undefined
    mocks.run.mockImplementation((options: FileAnalysisOptions) => { selected = options; return new Promise<string>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) })
    stop = startProjectFileAutoAnalysis(); request(); await vi.waitFor(() => expect(selected).toBeDefined())
    useAiStore.setState({ modelByProvider: { ollama: 'new-assistant-model' } })
    await vi.waitFor(() => expect(selected!.signal.aborted).toBe(true)); await settled()
    expect(mocks.setAnalysis).not.toHaveBeenCalled()
  })
  it('keeps source failures visible without a fallback or automatic retry until another explicit request', async () => {
    useAiTaskModelsStore.setState({ analyseOnImport: true })
    mocks.run.mockRejectedValueOnce(new Error('Selected model is offline'))
    stop = startProjectFileAutoAnalysis(); request(); await vi.waitFor(() => expect(useFileAnalysisJobs.getState().error).toContain('Selected model is offline')); await settled()
    files(...useProjectFilesStore.getState().catalogue.files); await flush()
    expect(mocks.run).toHaveBeenCalledTimes(1); expect(mocks.setAnalysis).not.toHaveBeenCalled()
    expect(useFileAnalysisJobs.getState().error).toContain('No fallback model')
    request(); await vi.waitFor(() => expect(mocks.setAnalysis).toHaveBeenCalledTimes(1)); await settled()
    expect(mocks.run).toHaveBeenCalledTimes(2)
  })
  it('clears old-project job labels, errors and counters when the workspace changes', async () => {
    stop = startProjectFileAutoAnalysis()
    useFileAnalysisJobs.setState({ completed: 3, error: 'Private report.md: offline', running: 'Private report.md' })
    useProjectStore.setState({ projectId: 'another-project', workspaceEpoch: 2 })
    await flush()
    expect(useFileAnalysisJobs.getState()).toMatchObject({ completed: 0, error: null, running: null, pending: 0 })
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
