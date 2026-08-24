// Full-workspace persistence: restores spatial layers and console history across
// reloads (renderer crash recovery) and restarts.
//
// These stores are self-contained — their data (geojson, console text) lives in
// the store, not in the live R session — so they can be restored unconditionally.
// Object-backed editor tabs are handled separately in session-persistence.ts
// (they need the R object to still exist).
//
// Files are split so a frequent, cheap change (a map pan, a console line) never
// rewrites the large layer geojson:
//   spatial-layers.json — the layer array (writes only when layers change)
//   spatial-ui.json     — view state + legend/north-arrow settings (small)
//   console.json        — console + input history (capped)

import { useSpatialStore } from '@/store/spatial'
import { useSessionStore, type ConsoleEntry } from '@/store/session'
import { useEditorStore, type TabState } from '@/store/editor'
import { getDataPath } from '@/lib/persistence'

const MAX_CONSOLE = 500
const MAX_INPUT_HISTORY = 200

const pathFor = async (name: string): Promise<string> => `${await getDataPath()}/${name}`

async function writeJson(name: string, data: unknown): Promise<void> {
  try {
    await window.electronAPI.file.write(await pathFor(name), JSON.stringify(data))
  } catch (err) {
    console.warn(`[Workspace] Failed to save ${name}:`, err)
  }
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await window.electronAPI.file.read(await pathFor(name))) as T
  } catch {
    return null
  }
}

// A small debounce factory so each concern coalesces its own writes.
function debouncer(fn: () => void, ms: number): { trigger: () => void; cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => { if (t) { clearTimeout(t); t = null } }
  return {
    trigger: () => { cancel(); t = setTimeout(fn, ms) },
    cancel,
  }
}

// ── Save slices ─────────────────────────────────────────────────────────────
function saveLayers(): void {
  void writeJson('spatial-layers.json', { layers: useSpatialStore.getState().layers })
}

function saveSpatialUi(): void {
  const s = useSpatialStore.getState()
  void writeJson('spatial-ui.json', {
    selectedLayerId: s.selectedLayerId,
    viewState: s.viewState,
    viewBbox: s.viewBbox,
    isOpen: s.isOpen,
    showLegend: s.showLegend,
    showNorthArrow: s.showNorthArrow,
    legendSettings: s.legendSettings,
    northArrowSettings: s.northArrowSettings,
  })
}

function saveConsole(): void {
  const s = useSessionStore.getState()
  void writeJson('console.json', {
    history: s.consoleHistory.slice(-MAX_CONSOLE),
    inputHistory: s.consoleInputHistory.slice(-MAX_INPUT_HISTORY),
  })
}

// Object-backed editor tabs (data-viewer / function-editor) are session-scoped —
// kept for reload recovery, cleared on exit (unlike code tabs in session.json).
function saveObjectTabs(): void {
  const tabs = useEditorStore.getState().tabs.filter((t) => t.type && t.type !== 'code')
  void writeJson('object-tabs.json', { tabs })
}

// ── Restore ─────────────────────────────────────────────────────────────────
interface LayersFile { layers?: unknown[] }
interface SpatialUiFile {
  selectedLayerId?: string | null
  viewState?: { longitude: number; latitude: number; zoom: number }
  viewBbox?: [number, number, number, number] | null
  isOpen?: boolean
  showLegend?: boolean
  showNorthArrow?: boolean
  legendSettings?: unknown
  northArrowSettings?: unknown
}
interface ConsoleFile { history?: ConsoleEntry[]; inputHistory?: string[] }
interface ObjectTabsFile { tabs?: TabState[] }

// The workspace slices assembled into one object — the shape the project bundle
// stores under `ui`. Reused so project save/load and the split-file autosave/
// restore share a single serialization/hydration path.
export interface WorkspaceData {
  layers?: unknown[]
  spatialUi?: SpatialUiFile
  console?: ConsoleFile
  objectTabs?: TabState[]
}

// Gather the current workspace slices from their stores (same shaping as the
// individual save* functions above).
export function buildWorkspaceData(): WorkspaceData {
  const s = useSpatialStore.getState()
  const sess = useSessionStore.getState()
  return {
    layers: s.layers,
    spatialUi: {
      selectedLayerId: s.selectedLayerId,
      viewState: s.viewState,
      viewBbox: s.viewBbox,
      isOpen: s.isOpen,
      showLegend: s.showLegend,
      showNorthArrow: s.showNorthArrow,
      legendSettings: s.legendSettings,
      northArrowSettings: s.northArrowSettings,
    },
    console: {
      history: sess.consoleHistory.slice(-MAX_CONSOLE),
      inputHistory: sess.consoleInputHistory.slice(-MAX_INPUT_HISTORY),
    },
    objectTabs: useEditorStore.getState().tabs.filter((t) => t.type && t.type !== 'code'),
  }
}

