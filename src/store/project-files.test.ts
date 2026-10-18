import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from './project'
import { useSessionStore } from './session'
import { useProjectFilesStore } from './project-files'
import { EMPTY_PROJECT_FILES, type ProjectFileCatalogue, type ProjectFileEntry } from '@/lib/project-files'

const { saveAs } = vi.hoisted(() => ({ saveAs: vi.fn() }))
vi.mock('@/lib/project-persistence', () => ({ saveProjectAs: saveAs }))

const file: ProjectFileEntry = { id: 'f1', name: 'report.md', originalName: 'report.md', folder: '', role: 'reference', userDescription: '', generatedDescription: 'A report', sha256: 'hash', bytes: 12, mediaType: 'text/markdown', revision: 'r1', importedAt: '2026-01-01', updatedAt: '2026-01-01', status: 'searchable', coverage: 'Complete', saved: false }
const catalogue = (revision = 1): ProjectFileCatalogue => ({ projectId: 'p1', revision, savedRevision: 0, files: [file] })
let api: { catalogue: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn>; exportFile: ReturnType<typeof vi.fn>; linkFolder: ReturnType<typeof vi.fn>; createFolder: ReturnType<typeof vi.fn> }
let lease: ReturnType<typeof vi.fn>

beforeEach(() => {
  useProjectStore.setState({ path: '/project.ourgeoproj', projectId: 'p1', workspaceEpoch: 1, phase: 'ready', isDirty: false })
  useProjectFilesStore.setState({ catalogue: EMPTY_PROJECT_FILES, selected: [], detailsOpen: false, error: null, preview: null })
  useSessionStore.setState({ consoleHistory: [] })
  api = { catalogue: vi.fn().mockResolvedValue(catalogue()), add: vi.fn().mockResolvedValue({ catalogue: catalogue(), ids: ['f1'], errors: [] }), preview: vi.fn(), exportFile: vi.fn().mockResolvedValue(false), linkFolder: vi.fn().mockResolvedValue(catalogue()), createFolder: vi.fn().mockResolvedValue(catalogue()) }
  lease = vi.fn().mockResolvedValue({ id: 'lease' })
  vi.stubGlobal('window', { electronAPI: { context: { lease }, projectFiles: api } })
  saveAs.mockReset()
})

