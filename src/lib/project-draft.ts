// The renderer's half of drafts (docs/project-persistence-spec.md §1.1–§1.2,
// §2.1, §3): what goes into one, when it is written, how it is read back, and
// the R checkpoints. The main process stores it — electron/main/project-drafts.ts.
//
// Two kinds of draft share this module:
//
// - A NAMED project's draft holds everything the bundle would, while the
//   project has changes the bundle does not. A project with none keeps only
//   `view` (cursors, scroll), which is never a change worth reporting.
// - SCRATCH's draft holds its code documents. On a fresh launch only the
//   untitled ones are put back (§2.1); within one run, a renderer reload puts
//   back everything, since nothing was "left".

import { create } from 'zustand'
import { rClient, type DbReconnectEntry } from '@/lib/r-client'
import { buildSessionData, type SessionData } from '@/lib/session-persistence'
import { buildWorkspaceData, type WorkspaceData } from '@/lib/workspace-persistence'
import { buildChatsData, type ChatsData } from '@/lib/ai-chats-persistence'
import { buildExtras, type WorkingExtras } from '@/lib/project-state'
import { allViews, onViewChange } from '@/lib/editor-view-state'
import { useProjectStore } from '@/store/project'
import { useEditorStore, type TabState } from '@/store/editor'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore, type PlotEntry } from '@/store/plotting'
import { useSessionStore } from '@/store/session'
import { useEnvironmentStore } from '@/store/environment'
import { useAiStore } from '@/store/ai'
import { useChunkStore, type ChunkOutput } from '@/store/chunks'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useDatabaseStore } from '@/store/database'
import { useProjectSettingsStore } from '@/store/project-settings'
import type { DraftMeta, DraftRead, DraftWrite } from '@/lib/project-draft-types'

export interface DraftUi {
  version: 1
  session: SessionData
  workspace?: Omit<WorkspaceData, 'layers'>
  chats?: ChatsData
  extras?: WorkingExtras
  databases?: DbReconnectEntry[]
}
export interface DraftPlots { plots: PlotEntry[]; currentIndex: number; chunks?: Record<string, Record<string, ChunkOutput>> }
export interface DraftView { editors: Record<string, unknown>; map?: unknown }
export interface DraftDoc { content: string; savedContent: string }

/** What the project menu and Settings show: whether this project's work is
 *  held only on this computer, and the last R checkpoint. */
export const useDraftStatus = create<{ changed: boolean; checkpointAt: string | null; checkpointMs: number | null }>(() => ({ changed: false, checkpointAt: null, checkpointMs: null }))
export function setDraftStatus(meta: Pick<DraftMeta, 'changed' | 'checkpointAt' | 'checkpointMs'> | null): void {
  useDraftStatus.setState(meta ? { changed: meta.changed, checkpointAt: meta.checkpointAt, checkpointMs: meta.checkpointMs } : { changed: false, checkpointAt: null, checkpointMs: null })
}

const codeTab = (t: TabState): boolean => !t.type || t.type === 'code'

/** The last `.Rgeo` connections R reported, refreshed at each checkpoint —
 *  asking R on every keystroke's draft write would queue behind the console. */
let knownDatabases: DbReconnectEntry[] = []
export function setKnownDatabases(databases: DbReconnectEntry[]): void { knownDatabases = databases }
async function refreshKnownDatabases(): Promise<void> {
  const byFile = new Map<string, { varName: string; name: string }[]>()
  try {
    const res = await rClient.dbProxies()
    for (const p of res.proxies ?? []) if (p.filePath) byFile.set(p.filePath, [...(byFile.get(p.filePath) ?? []), { varName: p.varName, name: p.name }])
  } catch { return }
  for (const filePath of Object.keys(useDatabaseStore.getState().openDbs)) if (!byFile.has(filePath)) byFile.set(filePath, [])
  knownDatabases = [...byFile].map(([filePath, proxies]) => ({ filePath, proxies }))
}

// ── Building ──────────────────────────────────────────────────────────────────
function buildDocs(): Record<string, DraftDoc> {
  const docs: Record<string, DraftDoc> = {}
  for (const tab of useEditorStore.getState().tabs.filter(codeTab)) docs[tab.id] = { content: tab.content, savedContent: tab.savedContent }
  return docs
}

