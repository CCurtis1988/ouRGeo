// Project workflow: save/load a portable `.ourgeoproj` bundle (R env snapshot +
// full ouRGeo UI state) and manage the temp scratch project. The bundle zip is
// packed/unpacked in the Electron main process (see electron/main/ipc.ts); this
// module owns collecting/hydrating the renderer state and driving the R server.

import { useContextStore } from '@/store/context'
import { validateProjectContext, forkProjectContext } from '@/lib/context/memory-schema'
import type { ProjectContext, AuthorisedFileLink } from '@/lib/context/types'
import { createWorkspaceQueue } from '@/lib/context/transitions'
import { chatContentChanged } from '@/lib/context/disclosure-dialogue'
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
import { useAiStore } from '@/store/ai'
import { retryOnNetworkError } from '@/lib/transport-retry'
import {
  buildChatsData, applyChatsData, resetChats, type ChatsData,
} from '@/lib/ai-chats-persistence'

const PROJECT_VERSION = 1
const workspaceOperation = createWorkspaceQueue()

interface ProjectManifest {
  version: number
  projectId?: string
  context?: ProjectContext
  name: string
  savedAt: string
  ui: {
    session: SessionData
    workspace: WorkspaceData
    // `plots` is read through normalizePersistedPlots, which also accepts the
    // legacy `string[]` shape written by bundles saved before plot ids existed.
    plots: { plots: PlotEntry[]; currentIndex: number }
    /** The AI panel's conversations. Optional because every bundle written
     *  before chats were kept has no such key, and must still open — the same
     *  tolerance `activeByPanel` and `TabState.language` rely on. Absent means
     *  "this project has no chats", which is one empty one. */
    chats?: ChatsData
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

function buildManifest(name: string, databases: DbReconnectEntry[], projectId: string, context: ProjectContext): ProjectManifest {
  const p = usePlottingStore.getState()
  return {
    version: PROJECT_VERSION,
    projectId,
    context,
    name,
    savedAt: new Date().toISOString(),
    ui: {
      session: buildSessionData(),
      workspace: buildWorkspaceData(),
      plots: { plots: p.plots, currentIndex: p.currentIndex },
      chats: buildChatsData(),
    },
    databases,
  }
}

function applyProjectChats(ui: ProjectManifest['ui']): void {
  // A bundle from before chats existed carries none, and `clearWorkspaceStores`
  // has already left one empty conversation — which is the right answer for a
  // project that has never had any.
  const restoredChats = applyChatsData(ui.chats, true)
  const chatCount = Array.isArray(ui.chats?.chats) ? ui.chats.chats.length : 0
  const excludedChats = chatCount - (restoredChats ? useAiStore.getState().chats.length : 0)
  if (excludedChats > 0) useSessionStore.getState().addConsoleEntry('info', `${excludedChats} conversations were excluded because their records are malformed. The original bundle is unchanged; repair or restore it to recover those conversations.`)
  // Bundled provider IDs are neither delivery receipts nor authority to replay
  // old context. Reconstruct locally so newer exclusions and tombstones win.
  useAiStore.setState(state => ({ chats: state.chats.map(chat => ({ ...chat, claudeSessionId: null, lastSessionContext: null })) }))
}

async function applyUiState(ui: ProjectManifest['ui'], authorisedFileLinks: AuthorisedFileLink[] = []): Promise<void> {
  // A portable bundle names files from its author's machine. Opening it is
  // permission to use the bundled buffers, not to read those absolute paths.
  if (ui.session) {
    await applySessionData(ui.session, { portable: true, authorisedFileLinks })
    if (ui.session.tabs?.some(tab => tab.filePath && !authorisedFileLinks.some(link => link.id === tab.id && link.filePath === tab.filePath))) useSessionStore.getState().addConsoleEntry('info', 'Imported scripts use their bundled buffers. Choose Save As to link them to files on this device.')
  }
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
  // Conversations belong to the project they were held in. Carrying them into
  // the next one would put a chat about someone else's data in front of a user
  // who has just opened something unrelated.
  resetChats()
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
  return workspaceOperation(() => packProjectToPath(path))
}

async function packProjectToPath(path: string): Promise<boolean> {
  const name = baseName(path)
  const lease = useProjectStore.getState().workspaceEpoch
  const stillCurrent = (): boolean => useProjectStore.getState().workspaceEpoch === lease

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
  if (!stillCurrent()) throw new Error('SCOPE_CHANGED: project changed during save. Save the current project again.')
  const original = useProjectStore.getState()
  const projectId = !original.projectId || original.path !== path ? crypto.randomUUID() : original.projectId
  const draft = useContextStore.getState().projectContext
  const context = original.projectId !== projectId ? forkProjectContext(draft, projectId) : draft
  const manifest = buildManifest(name, databases, projectId, context)

  const { useColumnDisclosureStore } = await import('@/store/column-disclosure')
  const forkColumns = original.projectId === projectId ? null : { ...useColumnDisclosureStore.getState().selections }
  const packed = await window.electronAPI.project.pack(path, JSON.stringify(manifest), envPath)

  if (!stillCurrent()) return true
  for (const warning of packed?.contextWarnings ?? []) useSessionStore.getState().addConsoleEntry('info', warning)
  const savedLease = await window.electronAPI.context.lease()
  if (!stillCurrent() || savedLease.projectId !== projectId) return true
  useContextStore.setState({ projectLease: savedLease.id })
  const store = useProjectStore.getState()
  store.setCurrent(name, path)
  useProjectStore.setState({ projectId })
  if (original.projectId !== projectId) {
    // Save As opens an independent privacy/provider scope. Exclusions from
    // the original project are local settings, not inherited bundle content.
    useContextStore.setState(state => ({ excluded: [], savedExclusions: [], exclusionsLoaded: false, policyRevision: state.policyRevision + 1 }))
    useContextStore.getState().revokeDelivery()
  }
  if (forkColumns && Object.keys(forkColumns).length) {
    try {
      const currentPolicy = await window.electronAPI.context.columnPolicies(savedLease.id)
      if (JSON.stringify(currentPolicy.selections) !== JSON.stringify(forkColumns)) await window.electronAPI.context.saveColumnPolicies(currentPolicy.revision, forkColumns, savedLease.id)
    }
    catch (error) {
      useColumnDisclosureStore.setState({ selections: forkColumns, loaded: false, error: `Project saved, but column privacy could not be committed: ${String(error)}. Restore protected storage before using workspace context.` })
      throw error
    }
  }
  await useContextStore.getState().refreshExclusions()
  if (useContextStore.getState().projectContext === draft) {
    useContextStore.setState({ projectContext: context, committedRevision: context.revision })
    store.clearDirty()
  } else {
    if (original.projectId !== projectId) useContextStore.setState({ projectContext: forkProjectContext(useContextStore.getState().projectContext, projectId) })
    store.markDirty()
  }
  try {
    if (useContextStore.getState().projectContext !== context) {
      useContextStore.setState({ committedRevision: context.revision })
      await useContextStore.getState().stageProject()
    }
  } catch (error) {
    useSessionStore.getState().addConsoleEntry('info', `Project bundle saved; memory recovery journal unavailable: ${String(error)}`)
  }
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
  return workspaceOperation(async () => {
    useAiStore.getState().cancelStream()
    useProjectStore.setState(state => ({ phase: 'loading', workspaceEpoch: state.workspaceEpoch + 1 }))
    try { return await openProjectFromPath(path) }
    finally { useProjectStore.setState({ phase: 'ready' }) }
  })
}

async function openProjectFromPath(path: string): Promise<boolean> {
  let manifest: ProjectManifest
  let envRDataPath: string | null
  let authorisedFileLinks: AuthorisedFileLink[] = []
  let authorisedDatabasePaths: string[] = []
  const contextWarnings: string[] = []
  let identityForked = false
  try {
    const unpacked = await window.electronAPI.project.unpack(path)
    manifest = JSON.parse(unpacked.projectJson) as ProjectManifest
    envRDataPath = unpacked.envRDataPath
    authorisedFileLinks = unpacked.authorisedFileLinks ?? []
    authorisedDatabasePaths = unpacked.authorisedDatabasePaths ?? []
    identityForked = unpacked.identityForked === true
    contextWarnings.push(...(unpacked.contextWarnings ?? []))
  } catch (err) {
    if (String(err).includes('PROJECT_OPEN_CANCELLED')) return false
    useSessionStore.getState().addConsoleEntry('error', `Failed to open project: ${String(err)}`)
    return false
  }

  const name = baseName(path)
  // Switch to the named project up-front so the gated session autosave leaves
  // temp's session.json untouched while we hydrate this bundle's code tabs.
  useAiStore.getState().cancelStream()
  useProjectStore.setState({ projectId: typeof manifest.projectId === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.projectId) ? manifest.projectId : null })
  useProjectStore.getState().setCurrent(name, path)
  useContextStore.getState().loadProject()
  // Clear the previous scope before waiting for R/keyring recovery. Otherwise
  // a responsive chat could disclose old chats/buffers under the new UUID.
  clearWorkspaceStores()
  resetToBlankScratch()
  applyProjectChats(manifest.ui)
  const loadedChats = useAiStore.getState().chats
  let context = validateProjectContext(manifest.context, useProjectStore.getState().projectId)
  const committedRevision = context.revision
  const projectLease = await window.electronAPI.context.lease()
  try {
    const allowed = new Set(await window.electronAPI.context.filterDeleted(context.memories.map(m => m.id)))
    context = { ...context, memories: context.memories.filter(m => allowed.has(m.id)) }
    const projectId = useProjectStore.getState().projectId
    const recovered = projectId ? await window.electronAPI.context.recoverProject(projectId, committedRevision, projectLease.id) : null
    if (recovered && recovered.revision > committedRevision) {
      context = validateProjectContext(recovered, projectId)
      contextWarnings.push('Recovered unsaved project memory. Save the project to commit it, or discard the recovered edits.')
    }
  } catch (error) {
    // Failure to check newer tombstones is not permission to resurrect old data.
    context = { version: 1, revision: context.revision, memories: [] }
    contextWarnings.push(`Project memory unavailable: ${String(error)}. Restore protected storage and reopen the original bundle.`)
  }
  useContextStore.getState().loadProject(context, committedRevision, projectLease.id)

  await withDirtySuppressed(async () => {
    try {
      await retryOnNetworkError(() => rClient.sessionReset())
    } catch {
      // R may be unavailable — still hydrate the UI.
    }
    for (const warning of contextWarnings) useSessionStore.getState().addConsoleEntry('info', warning)

    // Load the R env BEFORE applying UI state, so a spatial layer's backing R
    // object already exists when the editor renders it.
    if (envRDataPath) {
      try {
        const res = await retryOnNetworkError(() => rClient.envLoad(envRDataPath as string, '.GlobalEnv'))
        // What comes back is what the panel should treat as NOT the user's own
        // — for a bundle written with excludeSystem that is normally nothing,
        // and for one written before ouRGeo knew its own helpers, just those.
        // It is not "the things this file restored": flagging those hid the
        // entire environment a project had just loaded. See handle_env_load.
        if (res.rdataLoadedNames?.length) {
          useEnvironmentStore.getState().addRdataLoadedNames('.GlobalEnv', res.rdataLoadedNames)
        }
      } catch (err) {
        useSessionStore.getState().addConsoleEntry('error', `Failed to load environment: ${String(err)}`)
      }
    }

    try {
      const databases = Array.isArray(manifest.databases) ? manifest.databases : []
      const allowed = databases.filter(database => authorisedDatabasePaths.includes(database.filePath))
      if (allowed.length < databases.length) useSessionStore.getState().addConsoleEntry('info', 'Imported database paths were not opened automatically. Choose the database files on this device to reconnect them.')
      await reconnectDatabases(allowed)
    } catch (err) {
      useSessionStore.getState().addConsoleEntry('error', `Database reconnect failed: ${String(err)}`)
    }

    await applyUiState(manifest.ui, authorisedFileLinks)
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
  if (identityForked || context.revision !== committedRevision || useAiStore.getState().chats !== loadedChats) store.markDirty()
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
  return workspaceOperation(async () => {
    useAiStore.getState().cancelStream()
    useProjectStore.setState(state => ({ phase: 'loading', workspaceEpoch: state.workspaceEpoch + 1 }))
    try { await openScratch() }
    finally { useProjectStore.setState({ phase: 'ready' }) }
  })
}

async function openScratch(): Promise<void> {
  // Back to scratch up-front so restoring its tabs writes to scratch's session.json.
  useAiStore.getState().cancelStream()
  const lease = await window.electronAPI.context.lease()
  await window.electronAPI.context.closeProject(lease.id)
  useProjectStore.setState({ projectId: null })
  useContextStore.getState().loadProject()
  useProjectStore.getState().setCurrent(SCRATCH_PROJECT_NAME, null)
  clearWorkspaceStores()
  resetToBlankScratch()
  await withDirtySuppressed(async () => {
    try {
      await rClient.sessionReset()
    } catch {
      // R may be unavailable
    }
    const restored = await loadSession()
    if (!restored) resetToBlankScratch()
    // No chats are restored here. `clearWorkspaceStores` has left one empty
    // conversation, and that is what New Project should give you: scratch does
    // not carry conversations between sessions or between projects, which is
    // the reason to Save As when one turns out to be worth keeping.
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

  // A conversation is project content now — it goes in the bundle — so a chat
  // held since the last save is unsaved work, and the quit prompt has to say
  // so. Delivery/session caches are excluded; a privacy reset alone is not
  // unsaved project work. Streaming text is outside the chat records.
  const unsubChats = useAiStore.subscribe((s, p) => {
    if (s.chats !== p.chats && chatContentChanged(s.chats, p.chats)) mark()
  })

  const unsubContext = useContextStore.subscribe((s, p) => {
    if (s.projectContext !== p.projectContext) mark()
  })
  return () => {
    unsubContext(); unsubEnv(); unsubSpatial(); unsubPlots(); unsubTabs(); unsubChats()
  }
}
