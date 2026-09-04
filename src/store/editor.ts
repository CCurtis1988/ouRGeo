import { create } from 'zustand'
import { type DocLanguage, languageForPath, defaultExtensionFor, starterContentFor } from '@/lib/markdown/doc-kind'
import type { PanelId } from '@/lib/layout/model'

/** The editor panel a tab with no `panelId` of its own belongs to. */
export const PRIMARY_EDITOR: PanelId = 'editor'

/** Which editor holds this tab. Absent means the original one — every tab
 *  written to session.json or a .ourgeoproj before a second editor was
 *  possible carries no field and must keep working. */
export function tabPanelId(tab: Pick<TabState, 'panelId'>): PanelId {
  return tab.panelId ?? PRIMARY_EDITOR
}

/** The tabs one editor panel shows, in order. */
export function tabsForPanel(tabs: TabState[], panelId: PanelId): TabState[] {
  return tabs.filter((t) => tabPanelId(t) === panelId)
}

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
  /**
   * Document language. Absent means 'r' — tabs written to session.json or a
   * .ourgeoproj before markdown support carry no field and must keep working.
   * This is a FIELD rather than a new TabType on purpose: TabType selects which
   * component renders, and it gates the `t.type === 'code'` predicates that
   * decide what persists. See src/lib/markdown/doc-kind.ts.
   */
  language?: DocLanguage
  /** Source (Monaco) vs Visual (WYSIWYG). Markdown documents only. */
  viewMode?: 'source' | 'visual'
  /**
   * Which editor panel shows this tab. Absent means the original editor, so a
   * session written before second editors existed reads back unchanged — the
   * same tolerance `language` needed, for the same reason.
   */
  panelId?: PanelId
}

interface EditorStore {
  tabs: TabState[]
  /**
   * The tab the user is looking at, across every editor panel.
   *
   * Kept as one value rather than becoming a map, because almost everything
   * that asks — Save, Knit, the AI's document tools, the recording target —
   * means "the one in front of me", and a second editor does not change that.
   * What a second editor needs is `activeByPanel`, which is what each panel
   * RENDERS: switching focus to the other editor must not disturb the tab this
   * one is showing.
   */
  activeTabId: string | null
  /** Each editor panel's own active tab. */
  activeByPanel: Record<PanelId, string | null>
  /** Where a newly opened tab goes: the editor the user last touched. */
  focusedEditor: PanelId
  untitledCounter: number
  externalContentUpdate: { tabId: string; content: string; version: number } | null

  addTab(filePath?: string | null, content?: string, fileName?: string): string
  /** New untitled markdown/R Markdown document, seeded with starter content. */
  newMarkdownTab(language: Exclude<DocLanguage, 'r'>): string
  /**
   * A named, not-yet-on-disk document — what the AI's write_document creates.
   * Named rather than "Untitled-N" so the model and the user refer to it by the
   * same word, and file-backed only once the user saves it.
   */
  newDocumentTab(fileName: string, content: string, language?: DocLanguage): string
  /** Change an open tab's language (the editor toolbar's language selector). */
  setTabLanguage(id: string, language: DocLanguage): void
  /** Toggle a markdown tab between Source and Visual editing. */
  setTabViewMode(id: string, viewMode: 'source' | 'visual'): void
  addObjectTab(objectName: string, envName: string, objectClass: string, accessPath: string, type: TabType): string
  closeTab(id: string): void
  setActiveTab(id: string): void
  /** Note which editor the user is working in — where the next tab opens. */
  focusEditor(panelId: PanelId): void
  /** Move one tab to another editor panel, and show it there. */
  moveTabToPanel(tabId: string, panelId: PanelId, index?: number): void
  /** Hand every tab of one editor panel to another — what removing an editor
   *  does, so no document is ever closed to close a panel. */
  adoptTabs(from: PanelId, to: PanelId): void
  /** Put back any tab pointing at an editor panel that no longer exists. */
  reclaimOrphanTabs(livePanels: PanelId[]): void
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
    /** Each editor panel's own active tab. Absent in sessions written before
     *  a second editor was possible. */
    activeByPanel?: Record<PanelId, string | null>
  }): void
  /** Drop restored object-backed tabs whose R object no longer exists. */
  pruneObjectTabs(existing: Set<string>): void
  /** Append session-scoped object tabs restored from the workspace store. */
  appendRestoredObjectTabs(tabs: TabState[]): void
}

