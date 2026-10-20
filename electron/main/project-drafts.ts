// Drafts: the working state of a project, kept on THIS computer between saves.
//
// A named project is saved to its `.ourgeoproj` when the user says so, but
// everything they do in between — an edited script, a new layer, a chat, the
// R environment — is written here continuously, so closing the app, switching
// project, or a crash never costs work. Scratch keeps its untitled documents
// here too, under the fixed key `scratch`.
//
// One directory per project, keyed by the bundle's path (the identity the user
// sees and the one a second window would open by):
//
//   meta.json            name, path, base signature, checkpoint time, `changed`
//   ui.json              documents' metadata, console, chats, map settings…
//   layers.json          map layers (large; written only when they change)
//   plots.json           plot history (large; written only when it changes)
//   view.json            cursors, scroll, folding — kept even with no changes
//   docs/<tab id>.json   one file per document, so one unreadable document
//                        never takes the others down with it (§3.3)
//   environment.RData    the last R checkpoint
//   base.ourgeoproj      the bundle the draft started from — what a three-way
//                        merge needs when the file changes elsewhere (§1.9)
//   lock.json            the process that has this project open (§1.10)
//
// Every write is temp + fsync + rename: a torn draft must never replace a good
// one. See docs/project-persistence-spec.md for the behaviour this serves.

import { app, type IpcMain } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileSignature } from './project-files/bundle'
import { syncDirectory } from './project-files/durability'
import { requireContextOwner } from './context/ipc'
import { SESSION_SCOPED_FILES } from '../../src/lib/session-scoped-files'
import {
  DRAFT_SLICES, isDraftSlice, lockIsStale, olderThan, type DraftListing, type DraftMeta,
  type DraftRead, type DraftSlice, type DraftWrite, type LaunchState, type LockRecord,
} from '../../src/lib/project-draft-types'

export const SCRATCH_KEY = 'scratch'
const DOC_ID = /^[A-Za-z0-9-]{1,80}$/

const root = (): string => join(app.getPath('userData'), 'project-drafts')

/** The draft directory for a project path; `null` is scratch. */
export function draftKey(path: string | null): string {
  if (path === null) return SCRATCH_KEY
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 32)
}
const dirFor = (key: string): string => join(root(), key)

// ── Atomic writes ─────────────────────────────────────────────────────────────
/** Temp + fsync + rename. The fault hook exists for acceptance check C5 only:
 *  it kills the process between the temp write and the rename, which is the
 *  moment a non-atomic writer would have destroyed the previous draft. */
export async function atomicWrite(target: string, data: string | Buffer): Promise<void> {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  const handle = await open(temp, 'w', 0o600)
  try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
  if (process.env.OURGEO_TEST_DRAFT_FAULT === 'kill-before-rename' && !target.endsWith('meta.json')) process.kill(process.pid, 'SIGKILL')
  await rename(temp, target)
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T }
  catch { return null }
}

function emptyMeta(key: string, path: string | null): DraftMeta {
  return { version: 1, key, path, name: path ? path.split(/[\\/]/).pop()!.replace(/\.ourgeoproj$/i, '') : 'scratch', projectId: null, updatedAt: null, changed: false, baseSignature: null, baseSavedAt: null, checkpointAt: null, checkpointMs: null }
}

async function readMeta(key: string, path: string | null): Promise<DraftMeta> {
  const meta = await readJson<DraftMeta>(join(dirFor(key), 'meta.json'))
  return meta && meta.version === 1 ? { ...emptyMeta(key, path), ...meta, key } : emptyMeta(key, path)
}

// One promise chain per draft, so a debounced UI write and a checkpoint commit
// never interleave their read-modify-write of meta.json.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task)
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

async function writeMeta(key: string, patch: Partial<DraftMeta>, path: string | null): Promise<DraftMeta> {
  const dir = dirFor(key)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const meta = { ...(await readMeta(key, path)), ...patch, key }
  if (path !== null) meta.path = path
  await atomicWrite(join(dir, 'meta.json'), JSON.stringify(meta))
  return meta
}