/** Session data with document bodies taken out — they live one file each. */
function sessionWithoutBodies(): SessionData {
  const session = buildSessionData()
  return { ...session, tabs: session.tabs.map(tab => ({ ...tab, content: '', savedContent: '' })) }
}

export function buildDraftUi(scratch: boolean): DraftUi {
  if (scratch) return { version: 1, session: sessionWithoutBodies() }
  const workspace = buildWorkspaceData()
  delete workspace.layers
  return { version: 1, session: sessionWithoutBodies(), workspace, chats: buildChatsData(), extras: buildExtras(), databases: knownDatabases }
}

function buildView(): DraftView {
  const live = new Set(useEditorStore.getState().tabs.map(t => t.id))
  return { editors: allViews(live), map: useSpatialStore.getState().viewState }
}

// ── Writing ───────────────────────────────────────────────────────────────────
interface WriterCache {
  path: string | null
  ui?: string
  view?: string
  layers?: unknown
  plots?: unknown
  plotIndex?: number
  chunks?: unknown
  docs: Map<string, string>
  changed: boolean
}
let cache: WriterCache = { path: null, docs: new Map(), changed: false }
let suspended = 0
let timer: ReturnType<typeof setTimeout> | null = null
let chain: Promise<void> = Promise.resolve()

/** Forget what was last written: the next flush writes everything. Called
 *  whenever the workspace becomes a different project. */
export function resetDraftWriter(path: string | null, changed = false): void {
  if (timer) { clearTimeout(timer); timer = null }
  cache = { path, docs: new Map(), changed }
}

/** Hold writes while a project is being replaced in the stores — otherwise a
 *  half-hydrated workspace would be written into the draft of either side. */
export function suspendDraftWriter(): () => void {
  suspended++
  if (timer) { clearTimeout(timer); timer = null }
  let done = false
  return () => { if (!done) { done = true; suspended-- } }
}

/** Debounced: a crash loses at most this plus the write itself (§1.2). */
export function scheduleDraftWrite(delay = 1000): void {
  if (suspended) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void flushDraft() }, delay)
}

/** Write whatever changed since the last write, now. Serialised, so a flush
 *  requested while one is running follows it rather than racing it. */
export function flushDraft(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  const run = chain.then(() => writeOnce())
  chain = run.catch(error => console.warn('[Draft] Write failed:', error))
  return chain
}

async function writeOnce(): Promise<void> {
  if (suspended) return
  const project = useProjectStore.getState()
  if (project.phase === 'loading') return
  const path = project.path
  if (cache.path !== path) resetDraftWriter(path)
  const scratch = path === null
  // A named project's draft holds changes only while there are changes; a
  // clean project's draft is just where the user was looking.
  const holdsChanges = scratch || project.isDirty
  const write: DraftWrite = { slices: {}, docs: {} }
  let any = false

  const view = JSON.stringify(buildView())
  if (view !== cache.view) { write.slices!.view = view; cache.view = view; any = true }

  if (holdsChanges) {
    const ui = JSON.stringify(buildDraftUi(scratch))
    if (ui !== cache.ui) { write.slices!.ui = ui; cache.ui = ui; any = true }
    const docs = buildDocs()
    for (const [id, doc] of Object.entries(docs)) {
      const text = JSON.stringify(doc)
      if (cache.docs.get(id) !== text) { write.docs![id] = text; cache.docs.set(id, text); any = true }
    }
    for (const id of [...cache.docs.keys()]) if (!(id in docs)) { cache.docs.delete(id); any = true }
    write.keepDocs = Object.keys(docs)
    if (!scratch) {
      const spatial = useSpatialStore.getState(), plotting = usePlottingStore.getState(), chunks = useChunkStore.getState().outputs
      if (spatial.layers !== cache.layers) { write.slices!.layers = JSON.stringify({ layers: spatial.layers }); cache.layers = spatial.layers; any = true }
      if (plotting.plots !== cache.plots || plotting.currentIndex !== cache.plotIndex || chunks !== cache.chunks) {
        write.slices!.plots = JSON.stringify({ plots: plotting.plots, currentIndex: plotting.currentIndex, chunks } satisfies DraftPlots)
        cache.plots = plotting.plots; cache.plotIndex = plotting.currentIndex; cache.chunks = chunks; any = true
      }
      if (!cache.changed) { write.meta = { changed: true, name: project.name, projectId: project.projectId }; cache.changed = true; any = true }
    }
  }
  if (!any) return
  if (useProjectStore.getState().path !== path) return
  const meta = await window.electronAPI.drafts.write(path, write)
  if (!scratch && useProjectStore.getState().path === path) setDraftStatus(meta)
}