function makeUntitledTab(counter: number, content = '', language: DocLanguage = 'r'): TabState {
  // Untitled R scripts keep their historic bare name; markdown docs carry the
  // extension so the tab reads as a document rather than a script.
  const suffix = language === 'r' ? '' : `.${defaultExtensionFor(language)}`
  return {
    id: crypto.randomUUID(),
    filePath: null,
    fileName: `Untitled-${counter}${suffix}`,
    content,
    savedContent: '',
    isDirty: content !== '',
    type: 'code',
    language
  }
}

const initialTab = makeUntitledTab(1)

/**
 * The three fields that have to move together when a tab is shown.
 *
 * Written once here rather than at each of the nine call sites, because the
 * invariant is easy to break by hand and silent when broken: a panel whose
 * `activeByPanel` entry names a tab that has moved elsewhere renders nothing
 * at all, and looks exactly like an editor that failed to load.
 */
function showing(
  state: Pick<EditorStore, 'activeByPanel'>, tabId: string, panel: PanelId,
): Pick<EditorStore, 'activeTabId' | 'activeByPanel' | 'focusedEditor'> {
  return {
    activeTabId: tabId,
    focusedEditor: panel,
    activeByPanel: { ...state.activeByPanel, [panel]: tabId },
  }
}

/**
 * Rebuild the per-panel actives from a fresh set of tabs.
 *
 * Used wherever the tab list is replaced wholesale — a restored session, a
 * project load, a prune — because after any of those `activeByPanel` may name
 * tabs that no longer exist, and a panel pointing at a missing tab renders
 * blank rather than complaining.
 */
function reindex(
  tabs: TabState[], want: string | null, prefer?: Record<PanelId, string | null>,
): Pick<EditorStore, 'activeTabId' | 'activeByPanel' | 'focusedEditor'> {
  const activeByPanel: Record<PanelId, string | null> = {}
  for (const t of tabs) {
    const p = tabPanelId(t)
    if (activeByPanel[p] === undefined) activeByPanel[p] = t.id
  }
  for (const [p, id] of Object.entries(prefer ?? {})) {
    if (id && activeByPanel[p] !== undefined && tabs.some((t) => t.id === id)) activeByPanel[p] = id
  }
  const active = tabs.find((t) => t.id === want) ?? tabs[0]
  if (active) activeByPanel[tabPanelId(active)] = active.id
  return {
    activeTabId: active?.id ?? null,
    activeByPanel,
    focusedEditor: active ? tabPanelId(active) : PRIMARY_EDITOR,
  }
}

/** Stamp a new tab with the editor it is opening in. The original editor is
 *  left unstamped so session.json keeps the shape older builds wrote. */
