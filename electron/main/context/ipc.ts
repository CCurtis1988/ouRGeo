import { app, safeStorage, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryRecord, MemoryDeletion, AuthorisedFileLink, ProjectContext } from '../../../src/lib/context/types'
import { redactContext } from '../../../src/lib/context/policy'
import { validateProjectContext } from '../../../src/lib/context/memory-schema'
import { contextLease, closeContextProject, requireProjectLease } from './scope'
import { memoryCandidate } from '../../../src/lib/context/learning'
import { getLearningPolicy, configureLearningPolicy, learningPolicyRevision } from './learning-policy'
import { collectFileLinks } from './file-links'
import { protectedMemoryKey } from './key'
import { validateExclusions, type ExclusionScope } from '../../../src/lib/context/exclusions'
import { protectedPolicyAbsent } from './policy-store'
import { registerMemoryConnectionHandlers } from './providers/connections'
import { registerManagedRuntimeHandlers } from './managed-runtime'

let starting: Promise<Worker> | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

async function worker(): Promise<Worker> {
  if (!starting) starting = (async () => {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Protected storage is unavailable. Enable your OS keyring to use personal memory; conversation and project retrieval still work.')
    }
    const dir = join(app.getPath('userData'), 'context')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    const key = await protectedMemoryKey(dir, safeStorage)
    const child = new Worker(join(__dirname, 'context-worker.js'), { workerData: { path: join(dir, 'canonical.sqlite'), key } })
    key.fill(0)
    child.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error))
      else call?.resolve(message.result)
    })
    child.on('error', error => { for (const call of pending.values()) call.reject(error); pending.clear(); starting = undefined })
    child.on('exit', () => { for (const call of pending.values()) call.reject(new Error('Memory worker stopped. Try again.')); pending.clear(); starting = undefined })
    child.unref()
    return child
  })().catch(error => { starting = undefined; throw error })
  return starting
}

async function dispatch(op: string, value?: unknown, guard?: () => void): Promise<unknown> {
  const child = await worker()
  guard?.()
  if (pending.size >= 32) throw new Error('Memory is busy. Try again shortly.')
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Memory operation timed out. Reopen the library to verify its state.')) }, 5000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    child.postMessage({ id, op, value })
  })
}

async function projectDispatch(op: string, value: unknown, projectId: string, lease: unknown): Promise<unknown> {
  const guard = (): void => requireProjectLease(projectId, lease)
  guard()
  const result = await dispatch(op, value, guard)
  guard()
  return result
}

let owner: () => WebContents | undefined = () => undefined
function authorised(event: IpcMainInvokeEvent): void {
  if (event.sender !== owner() || event.senderFrame !== event.sender.mainFrame) throw new Error('Memory is available only in the main workspace.')
}
export function requireContextOwner(event: IpcMainInvokeEvent): void { authorised(event) }
function memoryId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Choose a memory from the library.')
  return id
}

/** Only the successful bundle packer calls this; no model or renderer can
 * clear another project's recovery journal by supplying its UUID. */
export async function savedProjectDraft(projectId: string, context: ProjectContext, previousProjectId: string | null, leaseId: string): Promise<void> {
  const guard = (): void => { if (contextLease().id !== leaseId) throw new Error('SCOPE_CHANGED') }
  await dispatch('commitProject', { projectId: memoryId(projectId), context }, guard)
  if (previousProjectId && previousProjectId !== projectId) await dispatch('discardProject', previousProjectId, guard)
}
export async function registerProjectMemory(projectId: string, ids: string[]): Promise<string[]> {
  return await dispatch('registerProjectReferences', { projectId, ids }) as string[]
}

/** Local file access is remembered only after a successful save on this
 * profile. A portable manifest cannot grant itself these links on import. */
