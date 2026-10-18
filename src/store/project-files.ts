import { create } from 'zustand'
import { useProjectStore } from './project'
import { useSessionStore } from './session'
import { EMPTY_PROJECT_FILES, type ProjectFileCatalogue, type ProjectFileEntry, type ProjectFileLocation, type ProjectFilePreview } from '@/lib/project-files'
import type { ProjectFileFilters } from '@/lib/project-files-ui'

export const INITIAL_PROJECT_FILE_FILTERS: ProjectFileFilters = { search: '', role: '', status: '', availability: '', folder: '', location: '', sort: 'name', descending: false }

interface ProjectFilesState {
  catalogue: ProjectFileCatalogue
  selected: string[]
  detailsOpen: boolean
  undoAvailable: boolean
  location?: ProjectFileLocation
  preview: ProjectFilePreview | null
  loading: boolean
  error: string | null
  notice: string | null
  filters: ProjectFileFilters
  setFilters: (changes: Partial<ProjectFileFilters>) => void
  refresh: () => Promise<void>
  add: (paths?: string[]) => Promise<string[]>
  select: (ids: string[], location?: ProjectFileLocation, showDetails?: boolean) => void
  loadPreview: (id: string, location?: ProjectFileLocation, options?: { includeHidden?: boolean }) => Promise<void>
  update: (id: string, changes: Partial<Pick<ProjectFileEntry, 'name' | 'folder' | 'role' | 'userDescription'>>) => Promise<void>
  replace: (id: string) => Promise<void>
  remove: (ids: string[]) => Promise<void>
  undo: () => Promise<void>
  reindex: (ids?: string[]) => Promise<void>
  exportFile: (id: string) => Promise<void>
  cancel: () => Promise<void>
  recover: (id: string) => Promise<void>
  setIncludeHidden: (id: string, enabled: boolean) => Promise<void>
  linkFolder: (path?: string, name?: string) => Promise<void>
  createFolder: (name: string, parentPath?: string, label?: string) => Promise<void>
  rescanFolders: (ids?: string[]) => Promise<void>
  forgetFolder: (id: string) => Promise<void>
  relinkFolder: (id: string, path?: string) => Promise<void>
  renameLinkedFolder: (id: string, name: string) => Promise<void>
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
let initialised = false
let previewGeneration = 0

// Jobs belong to main and continue when this pane is closed. This subscription
// mirrors their catalogue; no document bytes or searchable bodies live here.
export function initProjectFiles(): void {
  if (initialised) return
  initialised = true
  window.electronAPI.projectFiles.onChanged(() => { void useProjectFilesStore.getState().refresh() })
  useProjectStore.subscribe((state, previous) => {
    if (state.workspaceEpoch !== previous.workspaceEpoch || state.projectId !== previous.projectId) {
      previewGeneration++
      useProjectFilesStore.setState({ catalogue: EMPTY_PROJECT_FILES, selected: [], detailsOpen: false, undoAvailable: false, preview: null, location: undefined, error: null, notice: null, filters: INITIAL_PROJECT_FILE_FILTERS })
      if (state.phase === 'ready') void useProjectFilesStore.getState().refresh()
    } else if (state.phase === 'ready' && previous.phase !== 'ready') void useProjectFilesStore.getState().refresh()
  })
  void useProjectFilesStore.getState().refresh()
}

async function withCatalogue(run: (lease: string) => Promise<ProjectFileCatalogue>, activity?: (before: ProjectFileCatalogue, after: ProjectFileCatalogue) => string | undefined): Promise<void> {
  const epoch = useProjectStore.getState().workspaceEpoch
  const before = useProjectFilesStore.getState().catalogue
  useProjectFilesStore.setState({ error: null })
  try {
    const lease = await window.electronAPI.context.lease()
    if (useProjectStore.getState().workspaceEpoch !== epoch) return
    const catalogue = await run(lease.id)
    if (useProjectStore.getState().workspaceEpoch !== epoch) return
    const current = useProjectFilesStore.getState().catalogue
    if (current.projectId === catalogue.projectId && (current.revision > catalogue.revision || current.savedRevision > catalogue.savedRevision)) return
    let revised: string[] = []
    if (current.projectId === catalogue.projectId) {
      revised = current.files.filter(previous => {
        const next = catalogue.files.find(file => file.id === previous.id)
        if (!next || next.revision !== previous.revision) return true
        if (!previous.storage) return false
        const beforeFolder = current.linkedFolders?.find(folder => folder.id === previous.storage?.folderId)
        const afterFolder = catalogue.linkedFolders?.find(folder => folder.id === next.storage?.folderId)
        return beforeFolder?.status === 'ready' && afterFolder?.status !== 'ready'
          || beforeFolder?.path !== afterFolder?.path || previous.storage.fingerprint !== next.storage?.fingerprint
      }).map(file => file.id)
      // A retained CLI conversation can outlive a file replacement. Let the
      // chat lifecycle revoke those sessions before publishing the new view.
      if (revised.length && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('ourgeo:projectFilesRevised', { detail: { projectId: catalogue.projectId, ids: revised } }))
    }
    const selected = useProjectFilesStore.getState().selected.filter(id => catalogue.files.some(file => file.id === id))
    const invalidatePreview = selected.some(id => revised.includes(id))
    if (invalidatePreview) previewGeneration++
    useProjectFilesStore.setState({ catalogue, selected, ...(catalogue.savedRevision !== current.savedRevision ? { undoAvailable: false } : {}), ...(!selected.length || invalidatePreview ? { preview: null } : {}) })
    if (catalogue.revision !== catalogue.savedRevision) useProjectStore.getState().markDirty()
    const audit = activity?.(before, catalogue)
    if (audit) useSessionStore.getState().addConsoleEntry('info', `[Project Files] ${audit}`)
  } catch (error) {
    if (useProjectStore.getState().workspaceEpoch === epoch) useProjectFilesStore.setState({ error: `${message(error)} Retry the action or refresh Project Files.` })
    throw error
  }
}

function entry(id: string): ProjectFileEntry {
  const file = useProjectFilesStore.getState().catalogue.files.find(file => file.id === id)
  if (!file) throw new Error('This file is no longer in the project. Refresh Project Files.')
  return file
}

function previewAuthority(file: ProjectFileEntry, catalogue: ProjectFileCatalogue): string {
  const folder = catalogue.linkedFolders?.find(folder => folder.id === file.storage?.folderId)
  return JSON.stringify([file.revision, file.storage?.fingerprint, folder?.status, folder?.path])
}

async function ensureNamedProject(): Promise<boolean> {
  const before = useProjectStore.getState()
  if (before.phase !== 'ready') throw new Error('Wait for the project to finish opening before adding files or linked folders.')
  if (!before.path) {
    // The normal Save As flow commits the project identity before main can
    // grant a selected folder. Cancelling it must not create a directory.
    const { saveProjectAs } = await import('@/lib/project-persistence')
    if (!await saveProjectAs()) return false
  }
  const current = useProjectStore.getState()
  return current.workspaceEpoch === before.workspaceEpoch && current.path !== null
}

export const useProjectFilesStore = create<ProjectFilesState>((set, get) => ({
  catalogue: EMPTY_PROJECT_FILES, selected: [], detailsOpen: false, undoAvailable: false, preview: null, loading: false, error: null, notice: null,
  filters: INITIAL_PROJECT_FILE_FILTERS,
  setFilters: changes => set(state => ({ filters: { ...state.filters, ...changes } })),
  refresh: async () => {
    const epoch = useProjectStore.getState().workspaceEpoch
    set({ loading: true })
    try { await withCatalogue(lease => window.electronAPI.projectFiles.catalogue(lease)) }
    catch { /* withCatalogue retains the actionable error for the pane. */ }
    finally { if (useProjectStore.getState().workspaceEpoch === epoch) set({ loading: false }) }
  },
  add: async paths => {
    const epoch = useProjectStore.getState().workspaceEpoch
    if (!await ensureNamedProject()) return []
    let ids: string[] = []
    await withCatalogue(async lease => {
      const result = await window.electronAPI.projectFiles.add(lease, paths)
      ids = result.ids
      if (useProjectStore.getState().workspaceEpoch === epoch) set({ notice: result.errors.length ? result.errors.join('\n') : result.catalogue.notice ?? null })
      return result.catalogue
    }, (before, after) => { const added = after.files.filter(file => !before.files.some(previous => previous.id === file.id)).length; return added ? `Added ${added} ${added === 1 ? 'file' : 'files'} to the project. Save the project to include them in its bundle.` : undefined })
    if (useProjectStore.getState().workspaceEpoch !== epoch) return []
    if (ids.length) get().select(ids, undefined, false)
    return ids
  },
  select: (selected, location, detailsOpen = true) => {
    const previous = get()
    const same = selected.length === previous.selected.length && selected.every((id, index) => id === previous.selected[index]) && JSON.stringify(location) === JSON.stringify(previous.location)
    // Reopening the same details is navigation, not a new read. Clearing its
    // preview here leaves it loading forever because the effect's source and
    // revision have not changed and therefore it will not request it again.
    if (!same) previewGeneration++
    set({ selected, location, detailsOpen, ...(!same ? { preview: null } : {}) })
  },
  loadPreview: async (id, location, options) => {
    const generation = ++previewGeneration, epoch = useProjectStore.getState().workspaceEpoch
    set({ preview: null, error: null })
    try {
      const file = entry(id)
      const authority = previewAuthority(file, get().catalogue)
      const lease = await window.electronAPI.context.lease()
      if (epoch !== useProjectStore.getState().workspaceEpoch) return
      const preview = await window.electronAPI.projectFiles.preview(id, file.revision, lease.id, location, options)
      const currentFile = get().catalogue.files.find(file => file.id === id)
      if (generation === previewGeneration && epoch === useProjectStore.getState().workspaceEpoch && get().selected.length === 1 && get().selected[0] === id && currentFile?.revision === preview.revision && previewAuthority(currentFile, get().catalogue) === authority) set({ preview })
    } catch (error) {
      if (generation === previewGeneration && epoch === useProjectStore.getState().workspaceEpoch) set({ error: `${message(error)} Try exporting the original file.` })
    }
  },
  update: (id, changes) => {
    const revision = entry(id).revision
    return withCatalogue(lease => window.electronAPI.projectFiles.update(id, revision, changes, lease), (before, after) => after.revision !== before.revision ? `Updated details for ${after.files.find(file => file.id === id)?.name ?? 'a project file'}.` : undefined)
  },
  replace: id => {
    const revision = entry(id).revision
    return withCatalogue(lease => window.electronAPI.projectFiles.replace(id, revision, lease), (_before, after) => after.files.find(file => file.id === id)?.revision !== revision ? `Replaced ${after.files.find(file => file.id === id)?.name ?? 'a project file'}.` : undefined)
  },
  remove: async ids => {
    const epoch = useProjectStore.getState().workspaceEpoch
    await withCatalogue(lease => window.electronAPI.projectFiles.remove(ids, lease), (before, after) => { const count = before.files.filter(file => ids.includes(file.id) && !after.files.some(current => current.id === file.id)).length; return count ? `Removed ${count} ${count === 1 ? 'file' : 'files'} from the project. Originals on disk are kept.` : undefined })
    if (epoch === useProjectStore.getState().workspaceEpoch) set({ undoAvailable: true })
  },
  undo: async () => {
    const epoch = useProjectStore.getState().workspaceEpoch
    await withCatalogue(lease => window.electronAPI.projectFiles.undo(lease), (before, after) => after.files.length > before.files.length ? `Restored ${after.files.length - before.files.length} removed project files.` : undefined)
    if (epoch === useProjectStore.getState().workspaceEpoch) set({ undoAvailable: false })
  },
  reindex: ids => withCatalogue(lease => window.electronAPI.projectFiles.reindex(ids, lease), before => { const count = before.files.filter(file => !ids || ids.includes(file.id)).length; return count ? `Requested reindexing for ${count} ${count === 1 ? 'file' : 'files'}.` : undefined }),
  exportFile: async id => {
    const epoch = useProjectStore.getState().workspaceEpoch, file = entry(id)
    const lease = await window.electronAPI.context.lease()
    if (epoch !== useProjectStore.getState().workspaceEpoch) return
    const exported = await window.electronAPI.projectFiles.exportFile(id, file.revision, lease.id)
    if (exported && epoch === useProjectStore.getState().workspaceEpoch) useSessionStore.getState().addConsoleEntry('info', `[Project Files] Exported the original ${file.name}.`)
  },
  cancel: async () => {
    const operation = get().catalogue.operation
    if (!operation) return
    const epoch = useProjectStore.getState().workspaceEpoch
    const lease = await window.electronAPI.context.lease()
    if (epoch !== useProjectStore.getState().workspaceEpoch) return
    await window.electronAPI.projectFiles.cancel(operation.id, lease.id)
  },
  recover: async id => {
    const original = useProjectStore.getState()
    const { saveProjectAs } = await import('@/lib/project-persistence')
    if (!await saveProjectAs()) return
    const current = useProjectStore.getState()
    if (current.workspaceEpoch !== original.workspaceEpoch) return
    if (current.projectId === original.projectId) throw new Error('Choose a different project path in Save As to recover this draft without replacing the source project.')
    await withCatalogue(lease => window.electronAPI.projectFiles.recoverIntoCopy(id, lease), () => 'Recovered the file draft into a new project. Save the project to include it in the bundle.')
  },
  setIncludeHidden: (id, enabled) => {
    const revision = entry(id).revision
    return withCatalogue(lease => window.electronAPI.projectFiles.setIncludeHidden(id, revision, enabled, lease), () => `${enabled ? 'Included' : 'Excluded'} hidden workbook contents for the assistant on this device; reindexing requested.`)
  },
  linkFolder: async (path, name) => {
    if (!await ensureNamedProject()) return
    await withCatalogue(lease => window.electronAPI.projectFiles.linkFolder(lease, path, name), (before, after) => {
      const count = (after.linkedFolders?.length ?? 0) - (before.linkedFolders?.length ?? 0)
      return count > 0 ? `Linked ${count} ${count === 1 ? 'folder' : 'folders'}. Originals remain outside the project bundle.` : undefined
    })
  },
  createFolder: async (name, parentPath, label) => {
    if (!await ensureNamedProject()) return
    await withCatalogue(lease => window.electronAPI.projectFiles.createFolder(lease, name, parentPath, label), (before, after) => (after.linkedFolders?.length ?? 0) > (before.linkedFolders?.length ?? 0) ? `Created and linked folder ${label || name}. Originals remain outside the project bundle.` : undefined)
  },
  rescanFolders: ids => withCatalogue(lease => window.electronAPI.projectFiles.rescanFolders(ids, lease), before => {
    const count = (before.linkedFolders ?? []).filter(folder => !ids || ids.includes(folder.id)).length
    return count ? `Rescanned ${count} linked ${count === 1 ? 'folder' : 'folders'}. Changed files are indexed separately.` : undefined
  }),
  forgetFolder: id => withCatalogue(lease => window.electronAPI.projectFiles.forgetFolder(id, lease), (before, after) => before.linkedFolders?.some(folder => folder.id === id) && !after.linkedFolders?.some(folder => folder.id === id) ? 'Forgot the linked folder. Files on disk are kept.' : undefined),
  relinkFolder: (id, path) => withCatalogue(lease => window.electronAPI.projectFiles.relinkFolder(id, lease, path), (_before, after) => after.linkedFolders?.find(folder => folder.id === id)?.status === 'ready' ? 'Relinked the folder on this device and rescanned its files.' : undefined),
  renameLinkedFolder: (id, name) => withCatalogue(lease => window.electronAPI.projectFiles.renameLinkedFolder(id, name, lease), (before, after) => before.linkedFolders?.find(folder => folder.id === id)?.name !== after.linkedFolders?.find(folder => folder.id === id)?.name ? `Renamed the linked folder label to ${name}. Its directory on disk is unchanged.` : undefined),
}))