/** Subscribe the writer to everything a draft holds. */
export function startDraftWriter(): () => void {
  const schedule = (): void => scheduleDraftWrite()
  const unsubs = [
    useEditorStore.subscribe((s, p) => { if (s.tabs !== p.tabs || s.activeTabId !== p.activeTabId || s.activeByPanel !== p.activeByPanel) schedule() }),
    useSpatialStore.subscribe((s, p) => {
      if (s.layers !== p.layers || s.viewState !== p.viewState || s.pendingGeometryEdits !== p.pendingGeometryEdits || s.legendSettings !== p.legendSettings || s.northArrowSettings !== p.northArrowSettings || s.showLegend !== p.showLegend || s.showNorthArrow !== p.showNorthArrow || s.selectedLayerId !== p.selectedLayerId) schedule()
    }),
    usePlottingStore.subscribe((s, p) => { if (s.plots !== p.plots || s.currentIndex !== p.currentIndex) schedule() }),
    useSessionStore.subscribe((s, p) => { if (s.consoleHistory !== p.consoleHistory || s.workingDir !== p.workingDir || s.workingEnv !== p.workingEnv) schedule() }),
    useAiStore.subscribe((s, p) => { if (s.chats !== p.chats || s.activeChatId !== p.activeChatId) schedule() }),
    useChunkStore.subscribe((s, p) => { if (s.outputs !== p.outputs) schedule() }),
    useGeometryEditStore.subscribe((s, p) => { if (s.namedSessions !== p.namedSessions || s.activeSessionId !== p.activeSessionId) schedule() }),
    useProjectStore.subscribe((s, p) => { if (s.isDirty !== p.isDirty) scheduleDraftWrite(0) }),
    onViewChange(schedule),
  ]
  return () => { unsubs.forEach(unsub => unsub()); if (timer) clearTimeout(timer) }
}

// ── Reading ───────────────────────────────────────────────────────────────────
export interface ParsedDraft {
  meta: DraftMeta
  ui?: DraftUi
  layers?: unknown[]
  plots?: DraftPlots
  view?: DraftView
  docs: Record<string, DraftDoc>
  /** Parts that existed but could not be read, in words for the warning. */
  unreadable: string[]
  envPath: string | null
  hasBase: boolean
}

function parse<T>(text: string | undefined): T | undefined {
  if (text === undefined) return undefined
  try { return JSON.parse(text) as T } catch { return undefined }
}

export async function readParsedDraft(path: string | null): Promise<ParsedDraft> {
  const raw: DraftRead = await window.electronAPI.drafts.read(path)
  const docs: Record<string, DraftDoc> = {}
  for (const [id, text] of Object.entries(raw.docs)) {
    const doc = parse<DraftDoc>(text)
    if (doc && typeof doc.content === 'string') docs[id] = { content: doc.content, savedContent: typeof doc.savedContent === 'string' ? doc.savedContent : '' }
  }
  return {
    meta: raw.meta,
    ui: parse<DraftUi>(raw.slices.ui),
    layers: parse<{ layers: unknown[] }>(raw.slices.layers)?.layers,
    plots: parse<DraftPlots>(raw.slices.plots),
    view: parse<DraftView>(raw.slices.view),
    docs,
    unreadable: raw.unreadable,
    envPath: raw.envPath,
    hasBase: raw.hasBase,
  }
}

/** Put document bodies back into the draft's session. A document whose file
 *  could not be read is named in `lost`: a file-backed one falls back to the
 *  file on disk (its unsaved edits are what was lost), an untitled one has
 *  nothing to fall back to and is left out (§3.3). */
