import { rebindProjectFileReferences } from '@/lib/project-file-citations'
import { useProjectFilesStore } from '@/store/project-files'
// Project workflow: save/load a portable `.ourgeoproj` bundle (R env snapshot +
// full ouRGeo UI state) and manage the temp scratch project. The bundle zip is
// packed/unpacked in the Electron main process (see electron/main/ipc.ts); this
// module owns collecting/hydrating the renderer state and driving the R server.

import { useContextStore } from '@/store/context'
import { validateProjectContext, forkProjectContext } from '@/lib/context/memory-schema'
import type { ProjectContext, AuthorisedFileLink } from '@/lib/context/types'
import { createWorkspaceQueue } from '@/lib/context/transitions'
import { chatContentChanged } from '@/lib/context/disclosure-dialogue'
import { rClient, type DbReconnectEntry, type RgeoObjectInfo, type NotRestored } from '@/lib/r-client'
import {
  buildSessionData,
  applySessionData,
  loadLegacySession,
  type SessionData,
} from '@/lib/session-persistence'
import { buildExtras, applyExtras, clearExtras, type WorkingExtras } from '@/lib/project-state'
import {
  readParsedDraft, draftSession, resetDraftWriter, suspendDraftWriter, flushDraft, setDraftStatus,
  markEnvCheckpointed, setKnownDatabases, type ParsedDraft,
} from '@/lib/project-draft'
import { restoreViews } from '@/lib/editor-view-state'
import { useChunkStore } from '@/store/chunks'
import { reportNotRestored } from '@/lib/project-restore-report'
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
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useProjectSettingsStore } from '@/store/project-settings'
import { ask } from '@/store/ask'
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
    /** Map sessions, staged geometry edits, R's working directory and
     *  environment (lib/project-state.ts). Optional: older bundles have none. */
    extras?: WorkingExtras
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
      extras: buildExtras(),
    },
    databases,
  }
}

function applyProjectChats(ui: ProjectManifest['ui'], portable = true): void {
  // A bundle from before chats existed carries none, and `clearWorkspaceStores`
  // has already left one empty conversation — which is the right answer for a
  // project that has never had any.
  const restoredChats = applyChatsData(ui.chats, portable)
  const chatCount = Array.isArray(ui.chats?.chats) ? ui.chats.chats.length : 0
  const excludedChats = chatCount - (restoredChats ? useAiStore.getState().chats.length : 0)
  if (excludedChats > 0) useSessionStore.getState().addConsoleEntry('info', `${excludedChats} conversations were excluded because their records are malformed. The original bundle is unchanged; repair or restore it to recover those conversations.`)
  // Bundled provider IDs are neither delivery receipts nor authority to replay
  // old context. Reconstruct locally so newer exclusions and tombstones win.
  // A draft is this computer's own record, but the same caution costs only a
  // fresh provider session, so it applies there too.
  useAiStore.setState(state => ({ chats: state.chats.map(chat => ({ ...chat, claudeSessionId: null, lastSessionContext: null })) }))
}