// Hydrate the workspace stores from a WorkspaceData object. Object tabs are
// appended (call after code tabs are set); callers then prune stale ones.
export function applyWorkspaceData(data: WorkspaceData): void {
  const layers = data.layers
  if (Array.isArray(layers) && layers.length > 0) {
    const patch: Record<string, unknown> = { layers, isOpen: true }
    const uiFile = data.spatialUi
    if (uiFile) {
      if (uiFile.selectedLayerId !== undefined) patch.selectedLayerId = uiFile.selectedLayerId
      if (uiFile.viewState) patch.viewState = uiFile.viewState
      if (uiFile.viewBbox !== undefined) patch.viewBbox = uiFile.viewBbox
      if (uiFile.isOpen !== undefined) patch.isOpen = uiFile.isOpen
      if (uiFile.showLegend !== undefined) patch.showLegend = uiFile.showLegend
      if (uiFile.showNorthArrow !== undefined) patch.showNorthArrow = uiFile.showNorthArrow
      if (uiFile.legendSettings) patch.legendSettings = uiFile.legendSettings
      if (uiFile.northArrowSettings) patch.northArrowSettings = uiFile.northArrowSettings
    }
    useSpatialStore.setState(patch as Partial<ReturnType<typeof useSpatialStore.getState>>)
  }

  if (data.console) {
    useSessionStore.setState({
      consoleHistory: data.console.history ?? [],
      consoleInputHistory: data.console.inputHistory ?? [],
    })
  }

  if (data.objectTabs && data.objectTabs.length > 0) {
    useEditorStore.getState().appendRestoredObjectTabs(data.objectTabs)
  }
}

export async function loadWorkspace(): Promise<void> {
  const [layersFile, uiFile, consoleFile, tabsFile] = await Promise.all([
    readJson<LayersFile>('spatial-layers.json'),
    readJson<SpatialUiFile>('spatial-ui.json'),
    readJson<ConsoleFile>('console.json'),
    readJson<ObjectTabsFile>('object-tabs.json'),
  ])

  applyWorkspaceData({
    layers: layersFile?.layers,
    spatialUi: uiFile ?? undefined,
    console: consoleFile ?? undefined,
    objectTabs: tabsFile?.tabs,
  })
}

// ── Autosave wiring ───────────────────────────────────────────────────────────
export function setupWorkspaceAutosave(): () => void {
  const layersSaver = debouncer(saveLayers, 1500)
  const uiSaver = debouncer(saveSpatialUi, 1000)
  const consoleSaver = debouncer(saveConsole, 2000)
  const tabsSaver = debouncer(saveObjectTabs, 1000)

  const unsubSpatial = useSpatialStore.subscribe((state, prev) => {
    if (state.layers !== prev.layers) layersSaver.trigger()
    if (
      state.viewState !== prev.viewState ||
      state.viewBbox !== prev.viewBbox ||
      state.selectedLayerId !== prev.selectedLayerId ||
      state.isOpen !== prev.isOpen ||
      state.showLegend !== prev.showLegend ||
      state.showNorthArrow !== prev.showNorthArrow ||
      state.legendSettings !== prev.legendSettings ||
      state.northArrowSettings !== prev.northArrowSettings
    ) uiSaver.trigger()
  })

  const unsubConsole = useSessionStore.subscribe((state, prev) => {
    if (
      state.consoleHistory !== prev.consoleHistory ||
      state.consoleInputHistory !== prev.consoleInputHistory
    ) consoleSaver.trigger()
  })

  const unsubTabs = useEditorStore.subscribe((state, prev) => {
    if (state.tabs !== prev.tabs) tabsSaver.trigger()
  })

  // No beforeunload flush here: these files are deleted on clean exit (see the
  // will-quit handler in electron/main/index.ts). Flushing on unload would race
  // that deletion and could leak session state into the next launch. The
  // debounced saves during the session are enough for reload/crash recovery.
  return () => {
    unsubSpatial(); unsubConsole(); unsubTabs()
    layersSaver.cancel(); uiSaver.cancel(); consoleSaver.cancel(); tabsSaver.cancel()
  }
}