export async function savedFileLinks(projectId: string, tabs: unknown, databases: unknown): Promise<void> {
  memoryId(projectId)
  const links = collectFileLinks(tabs, databases)
  await dispatch('saveFileLinks', { projectId, links })
}
export async function projectFileLinks(projectId: string): Promise<AuthorisedFileLink[]> {
  return await dispatch('fileLinks', projectId) as AuthorisedFileLink[]
}
export async function projectLocation(projectId: string): Promise<string | null> {
  return await dispatch('projectLocation', memoryId(projectId)) as string | null
}
export async function savedProjectLocation(projectId: string, path: string): Promise<void> {
  await dispatch('saveProjectLocation', { projectId: memoryId(projectId), path })
}

export function registerContextHandlers(ipc: IpcMain, workspace: () => WebContents | undefined): void {
  owner = workspace
  registerMemoryConnectionHandlers(ipc, authorised, dispatch, contextLease)
  registerManagedRuntimeHandlers(ipc, authorised, join(app.getPath('userData'), 'memory-runtimes'), join(__dirname, 'mnemosyne-sidecar.py'))
  ipc.handle('context:lease', event => { authorised(event); return contextLease() })
  ipc.handle('context:learningSettings', async event => { authorised(event); return (await getLearningPolicy()).settings })
  ipc.handle('context:configureLearning', (event, settings) => { authorised(event); return configureLearningPolicy(settings) })
  ipc.handle('context:closeProject', (event, lease) => { authorised(event); closeContextProject(lease) })
  ipc.handle('context:exclusions', async (event, lease) => {
    authorised(event)
    const current = contextLease()
    if (lease !== current.id) throw new Error('SCOPE_CHANGED')
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    if ((!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'))
        && await protectedPolicyAbsent(join(app.getPath('userData'), 'context'))) {
      guard()
      return []
    }
    const global = await dispatch('exclusions', 'global', guard) as string[]
    const application = await dispatch('exclusions', 'application', guard) as string[]
    const project = current.projectId ? await dispatch('exclusions', `project:${current.projectId}`, guard) as string[] : []
    guard()
    return [{ scope: 'global', projectId: null, ids: global }, { scope: 'application', projectId: null, ids: application }, { scope: 'project', projectId: current.projectId, ids: project }]
  })
  ipc.handle('context:exclude', (event, input) => {
    authorised(event)
    if (!input || !['application', 'global', 'project'].includes(input.scope) || typeof input.excluded !== 'boolean') throw new Error('Choose a source in the Context inspector.')
    const scope = input.scope as ExclusionScope
    const [id] = validateExclusions([input.id], scope)
    const guard = (): void => {
      if (scope === 'project') requireProjectLease(memoryId(input.projectId), input.lease)
      else if (input.projectId !== null) throw new Error('Choose the source’s own scope.')
    }
    guard()
    return dispatch('exclude', { scope: scope === 'project' ? `project:${input.projectId}` : scope, id, excluded: input.excluded }, guard)
  })
  ipc.handle('context:listGlobal', event => { authorised(event); return dispatch('list') })
  ipc.handle('context:storageStatus', async event => { authorised(event); return { empty: await protectedPolicyAbsent(join(app.getPath('userData'), 'context')) } })
  ipc.handle('context:saveGlobal', async (event, input: MemoryRecord, preserveCandidate = false) => {
    authorised(event)
    if (!input || typeof input.statement !== 'string' || !input.statement.trim() || input.statement.length > 4000 || redactContext(input.statement) !== input.statement) throw new Error('Memory must contain a short statement without credentials.')
    const now = new Date().toISOString()
    const id = memoryId(input.id)
    const records = await dispatch('list') as MemoryRecord[]
    const previous = records.find(record => record.id === id)
    if (previous?.revision === input.revision && previous.statement === input.statement.trim()) return previous
    if (previous && input.revision !== previous.revision + 1) throw new Error('This memory changed. Refresh the library before editing it.')
    // Renderer-supplied scopes, provenance and status never select namespaces.
    const evidence = previous?.evidence ?? (Array.isArray(input.evidence) ? input.evidence.filter(source => typeof source === 'string' && /^[a-f0-9-]{36}$/i.test(source)).slice(0, 32) : [])
    const record: MemoryRecord = { id, revision: previous ? previous.revision + 1 : 1, scope: 'global', projectId: null, category: 'preference', statement: input.statement.trim(), evidence, assertion: 'user-declared', createdAt: previous?.createdAt ?? now, updatedAt: now, status: preserveCandidate === true && previous?.status === 'candidate' ? 'candidate' : 'active', supersedes: previous?.supersedes ?? [], ...(input.pinned === true ? { pinned: true } : {}) }
    if (previous?.editedAt) record.editedAt = previous.editedAt
    if (previous && previous.statement !== record.statement) record.editedAt = now
    return dispatch('save', record)
  })
  ipc.handle('context:forget', (event, id, input: MemoryDeletion) => {
    authorised(event)
    if (!input || !['global', 'project'].includes(input.scope)) throw new Error('Choose the memory scope in the library.')
    const { sources } = input
    if (!Array.isArray(sources) || sources.length > 32) throw new Error('Select one memory to forget.')
    if (sources.some(source => typeof source !== 'string' || !/^[a-zA-Z0-9_:.-]{1,128}$/.test(source))) throw new Error('Source event identities are unavailable. Refresh the memory library.')
    if (input.scope === 'global') return dispatch('forget', { id: memoryId(id), sources, scope: 'global' })
    const lease = contextLease()
    const guard = (): void => {
      if (input.projectId) requireProjectLease(input.projectId, input.lease)
      else if (contextLease().id !== input.lease || contextLease().projectId !== null) throw new Error('SCOPE_CHANGED')
    }
    guard()
    return dispatch('forget', { id: memoryId(id), sources, scope: input.projectId ? `project:${input.projectId}` : `draft:${lease.id}` }, guard)
  })
  ipc.handle('context:filterLearningSources', (event, ids) => {
    authorised(event)
    if (!Array.isArray(ids) || ids.length > 32) throw new Error('Inspect a bounded selection of source events.')
    return dispatch('filterLearningSources', ids.map(memoryId))
  })
  ipc.handle('context:learnGlobal', async (event, input) => {
    authorised(event)
    if (!input || typeof input.text !== 'string') throw new Error('Choose a user-declared preference.')
    const candidate = memoryCandidate(input.text)
    if (!candidate || candidate.scope !== 'global') return null
    const lease = contextLease()
    const { settings, revision } = await getLearningPolicy()
    if (settings.globalLearning === 'asked' || (!lease.projectId && !settings.scratchLearning)) return null
    const now = new Date().toISOString()
    const record: MemoryRecord = { id: randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: candidate.statement, evidence: [memoryId(input.messageId)], assertion: 'user-declared', createdAt: now, updatedAt: now, status: settings.globalLearning === 'automatic' ? 'active' : 'candidate', supersedes: [] }
    return dispatch('learn', record, () => { if (contextLease().id !== lease.id || learningPolicyRevision() !== revision) throw new Error('SCOPE_CHANGED') })
  })
  ipc.handle('context:filterDeleted', (event, ids) => {
    authorised(event)
    if (!Array.isArray(ids) || ids.length > 10000) throw new Error('Project memory is too large. Import a smaller selection.')
    return dispatch('filter', ids.map(memoryId))
  })
  ipc.handle('context:stageProject', (event, projectId, baseRevision, input, lease) => {
    authorised(event)
    const id = memoryId(projectId)
    requireProjectLease(id, lease)
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error('Reload the saved project before remembering a decision.')
    const context = validateProjectContext(input, id)
    if (JSON.stringify(context).length > 8_000_000) throw new Error('Project memory exceeds the recovery limit. Export a smaller selection.')
    return projectDispatch('stageProject', { projectId: id, baseRevision, context }, id, lease)
  })
  ipc.handle('context:recoverProject', (event, projectId, baseRevision, lease) => {
    authorised(event)
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error('Project revision is unavailable. Reopen the project.')
    requireProjectLease(memoryId(projectId), lease)
    return projectDispatch('recoverProject', { projectId: memoryId(projectId), baseRevision }, memoryId(projectId), lease)
  })
  ipc.handle('context:discardProject', (event, projectId, lease) => { authorised(event); return projectDispatch('discardProject', memoryId(projectId), memoryId(projectId), lease) })
}
