import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectFileCatalogue, ProjectFileEntry } from '@/lib/project-files'

const sites: ProjectFileEntry = { id: 'f1', name: 'sites.csv', originalName: 'sites.csv', folder: 'data', role: 'reference', userDescription: '', generatedDescription: '', sha256: 'h', bytes: 10, mediaType: 'text/csv', revision: 'r', importedAt: '2026-10-01', updatedAt: '2026-10-01', status: 'searchable', coverage: '', saved: true }
const catalogue: ProjectFileCatalogue = { projectId: 'p', revision: 1, savedRevision: 1, files: [sites] }
let disk: Record<string, string>

beforeEach(() => {
  vi.resetModules()
  disk = {}
  vi.stubGlobal('window', { electronAPI: {
    context: { lease: vi.fn().mockResolvedValue({ id: 'lease' }) },
    projectFiles: { catalogue: vi.fn().mockResolvedValue(catalogue) },
    file: { read: vi.fn(async (path: string) => { if (!(path in disk)) throw new Error('missing'); return disk[path] }), write: vi.fn(async (path: string, data: string) => { disk[path] = data }) },
    app: { getDataPath: vi.fn().mockResolvedValue('/data') },
  } })
})

const load = () => import('./project-file-replace')

describe('asking before an export replaces a project file', () => {
  it('goes ahead without asking when nothing has that name', async () => {
    const { confirmProjectFileReplace, useProjectFileReplaceStore } = await load()
    expect(await confirmProjectFileReplace('tables/summary.csv')).toBe(true)
    expect(useProjectFileReplaceStore.getState().pending).toBeNull()
  })

  it('asks about the file the library would replace, and Cancel refuses', async () => {
    const { confirmProjectFileReplace, useProjectFileReplaceStore } = await load()
    const answer = confirmProjectFileReplace('tables/sites.csv')
    await vi.waitFor(() => expect(useProjectFileReplaceStore.getState().pending?.existing).toBe(sites))
    useProjectFileReplaceStore.getState().answer(false, true)
    expect(await answer).toBe(false)
    // "Don't ask again" counts only with Replace; a cancel changes nothing.
    expect(useProjectFileReplaceStore.getState().askBeforeReplacing).toBe(true)
  })

  it('remembers "don\'t ask again" across launches, and the setting turns it back on', async () => {
    let module = await load()
    const answer = module.confirmProjectFileReplace('sites.csv')
    await vi.waitFor(() => expect(module.useProjectFileReplaceStore.getState().pending).not.toBeNull())
    module.useProjectFileReplaceStore.getState().answer(true, true)
    expect(await answer).toBe(true)
    await vi.waitFor(() => expect(JSON.parse(disk['/data/project-file-preferences.json'] ?? '{}')).toEqual({ askBeforeReplacing: false }))

    vi.resetModules(); module = await load()
    expect(await module.confirmProjectFileReplace('sites.csv')).toBe(true)
    module.useProjectFileReplaceStore.getState().setAskBeforeReplacing(true)
    const asked = module.confirmProjectFileReplace('sites.csv')
    await vi.waitFor(() => expect(module.useProjectFileReplaceStore.getState().pending).not.toBeNull())
    module.useProjectFileReplaceStore.getState().answer(false)
    expect(await asked).toBe(false)
  })
})