// ── Reading and writing ───────────────────────────────────────────────────────
export async function writeDraft(path: string | null, input: DraftWrite): Promise<DraftMeta> {
  const key = draftKey(path)
  return serial(key, async () => {
    const dir = dirFor(key)
    await mkdir(join(dir, 'docs'), { recursive: true, mode: 0o700 })
    for (const [slice, data] of Object.entries(input.slices ?? {})) {
      if (!isDraftSlice(slice)) throw new Error(`Unknown draft part "${slice}".`)
      if (data === null) await unlink(join(dir, `${slice}.json`)).catch(() => undefined)
      else await atomicWrite(join(dir, `${slice}.json`), data)
    }
    for (const [id, data] of Object.entries(input.docs ?? {})) {
      if (!DOC_ID.test(id)) throw new Error('A document id in the draft is malformed.')
      if (data === null) await unlink(join(dir, 'docs', `${id}.json`)).catch(() => undefined)
      else await atomicWrite(join(dir, 'docs', `${id}.json`), data)
    }
    if (input.keepDocs) {
      const keep = new Set(input.keepDocs)
      for (const name of await readdir(join(dir, 'docs')).catch(() => [] as string[])) {
        const id = name.replace(/\.json$/, '')
        if (name.endsWith('.json') && !keep.has(id)) await unlink(join(dir, 'docs', name)).catch(() => undefined)
      }
    }
    await syncDirectory(dir).catch(() => false)
    return writeMeta(key, { ...(input.meta ?? {}), updatedAt: new Date().toISOString() }, path)
  })
}

export async function readDraft(path: string | null): Promise<DraftRead> {
  const key = draftKey(path), dir = dirFor(key)
  const meta = await readMeta(key, path)
  const slices: Partial<Record<DraftSlice, string>> = {}, unreadable: string[] = []
  for (const slice of DRAFT_SLICES) {
    try {
      const text = await readFile(join(dir, `${slice}.json`), 'utf8')
      JSON.parse(text)
      slices[slice] = text
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable.push(slice) }
  }
  const docs: Record<string, string> = {}
  for (const name of await readdir(join(dir, 'docs')).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -5)
    try {
      const text = await readFile(join(dir, 'docs', name), 'utf8')
      JSON.parse(text)
      docs[id] = text
    } catch { unreadable.push(`doc:${id}`) }
  }
  const envPath = existsSync(join(dir, 'environment.RData')) ? join(dir, 'environment.RData') : null
  return { meta, slices, docs, unreadable, envPath, hasBase: existsSync(join(dir, 'base.ourgeoproj')) }
}

/** Drop the changes; keep where the user was looking and the base copy. */
export async function discardDraft(path: string | null): Promise<DraftMeta> {
  const key = draftKey(path)
  return serial(key, async () => {
    const dir = dirFor(key)
    for (const slice of DRAFT_SLICES) if (slice !== 'view') await unlink(join(dir, `${slice}.json`)).catch(() => undefined)
    await rm(join(dir, 'docs'), { recursive: true, force: true })
    await unlink(join(dir, 'environment.RData')).catch(() => undefined)
    return writeMeta(key, { changed: false, checkpointAt: null }, path)
  })
}

/** Keep a copy of the bundle as the base for conflict detection and merging. */
export async function setBase(path: string): Promise<DraftMeta> {
  const key = draftKey(path)
  return serial(key, async () => {
    const dir = dirFor(key)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const signature = await fileSignature(path)
    if (!signature) throw new Error(`${path} is missing. Choose the project file again.`)
    const temp = join(dir, `base.${process.pid}.tmp`)
    await copyFile(path, temp)
    if (await fileSignature(temp) !== signature) { await unlink(temp).catch(() => undefined); throw new Error('The project changed while ouRGeo copied it. Open it again.') }
    await rename(temp, join(dir, 'base.ourgeoproj'))
    return writeMeta(key, { baseSignature: signature, baseSavedAt: new Date().toISOString() }, path)
  })
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(full)
    else total += (await stat(full).catch(() => ({ size: 0 }))).size
  }
  return total
}