describe('project file renderer authority', () => {
  it('imports nothing when saving a scratch project is cancelled', async () => {
    useProjectStore.setState({ path: null, projectId: null })
    saveAs.mockResolvedValue(false)
    expect(await useProjectFilesStore.getState().add(['/report.md'])).toEqual([])
    expect(saveAs).toHaveBeenCalledOnce()
    expect(api.add).not.toHaveBeenCalled()
  })

  it('saves a named project before asking main to import dropped files', async () => {
    useProjectStore.setState({ path: null, projectId: null })
    saveAs.mockImplementation(async () => { useProjectStore.setState({ path: '/saved.ourgeoproj', projectId: 'p1' }); return true })
    await useProjectFilesStore.getState().add(['/report.md'])
    expect(saveAs.mock.invocationCallOrder[0]).toBeLessThan(api.add.mock.invocationCallOrder[0])
    expect(api.add).toHaveBeenCalledWith('lease', ['/report.md'])
    expect(useProjectStore.getState().isDirty).toBe(true)
  })

  it('does not import a pending selection after a project switch during lease acquisition', async () => {
    lease.mockImplementation(async () => { useProjectStore.setState({ workspaceEpoch: 2 }); return { id: 'other-project' } })
    expect(await useProjectFilesStore.getState().add(['/report.md'])).toEqual([])
    expect(api.add).not.toHaveBeenCalled()
  })

  it('ignores an old refresh that completes after a newer catalogue snapshot', async () => {
    useProjectFilesStore.setState({ catalogue: catalogue(3) })
    api.catalogue.mockResolvedValue(catalogue(2))
    await useProjectFilesStore.getState().refresh()
    expect(useProjectFilesStore.getState().catalogue.revision).toBe(3)
  })

  it('drops late previews when another file selection takes over', async () => {
    useProjectFilesStore.setState({ catalogue: catalogue() })
    let resolve!: (value: unknown) => void
    api.preview.mockImplementation(() => new Promise(done => { resolve = done }))
    const loading = useProjectFilesStore.getState().loadPreview('f1')
    await Promise.resolve()
    useProjectFilesStore.getState().select([])
    resolve({ id: 'f1', revision: 'r1', kind: 'text', text: 'old contents' })
    await loading
    expect(useProjectFilesStore.getState().preview).toBeNull()
  })
  it('keeps a completed preview when the same file details are reopened', () => {
    const preview = { id: 'f1', revision: 'r1', title: 'Report', kind: 'text' as const, text: 'Contents', mediaType: 'text/plain', coverage: 'Complete', complete: true }
    useProjectFilesStore.setState({ catalogue: catalogue(), selected: ['f1'], preview })
    useProjectFilesStore.getState().select(['f1'])
    expect(useProjectFilesStore.getState().preview).toBe(preview)
  })
  it('records an export only after the user actually writes the original', async () => {
    useProjectFilesStore.setState({ catalogue: catalogue() })
    await useProjectFilesStore.getState().exportFile('f1')
    expect(useSessionStore.getState().consoleHistory).toHaveLength(0)
    api.exportFile.mockResolvedValue(true)
    await useProjectFilesStore.getState().exportFile('f1')
    expect(useSessionStore.getState().consoleHistory).toEqual([expect.objectContaining({ type: 'info', text: '[Project Files] Exported the original report.md.' })])
  })
  it('does not create or grant a linked directory when naming a scratch project is cancelled', async () => {
    useProjectStore.setState({ path: null, projectId: null })
    saveAs.mockResolvedValue(false)
    await useProjectFilesStore.getState().createFolder('References', '/parent')
    await useProjectFilesStore.getState().linkFolder('/reports')
    expect(api.createFolder).not.toHaveBeenCalled()
    expect(api.linkFolder).not.toHaveBeenCalled()
  })
  it('keeps chosen link paths in their project when lease acquisition races a switch', async () => {
    lease.mockImplementation(async () => { useProjectStore.setState({ workspaceEpoch: 2 }); return { id: 'other-project' } })
    await useProjectFilesStore.getState().linkFolder('/reports')
    expect(api.linkFolder).not.toHaveBeenCalled()
  })
  it('revokes retained evidence when a linked root becomes unavailable without changing file bytes', async () => {
    const linkedFile = { ...file, storage: { kind: 'linked' as const, folderId: 'root', relativePath: 'report.md', fingerprint: 'v1' } }
    const before: ProjectFileCatalogue = { ...catalogue(), files: [linkedFile], linkedFolders: [{ id: 'root', name: 'Reports', status: 'ready', path: '/reports' }] }
    useProjectFilesStore.setState({ catalogue: before, selected: ['f1'], preview: { id: 'f1', revision: 'r1', title: 'Report', kind: 'image', url: 'data:image/png;base64,old', text: '', mediaType: 'image/png', coverage: '', complete: true } })
    const dispatchEvent = vi.fn()
    window.dispatchEvent = dispatchEvent
    api.catalogue.mockResolvedValue({ ...before, linkedFolders: [{ id: 'root', name: 'Reports', status: 'missing', path: '/reports' }] })
    await useProjectFilesStore.getState().refresh()
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ourgeo:projectFilesRevised', detail: { projectId: 'p1', ids: ['f1'] } }))
    expect(useProjectFilesStore.getState().preview).toBeNull()
  })
  it('rejects a late linked preview after its local folder loses authority at the same file revision', async () => {
    const linkedFile = { ...file, storage: { kind: 'linked' as const, folderId: 'root', relativePath: 'report.md', fingerprint: 'v1' } }
    const before: ProjectFileCatalogue = { ...catalogue(), files: [linkedFile], linkedFolders: [{ id: 'root', name: 'Reports', status: 'ready', path: '/reports' }] }
    useProjectFilesStore.setState({ catalogue: before, selected: ['f1'] })
    let resolve!: (value: unknown) => void
    api.preview.mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = useProjectFilesStore.getState().loadPreview('f1')
    await Promise.resolve()
    api.catalogue.mockResolvedValue({ ...before, linkedFolders: [{ id: 'root', name: 'Reports', status: 'unlinked' }] })
    await useProjectFilesStore.getState().refresh()
    resolve({ id: 'f1', revision: 'r1', kind: 'image', url: 'data:image/png;base64,old' })
    await pending
    expect(useProjectFilesStore.getState().preview).toBeNull()
  })
})
