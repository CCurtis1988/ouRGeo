import { app, dialog, safeStorage, type IpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { fetchWithoutLocalProbes } from '../local-network'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryRecord, MemoryDeletion, AuthorisedFileLink, ProjectContext } from '../../../src/lib/context/types'
import { redactContext } from '../../../src/lib/context/policy'
import { validateProjectContext } from '../../../src/lib/context/memory-schema'
import { contextLease, closeContextProject, requireProjectLease, subscribeContextScope } from './scope'
import { memoryCandidate } from '../../../src/lib/context/learning'
import { getLearningPolicy, configureLearningPolicy, learningPolicyRevision } from './learning-policy'
import { collectFileLinks } from './file-links'
import { protectedMemoryKey } from './key'
import { validateExclusions, type ExclusionScope } from '../../../src/lib/context/exclusions'
import { protectedPolicyAbsent } from './policy-store'
import { registerMemoryConnectionHandlers } from './providers/connections'
import { registerManagedRuntimeHandlers, type ManagedMnemosyneRuntime } from './managed-runtime'
import { ProviderActivation } from './providers/activation'
import { DeploymentRegistry, REVIEWED_EXTERNAL_DEPLOYMENTS } from './providers/certification'
import { managedDeploymentReview, localServerDeploymentReview } from './managed-profile'
import { MnemosyneLocalServer } from './providers/local-server'
import { createLocalServerMnemosyne } from './providers/local-server-mnemosyne'
import { MNEMOSYNE_LOCAL_CANDIDATE } from './runtime-catalogue'
import { PluginProviderContributions } from './providers/plugin-contributions'
import { version as applicationVersion } from '../../../package.json'
import { createManagedMnemosyne } from './providers/managed-mnemosyne'
import { createHindsightProvider } from './providers/hindsight'
import { createJsonTransport } from './providers/transport'
import type { CanonicalScopeSnapshot } from '../../../src/lib/context/providers/types'
import type { MemoryRecallRequest } from '../../../src/lib/context/providers/recall'
import type { MemoryConnection } from '../../../src/lib/context/providers/connections'
import { registerContextFolders } from './folders-ipc'
import { type InferenceUsageInput } from '../../../src/lib/context/inference-usage'
import { validateColumnPolicy } from '../../../src/lib/context/column-policy'
import { MemoryWriteRecovery } from '../../../src/lib/context/storage-recovery'
import { memoryBackupCatalog } from './storage-recovery'
import { MEMORY_SCHEMA_VERSION } from './storage'
import { UsageAuthority } from './usage-authority'
import { LocalCleanupRunner } from './cleanup'
import type { LocalCleanupJob } from './cleanup'
import type { MemoryCleanupStatus } from '../../../src/lib/context/types'

const usageAuthority = new UsageAuthority()
const writeRecovery = new MemoryWriteRecovery()
let starting: Promise<Worker> | undefined
let nextId = 0
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
let providerActivation: ProviderActivation | undefined
let managedRuntime: ManagedMnemosyneRuntime | undefined
let cleanupRunner: LocalCleanupRunner | undefined
let retentionTimer: ReturnType<typeof setTimeout> | undefined
let pluginProviders: PluginProviderContributions | undefined
let localMemoryServer: MnemosyneLocalServer | undefined
let localServerPolicyRevision = 0
let retentionStopped = false
const accountingMutations = new Set(['recordInferenceUsage', 'prepareInferenceUsage', 'configureChatBudget', 'acknowledgeMigrationWrites'])
const providerMutations = new Set([ 'saveColumnPolicies', 'forkColumnPolicies', 'restoreBackup', 'stageProject', 'sweepRetention', 'save', 'forget', 'learn', 'commitProject', 'saveConnection', 'removeConnection', 'activateBinding', 'importBinding', 'beginMigration', 'beginBuiltinMigration', 'finishMigration', 'cancelMigration', 'configureBinding', 'configureMaintenance', 'exclude'])
export function stopContextProviders(): void { retentionStopped = true; clearTimeout(retentionTimer); providerActivation?.stop(); cleanupRunner?.stop(); pluginProviders?.close(); void localMemoryServer?.close() }

