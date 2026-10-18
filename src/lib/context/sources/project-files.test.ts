import { describe, expect, it, vi } from 'vitest'
import { projectFileSources } from './project-files'
import { projectFileAvailable, projectFileEvidenceAvailable } from '@/lib/project-file-availability'
import type { ProjectFileApi, ProjectFileCatalogue, ProjectFileEntry, ProjectLinkedFolder } from '@/lib/project-files'
import { ContextBroker } from '../broker'

const linked = (): ProjectFileEntry => ({ id: 'file', name: 'Report.md', originalName: 'Report.md', folder: '', role: 'reference', userDescription: '', generatedDescription: 'Original indexed description', sha256: 'a'.repeat(64), bytes: 120, mediaType: 'text/markdown', revision: 'original', importedAt: '', updatedAt: '', saved: true, status: 'searchable', coverage: 'All lines', storage: { kind: 'linked', folderId: 'folder', relativePath: 'reports/Report.md', fingerprint: 'fingerprint' } })
const catalogue = (): ProjectFileCatalogue => ({ projectId: 'project', revision: 1, savedRevision: 1, files: [linked()], linkedFolders: [{ id: 'folder', name: 'References', path: '/chosen/reports', status: 'ready' }] })
describe('linked project-file source authority', () => {
  it.each(['unlinked', 'missing', 'needs-scan', 'scanning', 'error'] as ProjectLinkedFolder['status'][])('revokes old indexed descriptors while its folder is %s', status => {
    const state = catalogue(); state.linkedFolders![0].status = status
    expect(projectFileSources(state, {} as ProjectFileApi, async () => 'lease')).toEqual([])
    expect(projectFileAvailable(state.files[0], state)).toBe(false)
  })
  it('keeps embedded files available without any external folder grant', () => {
    const state = catalogue(); delete state.files[0].storage; state.linkedFolders = []
    expect(projectFileAvailable(state.files[0], state)).toBe(true)
    expect(projectFileSources(state, {} as ProjectFileApi, async () => 'lease')).toHaveLength(1)
  })
  it('keeps oversized linked metadata discoverable without authorising its body', async () => {
    const state = catalogue(); state.files[0].sha256 = ''; state.files[0].status = 'stored'
    expect(projectFileAvailable(state.files[0], state)).toBe(true)
    expect(projectFileEvidenceAvailable(state.files[0], state)).toBe(false)
    const sources = projectFileSources(state, {} as ProjectFileApi, async () => 'lease')
    expect(sources).toHaveLength(1)
    expect(sources[0].projectFile?.metadataOnly).toBe(true)
    await expect(sources[0].read()).rejects.toThrow('BUDGET_LIMIT')
  })
  it('rejects an earlier search handle when its folder needs a fresh scan', async () => {
    const state = catalogue(), read = vi.fn(), api = { read } as unknown as ProjectFileApi
    const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: 'project', workspaceEpoch: 1, policyRevision: 0 }, target: 'fixture', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => projectFileSources(state, api, async () => 'lease'), excluded: () => [], contentSearch: async () => [{ sourceId: 'project-file:project:file', revision: 'original', excerpt: 'Old indexed body' }] })
    const result = JSON.parse(await broker.searchWithMemory({ query: 'Old indexed body' }))
    expect(result.results).toHaveLength(1)
    state.linkedFolders![0].status = 'needs-scan'
    expect(JSON.parse(await broker.read({ ref: result.results[0].ref })).status).toBe('SOURCE_UNAVAILABLE')
    expect(JSON.parse(await broker.searchWithMemory({ query: 'Old indexed body' })).results).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
})

it('allows ordinary metadata discovery but refuses indexed-body hits and visual evidence for an oversized file', async () => {
  const state = catalogue(); state.files[0].sha256 = ''; state.files[0].mediaType = 'image/png'; state.files[0].name = 'Large imagery.png'
  const image = vi.fn()
  const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: 'project', workspaceEpoch: 1, policyRevision: 0 }, target: 'fixture', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => projectFileSources(state, {} as ProjectFileApi, async () => 'lease'), excluded: () => [], image, contentSearch: async () => [{ sourceId: 'project-file:project:file', revision: 'original', excerpt: 'FORBIDDEN_CACHED_BODY' }] })
  expect(JSON.parse(await broker.searchWithMemory({ query: 'FORBIDDEN_CACHED_BODY' })).results).toEqual([])
  const result = JSON.parse(await broker.searchWithMemory({ query: 'Large imagery' }))
  expect(result.results).toHaveLength(1)
  expect(result.results[0].excerpt).toContain('Metadata only')
  expect(JSON.parse(await broker.read({ ref: result.results[0].ref, location: { kind: 'image' } })).status).toBe('BUDGET_LIMIT')
  expect(image).not.toHaveBeenCalled()
})