async function applyUiState(ui: ProjectManifest['ui'], authorisedFileLinks: AuthorisedFileLink[] = [], options: { portable: boolean; touchR: boolean } = { portable: true, touchR: true }): Promise<void> {
  // A portable bundle names files from its author's machine. Opening it is
  // permission to use the bundled buffers, not to read those absolute paths.
  // A draft is this computer's own, and its file links are this computer's.
  if (ui.session) {
    await applySessionData(ui.session, options.portable ? { portable: true, authorisedFileLinks } : {})
    if (options.portable && ui.session.tabs?.some(tab => tab.filePath && !authorisedFileLinks.some(link => link.id === tab.id && link.filePath === tab.filePath))) useSessionStore.getState().addConsoleEntry('info', 'Imported scripts use their bundled buffers. Choose Save As to link them to files on this device.')
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
  await applyExtras(ui.extras, { touchR: options.touchR })
}

/** A draft read as the `ui` of a manifest. A part the draft lacks (an
 *  unreadable slice) comes from the bundle, which is older but whole. */
function draftAsUi(draft: ParsedDraft, bundle: ProjectManifest['ui']): { ui: ProjectManifest['ui']; lost: string[] } {
  const { session, lost } = draftSession(draft)
  return {
    lost,
    ui: {
      session: session ?? bundle.session,
      workspace: { ...(draft.ui?.workspace ?? bundle.workspace ?? {}), layers: draft.layers ?? bundle.workspace?.layers },
      plots: draft.plots ? { plots: draft.plots.plots, currentIndex: draft.plots.currentIndex } : bundle.plots,
      chats: draft.ui?.chats ?? bundle.chats,
      extras: draft.ui?.extras ?? bundle.extras,
    },
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
  useChunkStore.setState({ outputs: {} })
  clearExtras()
  restoreViews({})
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

async function reconnectDatabases(databases: DbReconnectEntry[], log: (kind: 'error', text: string) => void = (kind, text) => useSessionStore.getState().addConsoleEntry(kind, text)): Promise<void> {
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
    log('error', `Database reconnect: ${res.errors.join('; ')}`)
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

/** The R environment, packed the way a project snapshot is (terra objects
 *  wrapped so they survive — r/lib/handlers-checkpoint.R), to a temp file the
 *  packer folds into the bundle. Null when R is unavailable: the packer then
 *  keeps the last saved environment rather than dropping it. */
async function snapshotForBundle(): Promise<string | null> {
  try {
    const tmp = await window.electronAPI.project.tempEnvPath()
    const res = await rClient.checkpointStart(tmp, true, 'fast')
    return res.state === 'done' ? tmp : null
  } catch {
    return null
  }
}

async function packProjectToPath(path: string): Promise<boolean> {
  const name = baseName(path)
  const lease = useProjectStore.getState().workspaceEpoch
  const stillCurrent = (): boolean => useProjectStore.getState().workspaceEpoch === lease
  const previousPath = useProjectStore.getState().path

  // A Save As to a project open in another window would have two windows
  // writing one bundle. Saving in place already holds the lock.
  if (previousPath !== path) {
    const lock = await window.electronAPI.drafts.lock(path)
    if (!lock.ok) { await refuseSecondWindow(path); return false }
  }

  const envPath = await snapshotForBundle()
  const databases = await collectDatabases()
  if (!stillCurrent()) throw new Error('SCOPE_CHANGED: project changed during save. Save the current project again.')
  const original = useProjectStore.getState()
  const projectId = !original.projectId || original.path !== path ? crypto.randomUUID() : original.projectId
  const draft = useContextStore.getState().projectContext
  const context = original.projectId !== projectId ? forkProjectContext(draft, projectId) : draft
  const manifest = buildManifest(name, databases, projectId, context)
  if (original.projectId && original.projectId !== projectId && manifest.ui.chats) manifest.ui.chats = rebindProjectFileReferences(manifest.ui.chats, original.projectId, projectId)

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
  // The bundle now holds everything: the draft's changes are discarded and the
  // saved file becomes the base a later conflict is measured from (§1.5).
  // Where the user was looking (`view`) stays.
  try {
    await window.electronAPI.drafts.discard(path)
    await window.electronAPI.drafts.setBase(path)
  } catch (error) {
    useSessionStore.getState().addConsoleEntry('info', `Project saved, but its local draft could not be reset: ${String(error)}. Your work is in the saved project.`)
  }
  resetDraftWriter(path)
  setDraftStatus(null)
  markEnvCheckpointed()
  setKnownDatabases(databases)
  if (previousPath !== path) {
    if (previousPath) await window.electronAPI.drafts.unlock(previousPath).catch(() => undefined)
    await window.electronAPI.drafts.setProject(path)
  }
  if (original.projectId && original.projectId !== projectId) useAiStore.setState(state => ({ chats: rebindProjectFileReferences(state.chats, original.projectId!, projectId) }))
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
    const files = await window.electronAPI.projectFiles.catalogue(savedLease.id)
    if (files.revision === files.savedRevision) store.clearDirty()
    else store.markDirty()
    await useProjectFilesStore.getState().refresh()
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

/** Documents first, when Settings → Projects says so (§1.5). A file that
 *  cannot be written stops the save before the bundle is touched. Returns
 *  false for Cancel — which, from a close or switch, cancels that too. */
async function saveDocumentsWithProject(): Promise<boolean> {
  if (!useProjectSettingsStore.getState().saveDocumentsWithProject) return true
  const { saveDocument } = await import('@/lib/document-close')
  for (const tab of useEditorStore.getState().tabs.filter(t => (!t.type || t.type === 'code') && t.filePath && t.isDirty)) {
    try { await saveDocument(tab) }
    catch (error) {
      const answer = await ask({
        title: `Could not save ${tab.fileName}`,
        body: `${tab.filePath} could not be written (${String(error).replace(/^Error: /, '')}). The project has not been saved yet.`,
        choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'skip', label: 'Skip this file', variant: 'default' }, { id: 'saveas', label: 'Save As…', variant: 'primary' }],
        cancelId: 'cancel',
      })
      if (answer.choice === 'cancel') return false
      if (answer.choice === 'saveas') {
        try { if (!await saveDocument(tab, true)) return false }
        catch (again) { useSessionStore.getState().addConsoleEntry('error', `Could not save ${tab.fileName}: ${String(again)}`); return false }
      }
      // Skip: its edits stay unsaved, held in the project.
    }
  }
  return true
}

/** True when the bundle on disk is not the one this project's draft started
 *  from — someone or something else saved over it (§1.8). */
async function changedElsewhere(path: string, baseSignature: string | null): Promise<boolean> {
  if (!baseSignature) return false
  const signature = await window.electronAPI.drafts.signature(path)
  return !!signature && signature !== baseSignature
}

type ExternalChoice = 'cancel' | 'theirs' | 'mine' | 'merge'
async function askExternalChange(path: string, hasBase: boolean): Promise<ExternalChoice> {
  const info = await window.electronAPI.drafts.fileInfo(path)
  const when = info.mtime ? new Date(info.mtime).toLocaleString() : 'recently'
  const answer = await ask({
    title: `${baseName(path)} was changed elsewhere`,
    body: `The project file was saved by someone else, or by another program, on ${when} — after you opened it. Your unsaved changes are kept on this computer.${hasBase ? '' : ' Resolving conflicts needs a copy of the project as you opened it, and these changes were made before ouRGeo kept one, so only the first two choices are available.'}`,
    choices: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'theirs', label: 'Discard my changes and open theirs', variant: 'default' },
      { id: 'mine', label: 'Open my version and save it over theirs', variant: 'default' },
      ...(hasBase ? [{ id: 'merge', label: 'Resolve conflicts…', variant: 'primary' as const }] : []),
    ],
    cancelId: 'cancel',
    wide: true,
  })
  if (answer.choice !== 'mine') return answer.choice as ExternalChoice
  const confirm = await ask({
    title: 'Save over their version?',
    body: `${path} was last saved on ${when}. Saving your version replaces it, and their changes are lost unless they have another copy.`,
    choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'overwrite', label: 'Save over it', variant: 'danger' }],
    cancelId: 'cancel',
  })
  return confirm.choice === 'overwrite' ? 'mine' : 'cancel'
}