async function sweepRetention(): Promise<void> {
  if (retentionStopped) return
  let delay = 3_600_000
  try {
    const result = await dispatch('sweepRetention') as { more: boolean; removed: number }
    if (result.removed) cleanupRunner?.wake()
    if (result.more) delay = 1000
  } catch {
    // An unavailable keyring/corrupt store is already surfaced by normal
    // memory operations. Retry idle cleanup without creating plaintext storage.
    delay = 60_000
  }
  if (!retentionStopped) { retentionTimer = setTimeout(() => void sweepRetention(), delay); retentionTimer.unref() }
}

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
    child.on('message', (message: { id: number; result?: unknown; error?: string; retentionChanged?: boolean }) => {
      if (message.retentionChanged) { providerActivation?.invalidate(); cleanupRunner?.wake(); owner()?.send('context:retentionChanged') }
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
  // Revoke synchronous routing authority before a queued canonical/policy
  // mutation can race with a network request. Failed writes stay revoked.
  const mutation = providerMutations.has(op)
  if (mutation) { localServerPolicyRevision++; providerActivation?.invalidate() }
  if (op === 'saveConnection' && (value as { connection?: MemoryConnection })?.connection?.state === 'disconnected') localMemoryServer?.revoke((value as { connection: MemoryConnection }).connection.id)
  if (op === 'removeConnection') localMemoryServer?.revoke(String(value))
  if (mutation || accountingMutations.has(op)) writeRecovery.assertWritable()
  const child = await worker().catch(error => { writeRecovery.failed(error); throw error })
  guard?.()
  if (pending.size >= 32) throw new Error('Memory is busy. Try again shortly.')
  const result = await new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Memory operation timed out. Reopen the library to verify its state.')) }, 5000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    child.postMessage({ id, op, value })
  }).catch(error => { writeRecovery.failed(error); throw error })
  if (op === 'forget' && managedRuntime) {
    const scope = (value as { scope?: string }).scope
    try {
      await cleanupRunner?.flush()
      const status = await dispatch('cleanupStatus', scope ? [scope] : []) as MemoryCleanupStatus
      if (status.pending || status.needsReview) throw new Error('Cleanup is pending')
    } catch {
      // Canonical deletion has committed. A cache permission failure must not
      // leave its old renderer copy eligible for another prompt.
      providerActivation?.wake()
      return { local: 'excluded', managed: 'pending', recovery: 'Managed cache cleanup is pending and will retry after restart. Restore private runtime directory access, then use Retry local cleanup in Context & memory settings; future retrieval stays blocked.' }
    }
    if (mutation) providerActivation?.wake()
    return { local: 'excluded', managed: 'removed' }
  }
  if (mutation) providerActivation?.wake()
  return result
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
  if (previousProjectId && previousProjectId !== projectId) await dispatch('forkColumnPolicies', { fromProjectId: previousProjectId, projectId }, guard)
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
  registerContextFolders(ipc, authorised, async () => {
    const window = owner()
    if (!window) throw new Error('The workspace is unavailable.')
    const result = await dialog.showOpenDialog({ title: 'Choose a context source folder', properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }, () => owner()?.send('context:foldersChanged'))
  const bridgeFile = join(__dirname, 'mnemosyne-sidecar.py')
  const runtime = registerManagedRuntimeHandlers(ipc, authorised, join(app.getPath('userData'), 'memory-runtimes'), bridgeFile)
  managedRuntime = runtime
  cleanupRunner = new LocalCleanupRunner({
    jobs: async () => await dispatch('cleanupJobs') as LocalCleanupJob[],
    remove: namespace => runtime.forgetDerived([namespace]),
    complete: (job, success, now) => dispatch('completeCleanup', { job, success, now }).then(() => undefined),
  })
  cleanupRunner.wake()
  retentionStopped = false
  retentionTimer = setTimeout(() => void sweepRetention(), 1000)
  retentionTimer.unref()
  pluginProviders = new PluginProviderContributions(app.getPath('userData'), applicationVersion)
  localMemoryServer = new MnemosyneLocalServer(runtime, async (registration, payload) => {
    const lease = contextLease(), revision = localServerPolicyRevision
    const current = (): boolean => lease.id === contextLease().id && revision === localServerPolicyRevision
    const guard = () => { if (!current()) throw new Error('SCOPE_CHANGED') }
    const scopes = ['global', ...(lease.projectId ? [`project:${lease.projectId}`] : [])]
    const connection = await dispatch('scopedConnection', { id: registration.id, scopes }, guard) as MemoryConnection | undefined
    if (!connection || !localMemoryServer!.owns(connection) || connection.state === 'disconnected' || connection.state !== 'reachable' && payload.operation !== 'probe') throw new Error('POLICY_REFUSED')
    if (payload.operation === 'replace') {
      if (typeof payload.invocationId !== 'string') throw new Error('POLICY_REFUSED')
      const job = await dispatch('currentOutbox', { id: payload.invocationId, scopes }, guard) as import('../../../src/lib/context/providers/outbox').OutboxJob | null
      if (!job || job.binding.connectionRef !== connection.id || job.binding.namespaceRef !== registration.namespace) throw new Error('POLICY_REFUSED')
      const snapshot = await dispatch('bindingSnapshot', { bindingId: job.binding.id, scope: job.binding.scope }, guard) as CanonicalScopeSnapshot
      const expected = snapshot.records.map(record => ({ id: record.id, revision: record.revision, text: record.statement, updatedAt: record.updatedAt }))
      if (payload.generation !== snapshot.generation || JSON.stringify(payload.records) !== JSON.stringify(expected)) throw new Error('POLICY_REFUSED')
    }
    guard(); return current
  })
  const registry = new DeploymentRegistry(REVIEWED_EXTERNAL_DEPLOYMENTS, Date.now, connection => pluginProviders!.eligible(connection) && (!connection.localServer || localMemoryServer!.owns(connection)))
  providerActivation = new ProviderActivation({ dispatch, lease: contextLease, registry,
    fetcher: fetchWithoutLocalProbes,
    prepareManaged: async connections => {
      for (const connection of connections.filter(item => item.location === 'managed-local' && item.state === 'reachable' && pluginProviders!.eligible(item))) {
        registry.registerManaged(await managedDeploymentReview(connection, await runtime.installed(), bridgeFile))
      }
      for (const connection of connections.filter(item => item.localServer && item.state === 'reachable' && localMemoryServer!.owns(item))) registry.registerLocalServer(await localServerDeploymentReview(connection, await runtime.installed(), bridgeFile, localMemoryServer!))
    },
    provider: async (connection, token, certificate) => {
      if (connection.location !== 'managed-local' && !connection.localServer) {
        if (connection.adapter !== 'hindsight') throw new Error('Review this external Mnemosyne deployment before routing memory.')
        return createHindsightProvider(connection.id, createJsonTransport({ endpoint: connection.endpoint, local: connection.location === 'loopback', token }, fetchWithoutLocalProbes))
      }
      if (connection.localServer) await localServerDeploymentReview(connection, await runtime.installed(), bridgeFile, localMemoryServer!)
      else await managedDeploymentReview(connection, await runtime.installed(), bridgeFile)
      const lease = contextLease()
      const guard = () => { if (contextLease().id !== lease.id) throw new Error('SCOPE_CHANGED') }
      const canonical = {
        snapshot: async (namespace: string, signal: AbortSignal) => {
          signal.throwIfAborted(); guard()
          if (namespace !== connection.namespaceRef) throw new Error('POLICY_REFUSED')
          const snapshot = await dispatch('bindingSnapshot', { bindingId: certificate.bindingId, scope: connection.scope }, guard) as CanonicalScopeSnapshot
          guard(); signal.throwIfAborted()
          return { ...snapshot, namespace }
        },
        current: async (snapshot: import('./providers/managed-mnemosyne').CanonicalSnapshot, signal: AbortSignal) => {
          signal.throwIfAborted(); guard()
          const current = await dispatch('bindingSnapshotCurrent', { bindingId: certificate.bindingId, scope: connection.scope, generation: snapshot.generation }, guard)
          guard(); signal.throwIfAborted()
          return current === true
        },
      }
      return connection.localServer ? createLocalServerMnemosyne(connection.id, createJsonTransport({ endpoint: connection.endpoint, local: true, token }, fetchWithoutLocalProbes), canonical)
        : createManagedMnemosyne(MNEMOSYNE_LOCAL_CANDIDATE.id, { request: (payload, host) => runtime.request(payload as Record<string, unknown>, host) }, canonical)
    },
    approve: async (preview, connection) => {
      if (['migrate', 'migrate-builtin', 'cleanup'].includes(preview.operation)) {
        const cleanup = preview.operation === 'cleanup', builtin = preview.operation === 'migrate-builtin'
        const review = await dialog.showMessageBox({ type: 'question', title: cleanup ? 'Remove old-provider copies' : 'Migrate memory provider', buttons: ['Cancel', cleanup ? 'Delete old copies' : 'Migrate'], defaultId: 0, cancelId: 0,
          message: cleanup ? `Remove all ${preview.oldCopyCount} previously approved memory copies from ${preview.label}?` : `Use ${preview.label} for ${preview.scope === 'global' ? 'About you' : 'this saved project'}?`,
          detail: cleanup ? 'Canonical memories remain in ouRGeo. This removes old-provider copies only after current destination acknowledgements. Uncertain old writes block deletion. Other provider namespaces are unaffected; deletion stays pending until verified.' : `${builtin ? 'Canonical memories are already stored locally; this sends no memory to a provider.' : `Copy ${preview.selectedCount} selected committed memories and route future approved updates to this reviewed provider.\n\n${connection.destinations.map(item => `${item.purpose}: ${item.destination}`).join('\n')}`}\n\nThe old provider is paused. Its copies remain until you separately choose to keep or remove them. Canonical scope and IDs are preserved. Estimated processing: USD ${(preview.estimatedIngestionMicros / 1e6).toFixed(6)}; limits are estimated, not an invoice cap.` })
        return review.response === 1
      }
      const review = await dialog.showMessageBox({ type: 'question', title: preview.operation === 'import' ? 'Import selected memories' : 'Activate memory processing', buttons: ['Cancel', preview.operation === 'import' ? 'Import selected' : 'Activate'], defaultId: 0, cancelId: 0,
        message: `${preview.operation === 'import' ? 'Copy selected memories to' : 'Use'} ${preview.label} for ${preview.scope === 'global' ? 'About you' : 'this saved project'}?`,
        detail: `${connection.location === 'managed-local' ? 'This is an experimental beta native runtime with machine access and a readable derived SQLite store. The reviewed Linux lexical profile disables embeddings, extraction, reflection and sync. Your separately selected assistant still receives selected context.\n\n' : ''}${preview.operation === 'import' ? `This copies ${preview.selectedCount} selected committed memories. Future update permissions remain as previously approved.` : `This sends ${preview.selectedCount} selected committed memories and future approved changes to this provider.`} Estimated initial ingestion: USD ${(preview.estimatedIngestionMicros / 1e6).toFixed(6)}. Maintenance limits are estimated, not an invoice cap.\n\n${connection.destinations.map(item => `${item.purpose}: ${item.destination}`).join('\n')}\n\nPausing or disconnecting stops new requests; it does not erase already transmitted content.`,
      })
      return review.response === 1
    } })
  subscribeContextScope(() => { providerActivation?.invalidate(); providerActivation?.wake() })
  pluginProviders.observe(() => {
    providerActivation?.invalidate()
    void (async () => {
      const records = await dispatch('connections') as MemoryConnection[]
      const revoked = records.filter(connection => connection.contribution && !pluginProviders!.eligible(connection)).map(connection => connection.id)
      if (revoked.length) await dispatch('revokeContributionBindings', revoked)
      providerActivation?.wake()
    })().catch(() => { /* Live descriptor checks remain fail-closed; inspect settings to recover. */ })
  })
  ipc.handle('context:providerContributions', event => { authorised(event); return pluginProviders!.list() })
  ipc.handle('context:previewContributedProvider', async (event, ref, scope, suppliedLease) => {
    authorised(event)
    const lease = contextLease()
    if (suppliedLease !== lease.id || !['global', 'project'].includes(scope) || scope === 'project' && !lease.projectId) throw new Error('Choose About you or save this project before reviewing this provider.')
    const item = pluginProviders!.require(ref)
    const guard = () => { if (lease.id !== contextLease().id) throw new Error('SCOPE_CHANGED'); pluginProviders!.require(ref) }
    const resolvedScope = scope === 'global' ? 'global' : `project:${lease.projectId}`
    const records = await dispatch('connections', undefined, guard) as MemoryConnection[]
    let connection = records.find(connection => connection.scope === resolvedScope && connection.state !== 'disconnected' && connection.contribution?.pluginId === item.pluginId && connection.contribution.id === item.id && connection.contribution.manifestSha256 === item.manifestSha256)
    if (!connection) {
      connection = { id: randomUUID(), revision: 1, adapter: 'mnemosyne', label: `${item.label} · ${item.pluginId}`, location: 'managed-local', runtimeId: item.profileId, contribution: { pluginId: item.pluginId, id: item.id, manifestSha256: item.manifestSha256 },
        endpoint: 'on-device', scope: resolvedScope as MemoryConnection['scope'], namespaceRef: randomUUID(), credentialRef: null, certification: 'pending', state: 'reachable', createdAt: new Date().toISOString(),
        destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'on-device' : 'disabled' })) }
      registry.registerManaged(await managedDeploymentReview(connection, await runtime.installed(), bridgeFile))
      await dispatch('saveConnection', { connection }, guard)
    }
    guard(); return providerActivation!.preview(connection.id, [], lease.id)
  })
  providerActivation.wake()
  ipc.handle('context:previewLocalServerActivation', async (event, scope, suppliedLease, acknowledged) => {
    authorised(event)
    const lease = contextLease()
    if (acknowledged !== true || suppliedLease !== lease.id || !['global', 'project'].includes(scope) || scope === 'project' && !lease.projectId) throw new Error('Acknowledge the experimental runtime and choose a saved scope before reviewing the local server.')
    await runtime.installed()
    const guard = () => { if (contextLease().id !== lease.id) throw new Error('SCOPE_CHANGED') }
    const resolvedScope = scope === 'global' ? 'global' : `project:${lease.projectId}`
    const connections = await dispatch('connections', undefined, guard) as MemoryConnection[]
    let connection = connections.find(item => item.localServer && item.scope === resolvedScope && item.state !== 'disconnected')
    if (connection && !localMemoryServer!.owns(connection)) {
      const bindings = (await dispatch('scopedProviderState', [resolvedScope], guard) as { bindings: import('../../../src/lib/context/providers/outbox').ProviderBinding[] }).bindings
      for (const binding of bindings.filter(item => item.connectionRef === connection!.id && item.enabled)) await dispatch('configureBinding', { ...binding, enabled: false, policyRevision: binding.policyRevision + 1 }, guard)
      const token = await dispatch('scopedCredential', { reference: connection.credentialRef, scopes: [resolvedScope] }, guard) as string | undefined
      if (!token) throw new Error('Recover the protected local-server credential or remove its disconnected settings.')
      const registration = await localMemoryServer!.register(connection.id, connection.namespaceRef, connection.scope, token)
      connection = { ...connection, revision: connection.revision + 1, endpoint: registration.endpoint, state: 'reachable', destinations: connection.destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? registration.endpoint : 'disabled' })) }
      await dispatch('saveConnection', { connection }, guard)
    }
    if (!connection) {
      const id = randomUUID(), namespace = randomUUID(), registration = await localMemoryServer!.register(id, namespace, resolvedScope as MemoryConnection['scope'])
      connection = { id, revision: 1, adapter: 'mnemosyne', label: 'Mnemosyne local server · experimental', location: 'loopback', localServer: true, runtimeId: MNEMOSYNE_LOCAL_CANDIDATE.id,
        endpoint: registration.endpoint, scope: resolvedScope as MemoryConnection['scope'], namespaceRef: namespace, credentialRef: randomUUID(), certification: 'pending', state: 'reachable', createdAt: new Date().toISOString(),
        destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? registration.endpoint : 'disabled' })) }
      await dispatch('saveConnection', { connection, token: registration.token }, guard)
    }
    guard(); registry.registerLocalServer(await localServerDeploymentReview(connection, await runtime.installed(), bridgeFile, localMemoryServer!))
    return providerActivation!.preview(connection.id, [], lease.id)
  })
  ipc.handle('context:previewManagedActivation', async (event, scope, suppliedLease) => {
    authorised(event)
    const lease = contextLease()
    if (suppliedLease !== lease.id || !['global', 'project'].includes(scope) || scope === 'project' && !lease.projectId) throw new Error('Choose About you or save this project before activating managed memory.')
    const guard = () => { if (contextLease().id !== lease.id) throw new Error('SCOPE_CHANGED') }
    const resolvedScope = scope === 'global' ? 'global' : `project:${lease.projectId}`
    const records = await dispatch('connections', undefined, guard) as MemoryConnection[]
    let connection = records.find(item => item.location === 'managed-local' && !item.contribution && item.scope === resolvedScope && item.state !== 'disconnected')
    if (!connection) {
      connection = { id: randomUUID(), revision: 1, adapter: 'mnemosyne', label: 'Mnemosyne on this device · experimental', location: 'managed-local', runtimeId: MNEMOSYNE_LOCAL_CANDIDATE.id,
        endpoint: 'on-device', scope: resolvedScope as MemoryConnection['scope'], namespaceRef: randomUUID(), credentialRef: null, certification: 'pending', state: 'reachable', createdAt: new Date().toISOString(),
        destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'on-device' : 'disabled' })) }
      registry.registerManaged(await managedDeploymentReview(connection, await runtime.installed(), bridgeFile))
      await dispatch('saveConnection', { connection }, guard)
    }
    guard()
    return providerActivation!.preview(connection.id, [], lease.id)
  })
  ipc.handle('context:recallMemory', (event, input: MemoryRecallRequest, id, lease) => {
    authorised(event)
    if (!input || typeof input.query !== 'string' || input.query.length > 512 || !['global', 'project'].includes(input.scope)
      || [input.before, input.after].some(value => value !== undefined && (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value)))) || typeof lease !== 'string') throw new Error('Choose a bounded memory query in the active scope.')
    return providerActivation!.recall(input, memoryId(id), lease)
  })
  ipc.handle('context:cancelRecall', (event, id) => { authorised(event); providerActivation!.cancelRecall(memoryId(id)) })
  ipc.handle('context:activationStatus', event => { authorised(event); return providerActivation!.status() })
  ipc.handle('context:previewActivation', (event, id, ids, lease) => {
    authorised(event)
    if (!Array.isArray(ids) || ids.length > 1000 || typeof lease !== 'string') throw new Error('Choose a bounded memory selection in this workspace.')
    return providerActivation!.preview(memoryId(id), ids.map(memoryId), lease)
  })
  ipc.handle('context:previewMemoryImport', (event, id, ids, lease) => {
    authorised(event)
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || typeof lease !== 'string') throw new Error('Choose a bounded committed memory selection in this workspace.')
    return providerActivation!.preview(memoryId(id), ids.map(memoryId), lease, 'import')
  })
  ipc.handle('context:activateProvider', (event, ref) => { authorised(event); return providerActivation!.activate(memoryId(ref)) })
  ipc.handle('context:previewMemoryMigration', (event, id, ids, lease) => {
    authorised(event)
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || typeof lease !== 'string') throw new Error('Choose committed memories in this workspace before migrating.')
    return providerActivation!.preview(memoryId(id), ids.map(memoryId), lease, 'migrate')
  })
  ipc.handle('context:memoryMigrations', event => { authorised(event); return providerActivation!.migrationStatuses() })
  ipc.handle('context:finishMemoryMigration', (event, id, choice, lease) => { authorised(event); return providerActivation!.finishMigration(memoryId(id), choice, String(lease)) })
  ipc.handle('context:cancelMemoryMigration', (event, id, lease) => { authorised(event); return providerActivation!.cancelMigration(memoryId(id), String(lease)) })
  ipc.handle('context:useBuiltinMemory', (event, id, lease) => { authorised(event); return providerActivation!.useBuiltin(memoryId(id), String(lease)) })
  ipc.handle('context:pauseProvider', (event, id) => { authorised(event); return providerActivation!.pause(memoryId(id)) })
  registerMemoryConnectionHandlers(ipc, authorised, dispatch, contextLease)
  ipc.handle('context:maintenanceStatus', event => { authorised(event); return dispatch('maintenanceStatus') })
  ipc.handle('context:configureMaintenance', async (event, input, suppliedLease) => {
    authorised(event)
    const snapshot = contextLease().id
    const guard = (): void => { if (suppliedLease !== snapshot || contextLease().id !== snapshot) throw new Error('SCOPE_CHANGED: refresh maintenance settings before saving.') }
    guard()
    await dispatch('configureMaintenance', input, guard)
    guard()
    return dispatch('maintenanceStatus', undefined, guard)
  })
  ipc.handle('context:lease', event => { authorised(event); return contextLease() })
  ipc.handle('context:beginInferenceUsage', (event, chatId, turnId, provider, lease, model) => {
    authorised(event)
    return usageAuthority.begin(contextLease(), lease, chatId, turnId, provider, model)
  })
  ipc.handle('context:chatBudgetStatus', event => { authorised(event); return dispatch('chatBudgetStatus') })
  ipc.handle('context:configureChatBudget', async (event, policy, lease: string) => {
    authorised(event)
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard(); await dispatch('configureChatBudget', policy, guard)
    return dispatch('chatBudgetStatus', undefined, guard)
  })
  ipc.handle('context:prepareInferenceUsage', async (event, input: InferenceUsageInput, outputTokens: number, authority: string) => {
    authorised(event)
    const scope = usageAuthority.scope(authority, [input]), model = usageAuthority.model(authority)
    const guard = (): void => { usageAuthority.scope(authority, [input]) }
    // Only a genuinely fresh profile may proceed without protected accounting.
    // An unreadable existing budget must never silently become disabled.
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      if (await protectedPolicyAbsent(join(app.getPath('userData'), 'context'))) return { persisted: false }
      throw new Error('Protected chat accounting is unavailable. Restore access to the OS keyring before sending.')
    }
    await dispatch('prepareInferenceUsage', { input, scope, model, outputTokens }, guard)
    return { persisted: true }
  })
  ipc.handle('context:endInferenceUsage', (event, authority: string) => { authorised(event); usageAuthority.end(authority) })
  ipc.handle('context:recordInferenceUsage', async (event, inputs: InferenceUsageInput[], authority: string) => {
    authorised(event)
    const scope = usageAuthority.scope(authority, inputs)
    const guard = (): void => { usageAuthority.scope(authority, inputs) }
    for (const input of inputs) await dispatch('recordInferenceUsage', { input, scope }, guard)
  })
  ipc.handle('context:inferenceUsageSummary', async (event, chatId: string | undefined, lease: string) => {
    authorised(event)
    const current = contextLease()
    const guard = (): void => { if (current.id !== lease || contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard()
    const scope = current.projectId ? `project:${current.projectId}` : 'global'
    const result = await dispatch('inferenceUsageSummary', { scope, chatId }, guard) as Record<string, unknown>
    const cost = await dispatch('chatCostSummary', { scope, chatId }, guard)
    guard(); return { ...result, cost }
  })
  const cleanupScopes = (): string[] => { const lease = contextLease(); return ['global', ...(lease.projectId ? [`project:${lease.projectId}`] : [])] }
  ipc.handle('context:cleanupStatus', async event => {
    authorised(event)
    const lease = contextLease().id
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    const result = await dispatch('cleanupStatus', cleanupScopes(), guard)
    guard(); return result
  })
  ipc.handle('context:retryCleanup', async (event, suppliedLease) => {
    authorised(event)
    const lease = contextLease().id
    const guard = (): void => { if (suppliedLease !== lease || contextLease().id !== lease) throw new Error('SCOPE_CHANGED: refresh cleanup status in the current workspace.') }
    guard()
    await dispatch('retryCleanup', cleanupScopes(), guard)
    await cleanupRunner!.flush()
    guard()
    const result = await dispatch('cleanupStatus', cleanupScopes(), guard)
    guard(); return result
  })
  ipc.handle('context:learningSettings', async event => { authorised(event); return (await getLearningPolicy()).settings })
  ipc.handle('context:configureLearning', (event, settings) => { authorised(event); return configureLearningPolicy(settings) })
  ipc.handle('context:closeProject', (event, lease) => { authorised(event); closeContextProject(lease) })
  ipc.handle('context:columnPolicies', async (event, lease) => {
    authorised(event)
    const current = contextLease()
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard()
    if (!current.projectId) return { revision: 0, selections: {} }
    if ((!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') && await protectedPolicyAbsent(join(app.getPath('userData'), 'context'))) { guard(); return { revision: 0, selections: {} } }
    const result = await dispatch('columnPolicies', current.projectId, guard)
    guard(); return result
  })
  ipc.handle('context:saveColumnPolicies', async (event, revision, selections, lease) => {
    authorised(event)
    const current = contextLease()
    if (!current.projectId) throw new Error('Save this workspace before storing a durable column policy.')
    const guard = (): void => requireProjectLease(current.projectId!, lease)
    guard()
    const policy = validateColumnPolicy({ revision, selections })
    const result = await dispatch('saveColumnPolicies', { projectId: current.projectId, policy }, guard)
    guard(); return result
  })
  ipc.handle('context:memoryRecoveryStatus', async event => {
    authorised(event)
    const indexRepair = starting ? await dispatch('indexRepairReceipt').catch(() => undefined) : undefined
    return { health: writeRecovery.status(), backups: memoryBackupCatalog(join(app.getPath('userData'), 'context', 'canonical.sqlite')), indexRepair }
  })
  ipc.handle('context:createMemoryBackup', async (event, lease) => {
    authorised(event)
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard(); writeRecovery.assertWritable()
    const result = await dispatch('createBackup', undefined, guard)
    guard(); return result
  })
  ipc.handle('context:inspectMemoryBackup', async (event, id, lease) => {
    authorised(event)
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard()
    if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Restore access to this profile’s protected key before inspecting its backup.')
    const directory = join(app.getPath('userData'), 'context')
    const key = await protectedMemoryKey(directory, safeStorage)
    try {
      const result = await new Promise((resolve, reject) => {
        const inspection = new Worker(join(__dirname, 'context-backup-inspection.js'), { workerData: { path: join(directory, 'canonical.sqlite'), id: String(id), key, schema: MEMORY_SCHEMA_VERSION } })
        const timer = setTimeout(() => { void inspection.terminate(); reject(new Error('Backup inspection timed out. Preserve the backup and choose a smaller supported export.')) }, 15000)
        inspection.once('message', message => { clearTimeout(timer); void inspection.terminate(); if (message.error) reject(new Error(message.error)); else resolve(message.result) })
        inspection.once('error', error => { clearTimeout(timer); reject(error) })
        inspection.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Backup inspection stopped before completion. Try again.')) })
      })
      guard(); return result
    } finally { key.fill(0) }
  })
  ipc.handle('context:restoreMemoryBackup', async (event, id, lease) => {
    authorised(event)
    const current = contextLease()
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard(); writeRecovery.assertWritable()
    const result = await dispatch('restoreBackup', { id, scopes: ['global', ...(current.projectId ? [`project:${current.projectId}`] : [])] }, guard)
    guard(); owner()?.send('context:retentionChanged'); return result
  })
  ipc.handle('context:retryMemoryStorage', async (event, lease) => {
    authorised(event)
    const guard = (): void => { if (contextLease().id !== lease) throw new Error('SCOPE_CHANGED') }
    guard()
    await dispatch('probeWritable', undefined, guard)
    guard(); return writeRecovery.retry(() => undefined)
  })
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
