import { useEditorStore, type TabState } from '@/store/editor'
import { useProjectStore } from '@/store/project'
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

let saveTimer: ReturnType<typeof setTimeout> | null = null

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
        restoredTabs.push({ ...tab, content: diskContent, savedContent: diskContent, isDirty: false })
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

export async function saveSession(): Promise<void> {
  // session.json holds the TEMP project's code tabs only. While a named project
  // is active its code tabs live in the .ourgeoproj bundle, so we leave temp's
  // scratch here untouched — that's what lets temp's scratch survive a switch to
  // another project and be there again when ouRGeo relaunches into temp.
  if (useProjectStore.getState().path !== null) return
  try {
    await window.electronAPI.file.write(await getSessionPath(), JSON.stringify(buildSessionData()))
  } catch (err) {
    console.warn('[Session] Failed to save:', err)
  }
}

export function saveSessionDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSession, 2000)
}

export function saveSessionImmediate(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveSession()
}

export async function loadSession(): Promise<boolean> {
  try {
    const raw = await window.electronAPI.file.read(await getSessionPath())
    return await applySessionData(JSON.parse(raw) as SessionData)
  } catch {
    // No session file or parse error — use defaults
    return false
  }
}

export function setupSessionAutosave(): () => void {
  const unsub = useEditorStore.subscribe((state, prevState) => {
    if (state.tabs !== prevState.tabs || state.activeTabId !== prevState.activeTabId) {
      // Content changes get debounced, structural changes save immediately
      const tabsChanged =
        state.tabs.length !== prevState.tabs.length ||
        state.activeTabId !== prevState.activeTabId
      if (tabsChanged) {
        saveSessionImmediate()
      } else {
        saveSessionDebounced()
      }
    }
  })

  const onBeforeUnload = (): void => {
    saveSessionImmediate()
  }
  window.addEventListener('beforeunload', onBeforeUnload)

  return () => {
    unsub()
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (saveTimer) clearTimeout(saveTimer)
  }
}