/** Save to the current project's bundle; falls back to Save As for scratch. */
export async function saveCurrentProject(): Promise<boolean> {
  const { path } = useProjectStore.getState()
  if (!path) return saveProjectAs()
  const meta = (await window.electronAPI.drafts.read(path)).meta
  if (await changedElsewhere(path, meta.baseSignature)) {
    await flushDraft()
    const choice = await askExternalChange(path, (await window.electronAPI.drafts.basePath(path)) !== null)
    if (choice === 'cancel') return false
    if (choice === 'theirs') {
      await window.electronAPI.drafts.discard(path)
      return loadProjectFromPath(path, { draft: 'ignore' })
    }
    if (choice === 'merge') { const { startMerge } = await import('@/lib/project-merge-flow'); return startMerge(path) }
    await window.electronAPI.project.acceptDestination(path)
  }
  if (!await saveDocumentsWithProject()) return false
  return saveProjectToPath(path)
}

/** After the user chose their version over a changed file (§1.8). */
export async function saveOverExternalChange(path: string): Promise<boolean> {
  await window.electronAPI.project.acceptDestination(path)
  if (!await saveDocumentsWithProject()) return false
  return saveProjectToPath(path)
}

/** Prompt for a bundle location and save there. Returns false if cancelled. */
export async function saveProjectAs(): Promise<boolean> {
  const { name } = useProjectStore.getState()
  const defaultName = name === SCRATCH_PROJECT_NAME ? undefined : name
  const path = await window.electronAPI.dialog.saveProject(defaultName)
  if (!path) return false
  return saveProjectToPath(path)
}