export async function listDrafts(): Promise<DraftListing[]> {
  const out: DraftListing[] = []
  for (const key of await readdir(root()).catch(() => [] as string[])) {
    if (key === SCRATCH_KEY) continue
    const meta = await readJson<DraftMeta>(join(dirFor(key), 'meta.json'))
    if (!meta?.path) continue
    out.push({ key, path: meta.path, name: meta.name, updatedAt: meta.updatedAt, changed: meta.changed === true, bytes: await directorySize(dirFor(key)), fileExists: existsSync(meta.path), open: openLocks.has(key) })
  }
  return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** Delete drafts by key. Never touches a `.ourgeoproj`, and refuses the
 *  project open in this window — deleting its draft underneath it would be
 *  rewritten a second later, and silently. */
export async function deleteDrafts(keys: string[]): Promise<number> {
  let deleted = 0
  for (const key of keys) {
    if (!/^[a-f0-9]{32}$/.test(key) || openLocks.has(key)) continue
    await rm(dirFor(key), { recursive: true, force: true })
    deleted++
  }
  return deleted
}

export async function deleteDraftsOlderThan(days: number): Promise<number> {
  const now = Date.now()
  return deleteDrafts((await listDrafts()).filter(draft => olderThan(draft.updatedAt, days, now)).map(draft => draft.key))
}

// ── R checkpoints ─────────────────────────────────────────────────────────────
/** Where R writes a checkpoint: a temp name beside the real one, so a
 *  checkpoint that never finishes leaves the previous one in place. */
export async function checkpointTarget(path: string | null): Promise<{ temp: string; final: string }> {
  const dir = dirFor(draftKey(path))
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return { temp: join(dir, `environment.${Date.now()}.partial.RData`), final: join(dir, 'environment.RData') }
}

export async function commitCheckpoint(path: string | null, temp: string, at: string, ms: number): Promise<DraftMeta> {
  const key = draftKey(path), dir = dirFor(key)
  if (!resolve(temp).startsWith(resolve(dir) + sep) || !/environment\.\d+\.partial\.RData$/.test(temp)) throw new Error('Checkpoint path is outside the draft.')
  return serial(key, async () => {
    const handle = await open(temp, 'r+')
    try { await handle.sync() } finally { await handle.close() }
    await rename(temp, join(dir, 'environment.RData'))
    await syncDirectory(dir).catch(() => false)
    // Leftover partial files are abandoned checkpoints (§1.2): never loaded.
    for (const name of await readdir(dir)) if (/^environment\.\d+\.partial\.RData$/.test(name) && join(dir, name) !== temp) await unlink(join(dir, name)).catch(() => undefined)
    return writeMeta(key, { checkpointAt: at, checkpointMs: ms }, path)
  })
}

export async function abandonCheckpoint(temp: string): Promise<void> {
  if (/environment\.\d+\.partial\.RData$/.test(temp) && resolve(temp).startsWith(resolve(root()))) await unlink(temp).catch(() => undefined)
}

// ── One window per project ────────────────────────────────────────────────────
const openLocks = new Map<string, FSWatcher | null>()
let focusHandler: (() => void) | null = null
export function onFocusRequested(handler: () => void): void { focusHandler = handler }

/** Linux reports a process's start time; elsewhere a live pid is trusted. A
 *  recycled pid would otherwise keep a crashed project locked for ever. */
function processStart(pid: number): string | null {
  if (process.platform !== 'linux') return null
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null
  } catch { return null }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

export async function acquireLock(path: string): Promise<{ ok: true } | { ok: false; pid: number }> {
  const key = draftKey(path), dir = dirFor(key), file = join(dir, 'lock.json')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const existing = await readJson<LockRecord>(file)
  if (existing && existing.pid !== process.pid && !lockIsStale(existing, { alive: alive(existing.pid), start: processStart(existing.pid) })) return { ok: false, pid: existing.pid }
  const record: LockRecord = { pid: process.pid, start: processStart(process.pid), acquiredAt: new Date().toISOString() }
  await atomicWrite(file, JSON.stringify(record))
  if (!openLocks.has(key)) {
    let watcher: FSWatcher | null = null
    try {
      watcher = watch(dir, { persistent: false }, (_event, name) => {
        if (name !== 'focus-request') return
        void unlink(join(dir, 'focus-request')).catch(() => undefined)
        focusHandler?.()
      })
    } catch { watcher = null }
    openLocks.set(key, watcher)
  }
  return { ok: true }
}

export async function releaseLock(path: string): Promise<void> {
  const key = draftKey(path), file = join(dirFor(key), 'lock.json')
  openLocks.get(key)?.close()
  openLocks.delete(key)
  const existing = await readJson<LockRecord>(file)
  if (existing?.pid === process.pid) await unlink(file).catch(() => undefined)
}

/** Ask the window that holds the project to come forward. */
export async function requestFocus(path: string): Promise<void> {
  await atomicWrite(join(dirFor(draftKey(path)), 'focus-request'), String(Date.now()))
}

function releaseAllLocksSync(): void {
  for (const key of openLocks.keys()) {
    try {
      const file = join(dirFor(key), 'lock.json')
      const existing = JSON.parse(readFileSync(file, 'utf8')) as LockRecord
      if (existing.pid === process.pid) writeFileSync(file, JSON.stringify({ ...existing, pid: -1 }))
    } catch { /* already gone */ }
  }
}

// ── Clean exit and the project to reopen ──────────────────────────────────────
interface LastSession { cleanExit: boolean; project: string | null }
const lastSessionFile = (): string => join(app.getPath('userData'), 'last-session.json')
let launch: LaunchState = { firstLoad: true, crashed: false, project: null }
let currentProject: string | null = null
let renderedOnce = false

/** Read how the last session ended, then mark this one as running. Called
 *  once, before the window exists. */
export function beginSession(): void {
  let previous: LastSession | null = null
  try { previous = JSON.parse(readFileSync(lastSessionFile(), 'utf8')) as LastSession } catch { previous = null }
  currentProject = previous?.project && existsSync(previous.project) ? previous.project : null
  launch = { firstLoad: true, crashed: previous !== null && previous.cleanExit === false, project: currentProject }
  // Session-scoped files survive a renderer reload, which is what they are
  // for; a fresh process never reads them. Scratch's map, plots and console are
  // dropped on leaving it (§2.2), and a crash must not resurrect them (§3.2).
  for (const file of SESSION_SCOPED_FILES) {
    try { unlinkSync(join(app.getPath('userData'), file)) } catch { /* absent */ }
  }
  writeLastSession(false)
}

function writeLastSession(cleanExit: boolean): void {
  try { writeFileSync(lastSessionFile(), JSON.stringify({ cleanExit, project: currentProject } satisfies LastSession)) }
  catch (error) { console.error('[Drafts] Could not record session state:', error) }
}

/** Written at the very end of will-quit. Its absence is the crash signal. */
export function markCleanExit(): void {
  releaseAllLocksSync()
  writeLastSession(true)
}

// ── IPC ───────────────────────────────────────────────────────────────────────
export function registerProjectDrafts(ipcMain: IpcMain): void {
  ipcMain.handle('drafts:launch', (event): LaunchState => {
    requireContextOwner(event)
    // A renderer reload is not a launch: R and this process kept everything,
    // and only the window needs putting back.
    const state = renderedOnce ? { firstLoad: false, crashed: false, project: currentProject } : launch
    renderedOnce = true
    return state
  })
  ipcMain.handle('drafts:setProject', (event, path: string | null) => {
    requireContextOwner(event)
    currentProject = typeof path === 'string' ? path : null
    writeLastSession(false)
  })
  ipcMain.handle('drafts:read', (event, path: string | null) => { requireContextOwner(event); return readDraft(path) })
  ipcMain.handle('drafts:write', (event, path: string | null, input: DraftWrite) => { requireContextOwner(event); return writeDraft(path, input) })
  ipcMain.handle('drafts:discard', (event, path: string | null) => { requireContextOwner(event); return discardDraft(path) })
  ipcMain.handle('drafts:setBase', (event, path: string) => { requireContextOwner(event); return setBase(path) })
  ipcMain.handle('drafts:basePath', async (event, path: string) => {
    requireContextOwner(event)
    const base = join(dirFor(draftKey(path)), 'base.ourgeoproj')
    return existsSync(base) ? base : null
  })
  ipcMain.handle('drafts:signature', (event, path: string) => { requireContextOwner(event); return fileSignature(path) })
  ipcMain.handle('drafts:fileInfo', async (event, path: string) => {
    requireContextOwner(event)
    try { const info = await stat(path); return { exists: true, mtime: info.mtime.toISOString(), size: info.size } }
    catch { return { exists: false, mtime: null, size: 0 } }
  })
  ipcMain.handle('drafts:list', (event) => { requireContextOwner(event); return listDrafts() })
  ipcMain.handle('drafts:delete', (event, keys: string[]) => { requireContextOwner(event); return deleteDrafts(Array.isArray(keys) ? keys : []) })
  ipcMain.handle('drafts:deleteOlderThan', (event, days: number) => { requireContextOwner(event); return deleteDraftsOlderThan(Number(days)) })
  ipcMain.handle('drafts:checkpointTarget', (event, path: string | null) => { requireContextOwner(event); return checkpointTarget(path) })
  ipcMain.handle('drafts:commitCheckpoint', (event, path: string | null, temp: string, at: string, ms: number) => { requireContextOwner(event); return commitCheckpoint(path, temp, at, ms) })
  ipcMain.handle('drafts:abandonCheckpoint', (event, temp: string) => { requireContextOwner(event); return abandonCheckpoint(temp) })
  ipcMain.handle('drafts:lock', (event, path: string) => { requireContextOwner(event); return acquireLock(path) })
  ipcMain.handle('drafts:unlock', (event, path: string) => { requireContextOwner(event); return releaseLock(path) })
  ipcMain.handle('drafts:focusOwner', (event, path: string) => { requireContextOwner(event); return requestFocus(path) })
}
