import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { projectActions } from './project'
import { validateArgs } from './types'
import { useProjectStore } from '@/store/project'
import type { ProjectFileCatalogue, ProjectFileEntry } from '@/lib/project-files'

const mocked = vi.hoisted(() => ({ policy: { exclusionsLoaded: true, excluded: [] as string[], policyRevision: 0 }, columns: false, show: vi.fn() }))
vi.mock('@/store/context', () => ({ useContextStore: { getState: () => mocked.policy } }))
vi.mock('@/store/column-disclosure', () => ({ hasColumnExclusions: () => mocked.columns }))
vi.mock('@/lib/project-files-ui', () => ({ openProjectFiles: (...args: unknown[]) => mocked.show(...args) }))
vi.mock('@/lib/project-persistence', () => ({ saveCurrentProject: vi.fn(), saveProjectAs: vi.fn(), loadProjectFromPath: vi.fn(), newProject: vi.fn(), loadProject: vi.fn() }))

const file = (id: string, name: string): ProjectFileEntry => ({ id, name, originalName: name, folder: 'Standards', role: 'standard', userDescription: 'Project rainfall criteria', generatedDescription: 'Local extraction', sha256: 'a'.repeat(64), bytes: 123, mediaType: 'application/pdf', revision: 'revision-1', importedAt: '2026-10-16', updatedAt: '2026-10-16', status: 'searchable', coverage: '80 physical pages', saved: true })
let catalogue: ProjectFileCatalogue
const api = { catalogue: vi.fn(), update: vi.fn(), remove: vi.fn(), reindex: vi.fn(), linkFolder: vi.fn(), createFolder: vi.fn(), forgetFolder: vi.fn(), relinkFolder: vi.fn(), rescanFolders: vi.fn(), renameLinkedFolder: vi.fn() }
async function invoke(id: string, args: Record<string, unknown> = {}) {
  const action = projectActions.find(action => action.id === id)!
  const invalid = validateArgs(action, args)
  return invalid ? { ok: false, message: invalid } : action.run(args)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocked.policy = { exclusionsLoaded: true, excluded: ['project-file:project:private'], policyRevision: 0 }; mocked.columns = false
  catalogue = { projectId: 'project', revision: 1, savedRevision: 1, files: [file('public', 'Design standard.pdf'), file('private', 'PRIVATE REPORT.pdf')] }
  api.catalogue.mockImplementation(async () => catalogue)
  api.update.mockResolvedValue(catalogue); api.remove.mockResolvedValue(catalogue); api.reindex.mockResolvedValue(catalogue)
  vi.stubGlobal('window', { electronAPI: { context: { lease: async () => ({ id: 'lease', projectId: 'project' }) }, projectFiles: api } })
  useProjectStore.setState({ path: '/project.ourgeoproj', projectId: 'project', workspaceEpoch: 3, phase: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('project-file assistant actions', () => {
  it('exposes read/navigation, gated edits and confirmed removal without native picker actions', () => {
    const actions = projectActions.filter(action => /File|project:files/.test(action.id))
    expect(actions.map(action => [action.id, action.tier])).toEqual([['project:files', 'always'], ['project:showFile', 'always'], ['project:updateFile', 'autopilot'], ['project:removeFile', 'confirm'], ['project:reindexFiles', 'autopilot']])
    expect(actions.some(action => /add|replace|export/i.test(action.id))).toBe(false)
  })
  it('lists only authorised metadata, supports filters and retains a browse fallback', async () => {
    const result = await invoke('project:files', { role: 'standard', query: 'rainfall', limit: 1 })
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('PRIVATE REPORT')
    expect(JSON.parse(result.data as string)).toMatchObject({ total: 1, entries: [{ id: 'public', sourceId: 'project-file:project:public' }] })
    expect(result.message).toContain('omit filters to browse')
  })
  it('fails closed before listing while disclosure policies are loading', async () => {
    mocked.policy.exclusionsLoaded = false
    const result = await invoke('project:files')
    expect(result.ok).toBe(false)
    expect(api.catalogue).not.toHaveBeenCalled()
  })
  it('rechecks disclosure after an asynchronous catalogue read', async () => {
    api.catalogue.mockImplementation(async () => { mocked.policy.policyRevision++; return catalogue })
    const result = await invoke('project:files')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('Design standard')
  })
  it('requires valid arguments before navigating and never opens an excluded file', async () => {
    expect((await invoke('project:showFile')).ok).toBe(false)
    expect((await invoke('project:showFile', { id: 'private' })).ok).toBe(false)
    expect((await invoke('project:showFile', { id: 'public', location: { kind: 'pdf', page: 80, sheet: 'mixed' } })).ok).toBe(false)
    expect(mocked.show).not.toHaveBeenCalled()
    expect((await invoke('project:showFile', { id: 'public', revision: 'revision-1', location: { kind: 'pdf', page: 80 } })).ok).toBe(true)
    expect(mocked.show).toHaveBeenCalledWith('public', { kind: 'pdf', page: 80 })
  })
  it('edits metadata through the main boundary with its expected revision and preserves originals', async () => {
    expect((await invoke('project:updateFile', { id: 'public', revision: 'revision-1', description: 'Verified rainfall standard', folder: '', role: 'reference' })).ok).toBe(true)
    expect(api.update).toHaveBeenCalledWith('public', 'revision-1', { userDescription: 'Verified rainfall standard', folder: '', role: 'reference' }, 'lease')
    expect((await invoke('project:updateFile', { id: 'public', revision: 'revision-1', role: 'privileged' })).ok).toBe(false)
  })
  it('refuses stale removal and reindexes an explicit list of authorised files', async () => {
    expect((await invoke('project:removeFile', { id: 'public', revision: 'earlier' })).ok).toBe(false)
    expect(api.remove).not.toHaveBeenCalled()
    expect((await invoke('project:reindexFiles')).ok).toBe(true)
    expect(api.reindex).toHaveBeenCalledWith(['public'], 'lease')
    expect((await invoke('project:reindexFiles', { ids: ['private'] })).ok).toBe(false)
    expect(api.reindex).toHaveBeenCalledTimes(1)
  })
})


describe('linked-folder assistant actions', () => {
  beforeEach(() => {
    catalogue.linkedFolders = [
      { id: 'ready', name: 'Working reports', path: '/chosen/reports', status: 'ready' },
      { id: 'unlinked', name: 'Portable reference', status: 'unlinked' },
      { id: 'stale', name: 'Changed files', path: '/chosen/changed', status: 'needs-scan' },
    ]
    catalogue.files.push({ ...file('linked', 'Linked report.pdf'), storage: { kind: 'linked', folderId: 'ready', relativePath: 'reports/Linked report.pdf', fingerprint: 'fingerprint' } })
    catalogue.files.push({ ...file('stale-file', 'OUTDATED BODY.pdf'), storage: { kind: 'linked', folderId: 'stale', relativePath: 'OUTDATED BODY.pdf', fingerprint: 'fingerprint' } })
  })
  it('reuses confirmation for physical grants and creation, and Autopilot for rescans and label edits', () => {
    for (const id of ['project:linkFolder', 'project:createFolder', 'project:relinkFolder', 'project:forgetFolder']) expect(projectActions.find(action => action.id === id)?.tier).toBe('confirm')
    for (const id of ['project:rescanFolders', 'project:renameFolder']) expect(projectActions.find(action => action.id === id)?.tier).toBe('autopilot')
    expect(projectActions.find(action => action.id === 'project:folders')?.tier).toBe('always')
  })
  it('keeps recovery folder metadata available while unavailable linked files cannot be listed or acted upon', async () => {
    const folders = await invoke('project:folders')
    expect(folders.ok).toBe(true)
    expect(JSON.parse(folders.data as string).entries).toContainEqual(expect.objectContaining({ id: 'unlinked', status: 'unlinked' }))
    const files = await invoke('project:files')
    expect(JSON.stringify(files)).toContain('Linked report.pdf')
    expect(JSON.stringify(files)).not.toContain('OUTDATED BODY')
    expect((await invoke('project:showFile', { id: 'stale-file' })).ok).toBe(false)
    expect((await invoke('project:removeFile', { id: 'stale-file', revision: 'revision-1' })).ok).toBe(false)
    expect(api.remove).not.toHaveBeenCalled()
  })
  it('requires explicit absolute paths before linking and never asks the model to complete a native picker', async () => {
    expect((await invoke('project:linkFolder')).ok).toBe(false)
    expect((await invoke('project:linkFolder', { path: 'relative/reports' })).ok).toBe(false)
    expect(api.linkFolder).not.toHaveBeenCalled()
    expect((await invoke('project:linkFolder', { path: '/chosen/new-reports', name: 'Reports' })).ok).toBe(true)
    expect(api.linkFolder).toHaveBeenCalledWith('lease', '/chosen/new-reports', 'Reports')
  })
  it('creates exactly one physical child beneath the explicit parent and links it without inventing a path', async () => {
    expect((await invoke('project:createFolder', { parentPath: '/chosen', name: '../outside' })).ok).toBe(false)
    expect((await invoke('project:createFolder', { name: 'Reports' })).ok).toBe(false)
    expect(api.createFolder).not.toHaveBeenCalled()
    expect((await invoke('project:createFolder', { parentPath: '/chosen', name: 'Reports', label: 'Project reports' })).ok).toBe(true)
    expect(api.createFolder).toHaveBeenCalledWith('lease', 'Reports', '/chosen', 'Project reports')
  })
  it('forgets a link through its dedicated boundary and promises to preserve physical contents', async () => {
    const result = await invoke('project:forgetFolder', { id: 'ready' })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('physical folder and its contents remain on disk')
    expect(api.forgetFolder).toHaveBeenCalledWith('ready', 'lease')
    expect(api.remove).not.toHaveBeenCalled()
  })
  it('rescans local references explicitly and requires relinking before scanning an imported reference', async () => {
    expect((await invoke('project:rescanFolders')).ok).toBe(true)
    expect(api.rescanFolders).toHaveBeenCalledWith(['ready', 'stale'], 'lease')
    expect((await invoke('project:rescanFolders', { ids: ['unlinked'] })).ok).toBe(false)
    expect(api.rescanFolders).toHaveBeenCalledTimes(1)
    expect((await invoke('project:relinkFolder', { id: 'unlinked' })).ok).toBe(false)
    expect((await invoke('project:relinkFolder', { id: 'unlinked', path: '/chosen/reconnected' })).ok).toBe(true)
    expect(api.relinkFolder).toHaveBeenCalledWith('unlinked', 'lease', '/chosen/reconnected')
  })
  it('lists large linked files honestly as metadata without pretending their bodies are readable', async () => {
    catalogue.files.push({ ...file('oversized', 'Large source.csv'), bytes: 1024 ** 3, sha256: '', status: 'stored', storage: { kind: 'linked', folderId: 'ready', relativePath: 'Large source.csv', fingerprint: 'large' } })
    const result = await invoke('project:files', { query: 'Large source' })
    expect(JSON.parse(result.data as string).entries[0]).toMatchObject({ storage: { kind: 'linked', readable: false }, status: 'stored' })
  })
})