// ── One window per project ────────────────────────────────────────────────────
async function refuseSecondWindow(path: string): Promise<void> {
  const answer = await ask({
    title: `${baseName(path)} is already open`,
    body: `This project is open in another ouRGeo window on this computer. Two windows working on one project would each overwrite the other's changes, so it opens in only one.`,
    choices: [{ id: 'ok', label: 'OK' }, { id: 'focus', label: 'Show that window', variant: 'primary' }],
    cancelId: 'ok',
  })
  if (answer.choice === 'focus') await window.electronAPI.drafts.focusOwner(path).catch(() => undefined)
}

// ── Load ──────────────────────────────────────────────────────────────────────
export interface OpenOptions {
  /** `auto` applies the draft, asking first if the file changed elsewhere;
   *  `ignore` opens the bundle as saved; `mine` applies the draft without
   *  asking, keeping this computer's Project Files changes too. */
  draft?: 'auto' | 'ignore' | 'mine'
  /** R is still running with this project's objects (a renderer reload). */
  keepR?: boolean
}

/** Open a `.ourgeoproj` bundle with its draft: reset R + UI, hydrate state,
 *  reconnect DBs. The caller has already left the previous project. */
export async function loadProjectFromPath(path: string, options: OpenOptions = {}): Promise<boolean> {
  const mode = options.draft ?? 'auto'
  const previous = useProjectStore.getState().path
  const lock = await window.electronAPI.drafts.lock(path)
  if (!lock.ok) { await refuseSecondWindow(path); return false }
  const releaseIfNotOpened = async (): Promise<void> => { if (useProjectStore.getState().path !== path) await window.electronAPI.drafts.unlock(path).catch(() => undefined) }

  let draft = await readParsedDraft(path)
  if (mode === 'auto' && draft.meta.changed && await changedElsewhere(path, draft.meta.baseSignature)) {
    const choice = await askExternalChange(path, draft.hasBase)
    if (choice === 'cancel') { await releaseIfNotOpened(); return false }
    if (choice === 'merge') { const { startMerge } = await import('@/lib/project-merge-flow'); return startMerge(path) }
    if (choice === 'mine') {
      if (!await loadProjectFromPath(path, { draft: 'mine' })) return false
      return saveOverExternalChange(path)
    }
    await window.electronAPI.drafts.discard(path)
    draft = await readParsedDraft(path)
  }
  const useDraft = mode !== 'ignore' && draft.meta.changed
  const opened = await workspaceOperation(async () => {
    useAiStore.getState().cancelStream()
    const resume = suspendDraftWriter()
    useProjectStore.setState(state => ({ phase: 'loading', workspaceEpoch: state.workspaceEpoch + 1 }))
    try { return await openProjectFromPath(path, { draft: useDraft ? draft : null, keepR: options.keepR === true, preferLocalFiles: mode === 'mine' }) }
    finally { useProjectStore.setState({ phase: 'ready' }); resume() }
  })
  if (!opened) { await releaseIfNotOpened(); return false }
  if (previous && previous !== path) await window.electronAPI.drafts.unlock(previous).catch(() => undefined)
  await window.electronAPI.drafts.setProject(path)
  return true
}

let lastLost: string[] = []
/** Documents whose recovery copies could not be read on the last open — for
 *  the crash report (§3.3). */
export function lastOpenLostDocuments(): string[] { return lastLost }

