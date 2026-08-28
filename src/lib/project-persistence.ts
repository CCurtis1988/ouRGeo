// Project workflow: save/load a portable `.ourgeoproj` bundle (R env snapshot +
// full ouRGeo UI state) and manage the temp scratch project. The bundle zip is
// packed/unpacked in the Electron main process (see electron/main/ipc.ts); this
// module owns collecting/hydrating the renderer state and driving the R server.

import { rClient, type DbReconnectEntry, type RgeoObjectInfo } from '@/lib/r-client'
import {
  buildSessionData,
  applySessionData,
  loadSession,
  saveSessionImmediate,
  type SessionData,
} from '@/lib/session-persistence'
import {
  buildWorkspaceData,
  applyWorkspaceData,
  type WorkspaceData,
} from '@/lib/workspace-persistence'
import { createJsonFileStore } from '@/lib/persistence'
import { pruneStaleObjectTabs } from '@/lib/reconnect-r'
import { rehydrateRasterLayers } from '@/lib/raster-layers'
import { useProjectStore, SCRATCH_PROJECT_NAME, type RecentProject } from '@/store/project'
import { useEditorStore, type TabState } from '@/store/editor'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore, normalizePersistedPlots, type PlotEntry } from '@/store/plotting'
import { useSessionStore } from '@/store/session'
import { useEnvironmentStore } from '@/store/environment'
import { usePackagesStore } from '@/store/packages'
import { useDatabaseStore } from '@/store/database'
import { retryOnNetworkError } from '@/lib/transport-retry'

const PROJECT_VERSION = 1

interface ProjectManifest {
  version: number
  name: string
  savedAt: string
  ui: {
    session: SessionData
    workspace: WorkspaceData
    // `plots` is read through normalizePersistedPlots, which also accepts the
    // legacy `string[]` shape written by bundles saved before plot ids existed.
    plots: { plots: PlotEntry[]; currentIndex: number }
  }
  databases: DbReconnectEntry[]
}

const recentsStore = createJsonFileStore('recent-projects.json', 'Recents')

// ── Dirty tracking ────────────────────────────────────────────────────────────
// Env/UI-state changes flip the project dirty flag (drives the exit/switch save
// prompt). Disabled until the app has finished its startup restore, and
// suppressed while we ourselves hydrate stores during load/new.
let dirtyEnabled = false

export function enableDirtyTracking(): void {
  dirtyEnabled = true
}