function stamp(tab: TabState, panel: PanelId): TabState {
  if (panel !== PRIMARY_EDITOR) tab.panelId = panel
  return tab
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  activeByPanel: { [PRIMARY_EDITOR]: initialTab.id },
  focusedEditor: PRIMARY_EDITOR,
  untitledCounter: 1,
  externalContentUpdate: null,

  addTab(filePath = null, content = '', fileName?: string) {
    const state = get()

    // If opening a file that's already open, switch to it
    if (filePath) {
      const existing = state.tabs.find((t) => t.filePath === filePath)
      if (existing) {
        // Opening a file that is already open shows it where it already is,
        // rather than dragging it into whichever editor has focus — the tab
        // the user is being taken to is the one they already had.
        set(showing(state, existing.id, tabPanelId(existing)))
        return existing.id
      }
    }

    let tab: TabState
    if (filePath) {
      const name = fileName || filePath.split(/[\\/]/).pop() || 'Unknown'
      tab = stamp({
        id: crypto.randomUUID(),
        filePath,
        fileName: name,
        content,
        savedContent: content,
        isDirty: false,
        type: 'code',
        language: languageForPath(filePath)
      }, state.focusedEditor)
      set({ tabs: [...state.tabs, tab], ...showing(state, tab.id, state.focusedEditor) })
    } else {
      const counter = state.untitledCounter + 1
      tab = stamp(makeUntitledTab(counter, content), state.focusedEditor)
      set({
        tabs: [...state.tabs, tab], untitledCounter: counter,
        ...showing(state, tab.id, state.focusedEditor),
      })
    }

    return tab.id
  },

  newMarkdownTab(language) {
    const state = get()
    const counter = state.untitledCounter + 1
    const title = `Untitled-${counter}`
    const tab = stamp(makeUntitledTab(counter, starterContentFor(language, title), language), state.focusedEditor)
    // Starter content is scaffolding, not the user's work — don't open dirty.
    tab.savedContent = tab.content
    tab.isDirty = false
    set({
      tabs: [...state.tabs, tab], untitledCounter: counter,
      ...showing(state, tab.id, state.focusedEditor),
    })
    return tab.id
  },

  newDocumentTab(fileName, content, language) {
    const tab: TabState = stamp({
      id: crypto.randomUUID(),
      filePath: null,
      fileName,
      content,
      savedContent: '',
      isDirty: content !== '',
      type: 'code',
      language: language ?? languageForPath(fileName),
    }, get().focusedEditor)
    set((state) => ({
      tabs: [...state.tabs, tab],
      ...showing(state, tab.id, state.focusedEditor),
    }))
    return tab.id
  },

  setTabLanguage(id, language) {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, language, viewMode: language === 'r' ? undefined : t.viewMode }
          : t
      )
    }))
  },

  setTabViewMode(id, viewMode) {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, viewMode } : t))
    }))
  },

  addObjectTab(objectName, envName, objectClass, accessPath, type) {
    const state = get()

    // Deduplicate by accessPath + envName
    const existing = state.tabs.find(
      (t) => t.accessPath === accessPath && t.envName === envName && t.type === type
    )
    if (existing) {
      set(showing(state, existing.id, tabPanelId(existing)))
      return existing.id
    }

    const displayName =
      type === 'function-editor'
        ? `${objectName}()`
        : `${objectName} [${objectClass}]`

    const tab: TabState = stamp({
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
    }, state.focusedEditor)

    set({ tabs: [...state.tabs, tab], ...showing(state, tab.id, state.focusedEditor) })
    return tab.id
  },

  closeTab(id) {
    const state = get()
    const closing = state.tabs.find((t) => t.id === id)
    if (!closing) return
    const panel = tabPanelId(closing)
    const here = tabsForPanel(state.tabs, panel)
    const idx = here.findIndex((t) => t.id === id)
    const newTabs = state.tabs.filter((t) => t.id !== id)

    // The workspace always has somewhere to type. Only when the LAST tab
    // anywhere closes — an empty second editor is a normal state, and one that
    // silently grew an Untitled-7 would be a panel the user cannot leave empty.
    if (newTabs.length === 0) {
      const counter = state.untitledCounter + 1
      const tab = makeUntitledTab(counter)
      set({ tabs: [tab], untitledCounter: counter, ...reindex([tab], tab.id) })
      return
    }

    const remaining = here.filter((t) => t.id !== id)
    const nextHere = remaining[Math.min(idx, remaining.length - 1)] ?? null
    const activeByPanel = { ...state.activeByPanel, [panel]: nextHere?.id ?? null }

    if (state.activeTabId !== id) {
      set({ tabs: newTabs, activeByPanel })
      return
    }
    // The tab in front of the user just went. Prefer its neighbour in the same
    // editor; only when that editor is now empty does focus move, and then it
    // follows the tab actually shown rather than staying on an empty panel.
    const fallback = nextHere ?? newTabs[0]
    set({
      tabs: newTabs,
      activeByPanel: { ...activeByPanel, [tabPanelId(fallback)]: fallback.id },
      activeTabId: fallback.id,
      focusedEditor: tabPanelId(fallback),
    })
  },

  setActiveTab(id) {
    const state = get()
    const tab = state.tabs.find((t) => t.id === id)
    if (!tab) return
    set(showing(state, id, tabPanelId(tab)))
  },

  focusEditor(panelId) {
    const state = get()
    if (state.focusedEditor === panelId) return
    const here = state.activeByPanel[panelId] ?? tabsForPanel(state.tabs, panelId)[0]?.id ?? null
    set({
      focusedEditor: panelId,
      activeByPanel: { ...state.activeByPanel, [panelId]: here },
      // An empty editor gets focus without changing what "the active tab"
      // means — Save and Knit still act on the document still on screen.
      activeTabId: here ?? state.activeTabId,
    })
  },

  moveTabToPanel(tabId, panelId, index) {
    const state = get()
    const tab = state.tabs.find((t) => t.id === tabId)
    if (!tab) return
    const from = tabPanelId(tab)
    const rest = state.tabs.filter((t) => t.id !== tabId)
    const moved: TabState = { ...tab }
    if (panelId === PRIMARY_EDITOR) delete moved.panelId
    else moved.panelId = panelId

    // Position is expressed within the DESTINATION panel, which is what the
    // drop indicator shows; `tabs` itself stays one flat list, so the insert
    // point has to be translated back into it.
    const target = tabsForPanel(rest, panelId)
    const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
    const anchor = target[at]
    const pos = anchor ? rest.findIndex((t) => t.id === anchor.id) : rest.length
    const tabs = [...rest.slice(0, pos), moved, ...rest.slice(pos)]

    const leftBehind = tabsForPanel(tabs, from)
    set({
      tabs,
      activeByPanel: {
        ...state.activeByPanel,
        [from]: state.activeByPanel[from] === tabId
          ? (leftBehind[Math.min(at, leftBehind.length - 1)]?.id ?? leftBehind[0]?.id ?? null)
          : state.activeByPanel[from],
        [panelId]: tabId,
      },
      activeTabId: tabId,
      focusedEditor: panelId,
    })
  },

  adoptTabs(from, to) {
    const state = get()
    const moving = tabsForPanel(state.tabs, from)
    if (moving.length === 0) return
    const ids = new Set(moving.map((t) => t.id))
    // Appended rather than interleaved: the arriving documents stay together
    // in the order they were in, so a user who has just lost a panel can still
    // see which tabs came from it.
    const kept = state.tabs.filter((t) => !ids.has(t.id))
    const arrived = moving.map((t) => {
      const next: TabState = { ...t }
      if (to === PRIMARY_EDITOR) delete next.panelId
      else next.panelId = to
      return next
    })
    const tabs = [...kept, ...arrived]
    // What the destination was showing wins; the arrivals sit behind it,
    // because removing a panel should not also change the document on screen.
    const keepShowing = state.activeByPanel[to] && tabs.some((t) => t.id === state.activeByPanel[to])
      ? state.activeByPanel[to]!
      : (state.activeByPanel[from] ?? arrived[0].id)
    const activeByPanel = { ...state.activeByPanel, [to]: keepShowing }
    delete activeByPanel[from]
    set({
      tabs,
      activeByPanel,
      activeTabId: state.activeTabId && tabs.some((t) => t.id === state.activeTabId)
        ? state.activeTabId : keepShowing,
      focusedEditor: state.focusedEditor === from ? to : state.focusedEditor,
    })
  },

  reclaimOrphanTabs(livePanels) {
    const state = get()
    const live = new Set(livePanels)
    const home = livePanels.includes(PRIMARY_EDITOR) ? PRIMARY_EDITOR : (livePanels[0] ?? PRIMARY_EDITOR)
    if (state.tabs.every((t) => live.has(tabPanelId(t)))) return
    // A session.json or a project bundle can name an editor this workspace no
    // longer has. Silently dropping those tabs would lose the user's work, so
    // they come back to the original editor instead.
    const tabs = state.tabs.map((t) => {
      if (live.has(tabPanelId(t))) return t
      const next: TabState = { ...t }
      if (home === PRIMARY_EDITOR) delete next.panelId
      else next.panelId = home
      return next
    })
    set({ tabs, ...reindex(tabs, state.activeTabId) })
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
    // The path just became authoritative, so re-derive the language from it —
    // saving an untitled doc as notes.md must make it a Markdown document, and
    // "Save As" to a different extension retypes the tab.
    const language = languageForPath(filePath)
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, filePath, fileName, content, savedContent: content, isDirty: false, language }
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
      untitledCounter: data.untitledCounter,
      ...reindex(data.tabs, data.activeTabId, data.activeByPanel),
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
      set({ tabs: [tab], untitledCounter: counter, ...reindex([tab], tab.id) })
      return
    }
    set({ tabs: kept, ...reindex(kept, state.activeTabId, state.activeByPanel) })
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