async function openProjectFromPath(path: string, options: { draft: ParsedDraft | null; keepR: boolean; preferLocalFiles: boolean }): Promise<boolean> {
  const { draft, keepR } = options
  let manifest: ProjectManifest
  let envRDataPath: string | null
  let authorisedFileLinks: AuthorisedFileLink[] = []
  let authorisedDatabasePaths: string[] = []
  const contextWarnings: string[] = []
  let identityForked = false
  let openToken: string | undefined
  const releaseOpen = async (): Promise<void> => {
    if (!openToken) return
    const token = openToken
    openToken = undefined
    try { await window.electronAPI.project.releaseOpen(token) }
    catch (error) { useSessionStore.getState().addConsoleEntry('info', `Temporary project-open files could not be removed: ${String(error)}. They will be retried when ouRGeo closes.`) }
  }
  try {
    const unpacked = await window.electronAPI.project.unpack(path, { preferLocalFiles: options.preferLocalFiles })
    openToken = unpacked.openToken
    manifest = JSON.parse(unpacked.projectJson) as ProjectManifest
    envRDataPath = unpacked.envRDataPath
    authorisedFileLinks = unpacked.authorisedFileLinks ?? []
    authorisedDatabasePaths = unpacked.authorisedDatabasePaths ?? []
    identityForked = unpacked.identityForked === true
    contextWarnings.push(...(unpacked.contextWarnings ?? []))
  } catch (err) {
    await releaseOpen()
    if (String(err).includes('PROJECT_OPEN_CANCELLED')) return false
    useSessionStore.getState().addConsoleEntry('error', `Failed to open project: ${String(err)}`)
    return false
  }

  try {
    const name = baseName(path)
    // Switch to the named project up-front so nothing written while this
    // bundle hydrates lands in the previous project's draft.
    useAiStore.getState().cancelStream()
    useProjectStore.setState({ projectId: typeof manifest.projectId === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.projectId) ? manifest.projectId : null })
    useProjectStore.getState().setCurrent(name, path)
    useContextStore.getState().loadProject()
    // Clear the previous scope before waiting for R/keyring recovery. Otherwise
    // a responsive chat could disclose old chats/buffers under the new UUID.
    clearWorkspaceStores()
    resetToBlankScratch()
    const restored = draft ? draftAsUi(draft, manifest.ui) : { ui: manifest.ui, lost: [] as string[] }
    applyProjectChats(restored.ui, !draft)
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

    // Where the user was in each document, before the documents arrive: the
    // editor restores a tab's view when it first shows it.
    restoreViews(draft?.view?.editors ?? {})
    const databases = draft?.ui?.databases ?? (Array.isArray(manifest.databases) ? manifest.databases.filter(database => authorisedDatabasePaths.includes(database.filePath)) : [])

    await withDirtySuppressed(async () => {
      // Console lines written now would be overwritten when the project's own
      // console history is restored below, so they are collected and written
      // after it.
      let notRestored: NotRestored[] = []
      const later: ['info' | 'error', string][] = []
      if (!keepR) {
        try {
          await retryOnNetworkError(() => rClient.sessionReset())
        } catch {
          // R may be unavailable — still hydrate the UI.
        }
        // Load the R env BEFORE applying UI state, so a spatial layer's backing
        // R object already exists when the editor renders it. The draft's
        // checkpoint is newer than the bundle's snapshot when there is one.
        const snapshot = draft?.envPath ?? envRDataPath
        if (snapshot) {
          try {
            const res = await retryOnNetworkError(() => rClient.snapshotLoad(snapshot))
            if (res.success === false) throw new Error(res.error ?? 'R refused the snapshot')
            if (res.rdataLoadedNames?.length) useEnvironmentStore.getState().addRdataLoadedNames('.GlobalEnv', res.rdataLoadedNames)
            notRestored = res.notRestored ?? []
          } catch (err) {
            later.push(['error', `Failed to load environment: ${String(err)}`])
          }
        }
        try {
          const all = Array.isArray(manifest.databases) ? manifest.databases : []
          if (!draft && all.length > databases.length) later.push(['info', 'Imported database paths were not opened automatically. Choose the database files on this device to reconnect them.'])
          await reconnectDatabases(databases, (kind, text) => later.push([kind, text]))
        } catch (err) {
          later.push(['error', `Database reconnect failed: ${String(err)}`])
        }
      }

      await applyUiState(restored.ui, authorisedFileLinks, { portable: !draft, touchR: !keepR })
      for (const warning of contextWarnings) useSessionStore.getState().addConsoleEntry('info', warning)
      for (const [kind, text] of later) useSessionStore.getState().addConsoleEntry(kind, text)
      await reportNotRestored(notRestored)
      if (draft?.plots?.chunks) useChunkStore.setState({ outputs: draft.plots.chunks })
      if (draft?.view?.map && typeof draft.view.map === 'object') useSpatialStore.setState({ viewState: draft.view.map as ReturnType<typeof useSpatialStore.getState>['viewState'] })
      lastLost = restored.lost
      if (restored.lost.length) useSessionStore.getState().addConsoleEntry('info', `Unsaved edits to ${restored.lost.join(', ')} could not be recovered: their recovery copies were unreadable.`)
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
    if (draft || identityForked || context.revision !== committedRevision || useAiStore.getState().chats !== loadedChats) store.markDirty()
    resetDraftWriter(path, !!draft)
    setDraftStatus(draft ? draft.meta : null)
    markEnvCheckpointed()
    setKnownDatabases(databases)
    if (!draft) {
      // The bundle as opened is the base a later conflict is measured from.
      try { await window.electronAPI.drafts.setBase(path) }
      catch (error) { useSessionStore.getState().addConsoleEntry('info', `A local copy for conflict checks could not be kept: ${String(error)}.`) }
    }
    persistRecents(store.pushRecent({ name, path }))
    useSessionStore.getState().addConsoleEntry('info', draft ? `Project loaded: ${name}, with unsaved changes kept on this computer.` : `Project loaded: ${name}`)
    return true
  } finally { await releaseOpen() }
}

/** Prompt for a bundle and load it. Returns false if cancelled. */
export async function loadProject(): Promise<boolean> {
  const path = await window.electronAPI.dialog.openProject()
  if (!path) return false
  return loadProjectFromPath(path)
}

// ── Revert ────────────────────────────────────────────────────────────────────
/** Discard the draft and reopen the bundle as saved (§1.6), after a
 *  confirmation that counts what will be lost. */
export async function revertProject(): Promise<boolean> {
  const { path } = useProjectStore.getState()
  if (!path) return false
  await flushDraft()
  const { revertLosses } = await import('@/lib/project-merge-flow')
  const losses = await revertLosses(path)
  const answer = await ask({
    title: `Revert ${baseName(path)} to its saved version?`,
    body: losses.length
      ? `This discards, permanently: ${losses.join('; ')}. The project reopens exactly as it was last saved.`
      : 'Nothing differs from the saved version that ouRGeo can count, but the project will reopen exactly as it was last saved.',
    choices: [{ id: 'cancel', label: 'Cancel' }, { id: 'revert', label: 'Revert', variant: 'danger' }],
    cancelId: 'cancel',
  })
  if (answer.choice !== 'revert') return false
  // Project Files and project memory keep their own recovery journals; left
  // alone, reopening would recover their unsaved changes straight back.
  try {
    const lease = await window.electronAPI.context.lease()
    await window.electronAPI.projectFiles.discard(lease.id)
    await useContextStore.getState().discardProjectDraft()
  } catch (error) {
    useSessionStore.getState().addConsoleEntry('error', `Could not discard the project's file or memory journal: ${String(error)}. Nothing was reverted; try again.`)
    return false
  }
  await window.electronAPI.drafts.discard(path)
  return loadProjectFromPath(path, { draft: 'ignore' })
}

// ── Scratch ───────────────────────────────────────────────────────────────────
/** Put scratch's documents back. On a fresh launch, or when returning to
 *  scratch, only untitled ones (§2.1); a renderer reload keeps them all,
 *  because nothing was left. File-backed tabs dropped here go to Recently
 *  closed. Returns the restored documents' names. */
export async function restoreScratchDocuments(options: { keepFileBacked: boolean }): Promise<{ restored: string[]; lost: string[] }> {
  // Scratch's documents belong in scratch. Put over a named project they
  // would replace its documents, and its draft would save the loss.
  if (useProjectStore.getState().path !== null) return { restored: [], lost: [] }
  const draft = await readParsedDraft(null)
  const { session: fromDraft, lost } = draftSession(draft)
  const session = fromDraft ?? (draft.ui ? null : await loadLegacySession())
  if (!session?.tabs?.length) { resetToBlankScratch(); return { restored: [], lost } }
  const dropped = options.keepFileBacked ? [] : session.tabs.filter(tab => tab.filePath)
  if (dropped.length) {
    const { addRecentlyClosed } = await import('@/store/recently-closed')
    addRecentlyClosed(dropped.map(tab => tab.filePath!))
  }
  const tabs = session.tabs.filter(tab => options.keepFileBacked || !tab.filePath)
  restoreViews(draft.view?.editors ?? {})
  const applied = tabs.length ? await applySessionData({ ...session, tabs }) : false
  if (!applied) resetToBlankScratch()
  return { restored: applied ? tabs.map(tab => tab.fileName) : [], lost }
}

/**
 * Return to a clean scratch project: wipe the R env + all UI state, and restore
 * scratch's untitled documents. The caller has already left the previous
 * project (lib/project-leave.tsx).
 */
export async function newProject(): Promise<void> {
  const previous = useProjectStore.getState().path
  await workspaceOperation(async () => {
    useAiStore.getState().cancelStream()
    const resume = suspendDraftWriter()
    useProjectStore.setState(state => ({ phase: 'loading', workspaceEpoch: state.workspaceEpoch + 1 }))
    try { await openScratch() }
    finally { useProjectStore.setState({ phase: 'ready' }); resume() }
  })
  if (previous) await window.electronAPI.drafts.unlock(previous).catch(() => undefined)
  await window.electronAPI.drafts.setProject(null)
  void flushDraft()
}

async function openScratch(): Promise<void> {
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
    await restoreScratchDocuments({ keepFileBacked: false })
    // No chats are restored here. `clearWorkspaceStores` has left one empty
    // conversation, and that is what scratch should give you: scratch does
    // not carry conversations between sessions or between projects, which is
    // the reason to Save As when one turns out to be worth keeping.
    await refreshRPanels()
  })
  useProjectStore.getState().clearDirty()
  resetDraftWriter(null)
  setDraftStatus(null)
  markEnvCheckpointed()
}

