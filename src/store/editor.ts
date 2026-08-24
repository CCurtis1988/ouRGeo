import { create } from 'zustand'

let externalUpdateVersion = 0

export type TabType = 'code' | 'data-viewer' | 'function-editor'

export interface TabState {
  id: string
  filePath: string | null
  fileName: string
  content: string
  savedContent: string
  isDirty: boolean
  type: TabType
  objectName?: string
  envName?: string
  objectClass?: string
  accessPath?: string
}

interface EditorStore {
  tabs: TabState[]
  activeTabId: string | null
  untitledCounter: number
  externalContentUpdate: { tabId: string; content: string; version: number } | null

  addTab(filePath?: string | null, content?: string, fileName?: string): string
  addObjectTab(objectName: string, envName: string, objectClass: string, accessPath: string, type: TabType): string
  closeTab(id: string): void
  setActiveTab(id: string): void
  updateTabContent(id: string, content: string): void
  markTabSaved(id: string, filePath: string, content: string): void
  updateTabObjectClass(id: string, objectClass: string): void
  applyExternalContent(tabId: string, content: string): void
  getActiveTab(): TabState | undefined
  findTabByPath(filePath: string): TabState | undefined
  loadFromSession(data: {
    tabs: TabState[]
    activeTabId: string | null
    untitledCounter: number
  }): void
  /** Drop restored object-backed tabs whose R object no longer exists. */
  pruneObjectTabs(existing: Set<string>): void
  /** Append session-scoped object tabs restored from the workspace store. */
  appendRestoredObjectTabs(tabs: TabState[]): void
}

function makeUntitledTab(counter: number, content = ''): TabState {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    fileName: `Untitled-${counter}`,
    content,
    savedContent: '',
    isDirty: content !== '',
    type: 'code'
  }
}

const initialTab = makeUntitledTab(1)

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  untitledCounter: 1,
  externalContentUpdate: null,

  addTab(filePath = null, content = '', fileName?: string) {
    const state = get()

    // If opening a file that's already open, switch to it
    if (filePath) {
      const existing = state.tabs.find((t) => t.filePath === filePath)
      if (existing) {
        set({ activeTabId: existing.id })
        return existing.id
      }
    }

    let tab: TabState
    if (filePath) {
      const name = fileName || filePath.split(/[\\/]/).pop() || 'Unknown'
      tab = {
        id: crypto.randomUUID(),
        filePath,
        fileName: name,
        content,
        savedContent: content,
        isDirty: false,
        type: 'code'
      }
      set({ tabs: [...state.tabs, tab], activeTabId: tab.id })
    } else {
      const counter = state.untitledCounter + 1
      tab = makeUntitledTab(counter, content)
      set({ tabs: [...state.tabs, tab], activeTabId: tab.id, untitledCounter: counter })
    }

    return tab.id
  },

  addObjectTab(objectName, envName, objectClass, accessPath, type) {
    const state = get()

    // Deduplicate by accessPath + envName
    const existing = state.tabs.find(
      (t) => t.accessPath === accessPath && t.envName === envName && t.type === type
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return existing.id
    }

    const displayName =
      type === 'function-editor'
        ? `${objectName}()`
        : `${objectName} [${objectClass}]`

    const tab: TabState = {
      id: crypto.randomUUID(),
      filePath: null,
      fileName: displayName,
      content: '',
      savedContent: '',
      isDirty: false,
      type,
      objectName,
      envName,
      objectClass,
      accessPath
    }

    set({ tabs: [...state.tabs, tab], activeTabId: tab.id })
    return tab.id
  },

  closeTab(id) {
    const state = get()
    const idx = state.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return

    const newTabs = state.tabs.filter((t) => t.id !== id)

    if (newTabs.length === 0) {
      const counter = state.untitledCounter + 1
      const tab = makeUntitledTab(counter)
      set({ tabs: [tab], activeTabId: tab.id, untitledCounter: counter })
      return
    }

    let newActiveId = state.activeTabId
    if (state.activeTabId === id) {
      const newIdx = Math.min(idx, newTabs.length - 1)
      newActiveId = newTabs[newIdx].id
    }

    set({ tabs: newTabs, activeTabId: newActiveId })
  },

  setActiveTab(id) {
    set({ activeTabId: id })
  },

  updateTabContent(id, content) {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, content, isDirty: content !== t.savedContent } : t
      )
    }))
  },

  markTabSaved(id, filePath, content) {
    const fileName = filePath.split(/[\\/]/).pop() || 'Unknown'
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, filePath, fileName, content, savedContent: content, isDirty: false }
          : t
      )
    }))
  },

  updateTabObjectClass(id, objectClass) {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, objectClass, fileName: `${t.objectName} [${objectClass}]` }
          : t
      )
    }))
  },

  applyExternalContent(tabId, content) {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: content !== t.savedContent } : t
      ),
      externalContentUpdate: { tabId, content, version: ++externalUpdateVersion },
    }))
  },

  getActiveTab() {
    const state = get()
    return state.tabs.find((t) => t.id === state.activeTabId)
  },

  findTabByPath(filePath) {
    return get().tabs.find((t) => t.filePath === filePath)
  },

  loadFromSession(data) {
    set({
      tabs: data.tabs,
      activeTabId: data.activeTabId,
      untitledCounter: data.untitledCounter
    })
  },

  pruneObjectTabs(existing) {
    const state = get()
    const kept = state.tabs.filter(
      (t) => !t.type || t.type === 'code' || (t.objectName ? existing.has(t.objectName) : false)
    )
    if (kept.length === state.tabs.length) return
    if (kept.length === 0) {
      const counter = state.untitledCounter + 1
      const tab = makeUntitledTab(counter)
      set({ tabs: [tab], activeTabId: tab.id, untitledCounter: counter })
      return
    }
    const activeTabId = kept.some((t) => t.id === state.activeTabId) ? state.activeTabId : kept[0].id
    set({ tabs: kept, activeTabId })
  },

  appendRestoredObjectTabs(tabs) {
    if (tabs.length === 0) return
    set((state) => {
      const existingIds = new Set(state.tabs.map((t) => t.id))
      const toAdd = tabs.filter((t) => t.type && t.type !== 'code' && !existingIds.has(t.id))
      return toAdd.length ? { tabs: [...state.tabs, ...toAdd] } : state
    })
  }
}))
