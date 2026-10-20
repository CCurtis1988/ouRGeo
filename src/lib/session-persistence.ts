import { useEditorStore, type TabState } from '@/store/editor'
import { getDataPath } from '@/lib/persistence'

export interface SessionData {
  tabs: TabState[]
  activeTabId: string | null
  untitledCounter: number
  /** Each editor panel's own active tab, when the workspace has more than one
   *  editor. Absent in every session written before that was possible, which
   *  is why it is optional rather than defaulted. */
  activeByPanel?: Record<string, string | null>
}

async function getSessionPath(): Promise<string> {
  return `${await getDataPath()}/session.json`
}

// Shape the editor store's code tabs into the persisted session form. Reused by
// both session.json autosave and the project-workspace bundle.
export function buildSessionData(): SessionData {
  const state = useEditorStore.getState()
  // Only code tabs (.R files + untitled scratch) persist between sessions.
  // Object-backed tabs (data-viewer/function-editor) are session-scoped and
  // live in workspace-persistence, which is cleared on exit.
  const codeTabs = state.tabs.filter((t) => !t.type || t.type === 'code')
  const activeIsCode = codeTabs.some((t) => t.id === state.activeTabId)
  const ids = new Set(codeTabs.map((t) => t.id))
  const activeByPanel: Record<string, string | null> = {}
  for (const [panel, id] of Object.entries(state.activeByPanel)) {
    // Object-backed tabs are session-scoped and live in workspace-persistence,
    // so a panel showing one has no code tab to restore as its active.
    if (id && ids.has(id)) activeByPanel[panel] = id
  }
  return {
    tabs: codeTabs,
    activeTabId: activeIsCode ? state.activeTabId : (codeTabs[0]?.id ?? null),
    untitledCounter: state.untitledCounter,
    activeByPanel,
  }
}

// Restore code tabs from a SessionData object, re-reading file-backed tabs from
// disk. Reused by session.json load and project load. Returns false if empty.
export async function applySessionData(data: SessionData, options: { portable?: boolean; authorisedFileLinks?: import('@/lib/context/types').AuthorisedFileLink[] } = {}): Promise<boolean> {
  if (!data.tabs || data.tabs.length === 0) return false

  // Defensive: only code tabs belong here (object tabs are restored separately).
  const codeTabs = data.tabs.filter((t) => !t.type || t.type === 'code')
  if (codeTabs.length === 0) return false

  // Re-read file-backed tabs from disk to pick up external changes.
  const restoredTabs: TabState[] = []
  for (const tab of codeTabs) {
    if (options.portable && tab.filePath && !options.authorisedFileLinks?.some(link => link.id === tab.id && link.filePath === tab.filePath)) {
      restoredTabs.push({ ...tab, filePath: null, isDirty: true })
    } else if (tab.filePath) {
      try {
        const diskContent = await window.electronAPI.file.read(tab.filePath)
        // Unsaved edits are project content (docs/project-persistence-spec.md
        // §1.1): they come back as edits against the file as it is NOW, so
        // the tab is dirty exactly when the two differ.
        restoredTabs.push(tab.isDirty && typeof tab.content === 'string'
          ? { ...tab, savedContent: diskContent, isDirty: tab.content !== diskContent }
          : { ...tab, content: diskContent, savedContent: diskContent, isDirty: false })
      } catch {
        // File no longer exists — keep the tab with its last known content
        restoredTabs.push({ ...tab, filePath: null, isDirty: true })
      }
    } else {
      restoredTabs.push(tab)
    }
  }

  if (restoredTabs.length === 0) return false

  const activeTabId = restoredTabs.find((t) => t.id === data.activeTabId)
    ? data.activeTabId
    : restoredTabs[0].id

  useEditorStore.getState().loadFromSession({
    tabs: restoredTabs,
    activeTabId,
    untitledCounter: data.untitledCounter || 1,
    activeByPanel: data.activeByPanel,
  })

  return true
}

/**
 * Scratch's documents before drafts existed. Read once, when scratch has no
 * draft yet, so an upgrade does not lose the tabs a user left open; scratch's
 * documents are written to its draft from then on (lib/project-draft.ts).
 */
export async function loadLegacySession(): Promise<SessionData | null> {
  try {
    const data = JSON.parse(await window.electronAPI.file.read(await getSessionPath())) as SessionData
    return Array.isArray(data.tabs) ? data : null
  } catch {
    return null
  }
}