// ── R restarted underneath the app (§3.4) ─────────────────────────────────────
/** After R crashed and came back, put the named project's objects back from
 *  the last checkpoint — or from the bundle, when nothing has been
 *  checkpointed since it was opened — and say so. */
export async function restoreAfterRRestart(): Promise<void> {
  const { path } = useProjectStore.getState()
  if (!path) return
  const draft = await window.electronAPI.drafts.read(path)
  let snapshot = draft.envPath, release: string | undefined
  if (!snapshot) {
    try {
      const inspected = await window.electronAPI.project.inspect(path)
      snapshot = inspected.envRDataPath; release = inspected.openToken
    } catch { snapshot = null }
  }
  try {
    if (snapshot) {
      const res = await rClient.snapshotLoad(snapshot)
      await reportNotRestored(res.notRestored ?? [])
    }
    await reconnectDatabases(draft.envPath ? (JSON.parse(draft.slices.ui ?? '{}') as { databases?: DbReconnectEntry[] }).databases ?? [] : [])
  } catch (error) {
    useSessionStore.getState().addConsoleEntry('error', `R objects could not be restored: ${String(error)}`)
  } finally {
    if (release) await window.electronAPI.project.releaseOpen(release).catch(() => undefined)
  }
  await refreshRPanels()
  markEnvCheckpointed()
  const at = draft.meta.checkpointAt ? new Date(draft.meta.checkpointAt).toLocaleTimeString() : null
  const message = at
    ? `The R session stopped. Objects were restored from the checkpoint at ${at}; anything created after that needs re-running — the console history shows what you ran.`
    : 'The R session stopped. Objects were restored from the saved project; anything created since it was opened needs re-running — the console history shows what you ran.'
  useSessionStore.getState().addConsoleEntry('info', message)
  await ask({ title: 'R restarted', body: message, choices: [{ id: 'ok', label: 'OK', variant: 'primary' }], cancelId: 'ok' })
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
    if (s.layers !== p.layers || s.pendingGeometryEdits !== p.pendingGeometryEdits) mark()
  })
  const unsubPlots = usePlottingStore.subscribe((s, p) => {
    if (s.plots !== p.plots) mark()
  })
  // Documents are project content: the bundle holds every open document,
  // edits included (§1.1). A tab whose object changed — text, file, language,
  // panel — or that opened or closed, is a change; switching tabs is not.
  const unsubTabs = useEditorStore.subscribe((s, p) => {
    if (s.tabs === p.tabs) return
    if (s.tabs.length !== p.tabs.length || s.tabs.some((tab, i) => tab !== p.tabs[i])) mark()
  })
  const unsubGeometry = useGeometryEditStore.subscribe((s, p) => {
    if (s.namedSessions !== p.namedSessions) mark()
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
    unsubContext(); unsubEnv(); unsubSpatial(); unsubPlots(); unsubTabs(); unsubChats(); unsubGeometry()
  }
}