async function withDirtySuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const prev = dirtyEnabled
  dirtyEnabled = false
  try {
    return await fn()
  } finally {
    dirtyEnabled = prev
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────
function baseName(filePath: string): string {
  const file = filePath.split(/[\\/]/).pop() ?? filePath
  return file.replace(/\.ourgeoproj$/i, '')
}

// The load flow fires a burst of R calls right after the project:unpack IPC
// gap, so the first can land on a keep-alive socket the R server already
// closed — see lib/transport-retry.ts for why that reads as "Network Error".

// ── Collect / apply ───────────────────────────────────────────────────────────
async function collectDatabases(): Promise<DbReconnectEntry[]> {
  const byFile = new Map<string, { varName: string; name: string }[]>()
  try {
    const res = await rClient.dbProxies()
    for (const p of res.proxies ?? []) {
      if (!p.filePath) continue
      const arr = byFile.get(p.filePath) ?? []
      arr.push({ varName: p.varName, name: p.name })
      byFile.set(p.filePath, arr)
    }
  } catch {
    // R may be unavailable — save without proxy info.
  }
  // Include open databases even when they have no connected proxy objects, so
  // the DB panel's open state is restored on load.
  for (const fp of Object.keys(useDatabaseStore.getState().openDbs)) {
    if (!byFile.has(fp)) byFile.set(fp, [])
  }
  return [...byFile].map(([filePath, proxies]) => ({ filePath, proxies }))
}

function buildManifest(name: string, databases: DbReconnectEntry[]): ProjectManifest {
  const p = usePlottingStore.getState()
  return {
    version: PROJECT_VERSION,
    name,
    savedAt: new Date().toISOString(),
    ui: {
      session: buildSessionData(),
      workspace: buildWorkspaceData(),
      plots: { plots: p.plots, currentIndex: p.currentIndex },
    },
    databases,
  }
}

async function applyUiState(ui: ProjectManifest['ui']): Promise<void> {
  if (ui.session) await applySessionData(ui.session)
  if (ui.workspace) applyWorkspaceData(ui.workspace)
  if (ui.plots) {
    const plots = normalizePersistedPlots(ui.plots.plots)
    usePlottingStore.setState({
      plots,
      currentIndex: Math.min(ui.plots.currentIndex ?? plots.length - 1, plots.length - 1),
      isOpen: plots.length > 0,
    })
  }
}

// Reset the non-code UI stores to empty. Code/scratch tabs are handled by the
// caller (load hydrates them from the bundle; new restores temp's scratch).
// R-side env/db state is cleared separately via rClient.sessionReset().
function clearWorkspaceStores(): void {
  useSpatialStore.setState({ layers: [], selectedLayerId: null, viewBbox: null })
  usePlottingStore.setState({ plots: [], currentIndex: -1 })
  useSessionStore.setState({ consoleHistory: [], consoleInputHistory: [] })
  useEnvironmentStore.setState({ environments: [] })
  useDatabaseStore.setState({ openDbs: {} })
}

// Reset the editor to a single blank scratch tab (used when temp has no
// persisted session to restore).
function resetToBlankScratch(): void {
  const scratch: TabState = {
    id: crypto.randomUUID(),
    filePath: null,
    fileName: 'Untitled-1',
    content: '',
    savedContent: '',
    isDirty: false,
    type: 'code',
  }
  useEditorStore.getState().loadFromSession({ tabs: [scratch], activeTabId: scratch.id, untitledCounter: 1 })
}

// Pull the live R environment + package lists back into their panels after a
// reset / env load (the R session changed underneath the renderer).
async function refreshRPanels(): Promise<void> {
  try {
    const res = await retryOnNetworkError(() => rClient.listEnvironments())
    if (res.success) useEnvironmentStore.getState().setEnvironments(res.environments)
  } catch {
    // R may be unavailable.
  }
  try {
    await usePackagesStore.getState().refreshPackages()
  } catch {
    // ignore
  }
}

async function reconnectDatabases(databases: DbReconnectEntry[]): Promise<void> {
  if (!databases.length) return
  const res = await retryOnNetworkError(() => rClient.dbReconnect(databases))
  const handles = res.handles ?? {}
  const store = useDatabaseStore.getState()
  for (const [filePath, handle] of Object.entries(handles)) {
    let objects: RgeoObjectInfo[] = []
    try {
      const list = await rClient.dbListObjects(handle)
      if (list.success) objects = list.objects ?? []
    } catch {
      // keep empty
    }
    store.setOpenDb({ filePath, handle, objects, expanded: true })
  }
  if (res.errors?.length) {
    useSessionStore.getState().addConsoleEntry('error', `Database reconnect: ${res.errors.join('; ')}`)
  }
}

// ── Recents ───────────────────────────────────────────────────────────────────
export async function loadRecentProjects(): Promise<void> {
  try {
    const data = await recentsStore.read<{ recents?: RecentProject[] }>()
    if (Array.isArray(data.recents)) useProjectStore.getState().setRecents(data.recents)
  } catch {
    // no recents yet
  }
}

function persistRecents(recents: RecentProject[]): void {
  void recentsStore.write({ recents })
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveProjectToPath(path: string): Promise<boolean> {
  const name = baseName(path)

  // Snapshot the R environment to a temp .RData that the packer folds into the
  // bundle. If R is down or the save fails, pack without an env snapshot.
  let envPath: string | null = null
  try {
    const tmp = await window.electronAPI.project.tempEnvPath()
    // excludeSystem: snapshot only user objects, not the server's own functions.
    const res = await rClient.envSave(['.GlobalEnv'], tmp, undefined, true)
    if (res.success !== false) envPath = tmp
  } catch {
    envPath = null
  }

  const databases = await collectDatabases()
  const manifest = buildManifest(name, databases)

  await window.electronAPI.project.pack(path, JSON.stringify(manifest), envPath)

  const store = useProjectStore.getState()
  store.setCurrent(name, path)
  store.clearDirty()
  persistRecents(store.pushRecent({ name, path }))
  useSessionStore.getState().addConsoleEntry('info', `Project saved: ${path}`)
  return true
}

/** Save to the current project's bundle; falls back to Save As for temp. */
export async function saveCurrentProject(): Promise<boolean> {
  const { path } = useProjectStore.getState()
  if (path) return saveProjectToPath(path)
  return saveProjectAs()
}

/** Prompt for a bundle location and save there. Returns false if cancelled. */
export async function saveProjectAs(): Promise<boolean> {
  const { name } = useProjectStore.getState()
  const defaultName = name === SCRATCH_PROJECT_NAME ? undefined : name
  const path = await window.electronAPI.dialog.saveProject(defaultName)
  if (!path) return false
  return saveProjectToPath(path)
}

// ── Load ──────────────────────────────────────────────────────────────────────
/** Open a `.ourgeoproj` bundle: reset R + UI, hydrate state, reconnect DBs. */
export async function loadProjectFromPath(path: string): Promise<boolean> {
  let manifest: ProjectManifest
  let envRDataPath: string | null
  try {
    const unpacked = await window.electronAPI.project.unpack(path)
    manifest = JSON.parse(unpacked.projectJson) as ProjectManifest
    envRDataPath = unpacked.envRDataPath
  } catch (err) {
    useSessionStore.getState().addConsoleEntry('error', `Failed to open project: ${String(err)}`)
    return false
  }

  const name = baseName(path)
  // Switch to the named project up-front so the gated session autosave leaves
  // temp's session.json untouched while we hydrate this bundle's code tabs.
  useProjectStore.getState().setCurrent(name, path)

  await withDirtySuppressed(async () => {
    try {
      await retryOnNetworkError(() => rClient.sessionReset())
    } catch {
      // R may be unavailable — still hydrate the UI.
    }
    clearWorkspaceStores()

    // Load the R env BEFORE applying UI state, so a spatial layer's backing R
    // object already exists when the editor renders it.
    if (envRDataPath) {
      try {
        const res = await retryOnNetworkError(() => rClient.envLoad(envRDataPath as string, '.GlobalEnv'))
        if (res.rdataLoadedNames?.length) {
          useEnvironmentStore.getState().addRdataLoadedNames('.GlobalEnv', res.rdataLoadedNames)
        }
      } catch (err) {
        useSessionStore.getState().addConsoleEntry('error', `Failed to load environment: ${String(err)}`)
      }
    }

    try {
      await reconnectDatabases(manifest.databases ?? [])
    } catch (err) {
      useSessionStore.getState().addConsoleEntry('error', `Database reconnect failed: ${String(err)}`)
    }

    await applyUiState(manifest.ui)
    // Refresh panels after env load + DB reconnect so they reflect the rebound
    // proxies and restored objects.
    await refreshRPanels()
    await pruneStaleObjectTabs()
    // Raster map layers reference session-scoped server registrations —
    // re-register them against the just-restored env objects.
    await rehydrateRasterLayers()
  })

  const store = useProjectStore.getState()
  store.clearDirty()
  persistRecents(store.pushRecent({ name, path }))
  useSessionStore.getState().addConsoleEntry('info', `Project loaded: ${name}`)
  return true
}

/** Prompt for a bundle and load it. Returns false if cancelled. */
export async function loadProject(): Promise<boolean> {
  const path = await window.electronAPI.dialog.openProject()
  if (!path) return false
  return loadProjectFromPath(path)
}

// ── New ───────────────────────────────────────────────────────────────────────
/**
 * Return to a clean scratch project: wipe the R env + all UI state, and restore
 * scratch's persisted code/.R tabs (scratch is the always-available workspace).
 */
export async function newProject(): Promise<void> {
  // Back to scratch up-front so restoring its tabs writes to scratch's session.json.
  useProjectStore.getState().setCurrent(SCRATCH_PROJECT_NAME, null)
  await withDirtySuppressed(async () => {
    try {
      await rClient.sessionReset()
    } catch {
      // R may be unavailable
    }
    clearWorkspaceStores()
    const restored = await loadSession()
    if (!restored) resetToBlankScratch()
    await refreshRPanels()
  })
  useProjectStore.getState().clearDirty()
  saveSessionImmediate()
}

// ── Dirty-tracking wiring ─────────────────────────────────────────────────────
export function setupProjectTracking(): () => void {
  const mark = (): void => {
    if (dirtyEnabled) useProjectStore.getState().markDirty()
  }

  const unsubEnv = useEnvironmentStore.subscribe((s, p) => {
    if (s.environments !== p.environments) mark()
  })
  const unsubSpatial = useSpatialStore.subscribe((s, p) => {
    if (s.layers !== p.layers) mark()
  })
  const unsubPlots = usePlottingStore.subscribe((s, p) => {
    if (s.plots !== p.plots) mark()
  })
  const unsubTabs = useEditorStore.subscribe((s, p) => {
    // Only object-backed tabs count toward project dirtiness; code/scratch tabs
    // always persist via session.json regardless of the save prompt.
    if (s.tabs !== p.tabs) {
      const objs = (t: TabState): boolean => !!t.type && t.type !== 'code'
      if (s.tabs.filter(objs).length !== p.tabs.filter(objs).length) mark()
    }
  })

  return () => {
    unsubEnv(); unsubSpatial(); unsubPlots(); unsubTabs()
  }
}
