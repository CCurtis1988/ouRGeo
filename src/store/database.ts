import { create } from 'zustand'
import type { RgeoObjectInfo } from '@/lib/r-client'

export interface OpenDb {
  filePath: string
  handle: string
  objects: RgeoObjectInfo[]
  expanded: boolean
}

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
}

interface DatabaseState {
  isOpen: boolean
  searchQuery: string
  isLoading: boolean
  error: string | null

  workspaceFolder: string | null
  workspaceExpanded: boolean
  recents: string[]
  recentsExpanded: boolean

  folderEntries: Record<string, FsEntry[]>
  expandedFolders: Record<string, boolean>
  requestedLoadFile: string | null

  openDbs: Record<string, OpenDb>  // keyed by filePath

  toggleOpen: () => void
  setSearchQuery: (q: string) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void

  setWorkspaceFolder: (path: string | null) => void
  toggleWorkspaceExpanded: () => void
  setRecents: (files: string[]) => void
  toggleRecentsExpanded: () => void

  setFolderEntries: (path: string, entries: FsEntry[]) => void
  toggleFolderExpanded: (path: string) => void
  clearFolderTree: () => void
  setRequestedLoadFile: (path: string | null) => void

  setOpenDb: (db: OpenDb) => void
  removeOpenDb: (filePath: string) => void
  setObjects: (filePath: string, objects: RgeoObjectInfo[]) => void
  toggleDbExpanded: (filePath: string) => void
}

export const useDatabaseStore = create<DatabaseState>((set) => ({
  isOpen: false,
  searchQuery: '',
  isLoading: false,
  error: null,

  workspaceFolder: null,
  workspaceExpanded: true,
  recents: [],
  recentsExpanded: true,

  folderEntries: {},
  expandedFolders: {},
  requestedLoadFile: null,

  openDbs: {},

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  setWorkspaceFolder: (workspaceFolder) => set({ workspaceFolder }),
  toggleWorkspaceExpanded: () => set((s) => ({ workspaceExpanded: !s.workspaceExpanded })),
  setRecents: (recents) => set({ recents }),
  toggleRecentsExpanded: () => set((s) => ({ recentsExpanded: !s.recentsExpanded })),

  setFolderEntries: (path, entries) => set((s) => ({
    folderEntries: { ...s.folderEntries, [path]: entries }
  })),
  toggleFolderExpanded: (path) => set((s) => ({
    expandedFolders: { ...s.expandedFolders, [path]: !s.expandedFolders[path] }
  })),
  clearFolderTree: () => set({ folderEntries: {}, expandedFolders: {} }),
  setRequestedLoadFile: (requestedLoadFile) => set({ requestedLoadFile }),

  setOpenDb: (db) => set((s) => ({ openDbs: { ...s.openDbs, [db.filePath]: db } })),
  removeOpenDb: (filePath) => set((s) => {
    const next = { ...s.openDbs }
    delete next[filePath]
    return { openDbs: next }
  }),
  setObjects: (filePath, objects) => set((s) => {
    const existing = s.openDbs[filePath]
    if (!existing) return s
    return { openDbs: { ...s.openDbs, [filePath]: { ...existing, objects } } }
  }),
  toggleDbExpanded: (filePath) => set((s) => {
    const existing = s.openDbs[filePath]
    if (!existing) return s
    return {
      openDbs: { ...s.openDbs, [filePath]: { ...existing, expanded: !existing.expanded } }
    }
  }),
}))