export function draftSession(draft: ParsedDraft): { session: SessionData | null; lost: string[] } {
  const session = draft.ui?.session
  if (!session || !Array.isArray(session.tabs)) return { session: null, lost: [] }
  const lost: string[] = []
  const tabs: TabState[] = []
  for (const tab of session.tabs) {
    const doc = draft.docs[tab.id]
    if (doc) { tabs.push({ ...tab, content: doc.content, savedContent: doc.savedContent, isDirty: doc.content !== doc.savedContent || tab.isDirty }); continue }
    if (draft.unreadable.includes(`doc:${tab.id}`)) lost.push(tab.fileName)
    // Not dirty, so restoring it re-reads the file.
    if (tab.filePath) tabs.push({ ...tab, content: '', savedContent: '', isDirty: false })
  }
  return { session: { ...session, tabs }, lost }
}

// ── R checkpoints ─────────────────────────────────────────────────────────────
let envChanged = false
let lastRActivity = Date.now()
let checkpointRunning: Promise<boolean> | null = null

/** The R environment has changed since the last checkpoint. */
export function envChangedSinceCheckpoint(): boolean { return envChanged }
/** After a load or a checkpoint, R and the snapshot agree. */
export function markEnvCheckpointed(): void { envChanged = false }

const pollDelay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Snapshot R into the named project's draft. `sync` is for closing and
 * switching, where the caller is waiting anyway; otherwise R forks and the
 * console never waits (§1.2). A snapshot in progress when the project changes
 * is abandoned, never committed to the wrong draft.
 */
export function checkpointNow(options: { sync: boolean }): Promise<boolean> {
  if (checkpointRunning) return checkpointRunning.then(() => options.sync && envChanged ? checkpointNow(options) : true)
  const run = (async (): Promise<boolean> => {
    const { path, workspaceEpoch } = useProjectStore.getState()
    if (path === null || useSessionStore.getState().rStatus !== 'ready') return false
    const target = await window.electronAPI.drafts.checkpointTarget(path)
    const at = new Date().toISOString(), started = Date.now()
    const changedAtStart = envChanged
    envChanged = false
    const fail = async (): Promise<boolean> => { envChanged = envChanged || changedAtStart; await window.electronAPI.drafts.abandonCheckpoint(target.temp); return false }
    try {
      let state = await rClient.checkpointStart(target.temp, options.sync)
      if (state.state === 'busy') { envChanged = envChanged || changedAtStart; return false }
      while (state.state === 'running') {
        await pollDelay(250)
        if (useProjectStore.getState().workspaceEpoch !== workspaceEpoch) return fail()
        state = await rClient.checkpointStatus()
      }
      if (state.state !== 'done' || useProjectStore.getState().workspaceEpoch !== workspaceEpoch) return fail()
      await refreshKnownDatabases()
      const meta = await window.electronAPI.drafts.commitCheckpoint(path, target.temp, at, state.ms ?? Date.now() - started)
      if (useProjectStore.getState().path === path) setDraftStatus({ ...meta, changed: useDraftStatus.getState().changed || meta.changed })
      return true
    } catch { return fail() }
  })()
  checkpointRunning = run
  void run.finally(() => { if (checkpointRunning === run) checkpointRunning = null })
  return run
}

/** Idle checkpoints: R idle for the configured interval, and the environment
 *  changed since the last one. Scratch never checkpoints — its environment is
 *  dropped on leaving it, crash or no crash (§3.2). */
export function startCheckpointScheduler(): () => void {
  const unsubEnv = useEnvironmentStore.subscribe((s, p) => {
    if (s.environments !== p.environments && useProjectStore.getState().phase === 'ready') { envChanged = true; lastRActivity = Date.now() }
  })
  const unsubExec = useSessionStore.subscribe((s, p) => { if (s.isExecuting !== p.isExecuting) lastRActivity = Date.now() })
  const timer = setInterval(() => {
    const interval = useProjectSettingsStore.getState().checkpointInterval
    const { path, phase } = useProjectStore.getState()
    if (!interval || path === null || phase !== 'ready' || !envChanged || checkpointRunning) return
    if (useSessionStore.getState().isExecuting || Date.now() - lastRActivity < interval * 1000) return
    void checkpointNow({ sync: false })
  }, 2000)
  return () => { unsubEnv(); unsubExec(); clearInterval(timer) }
}
