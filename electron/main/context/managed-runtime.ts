import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ManagedRuntimeStatus } from '../../../src/lib/context/providers/runtimes'
import { MNEMOSYNE_LOCAL_CANDIDATE as candidate } from './runtime-catalogue'
import { RuntimeInstaller, type RuntimeInstallation } from './runtime-installer'
import { MemoryRuntime, mnemosyneEnvironment } from './runtimes'
import { contextLease, subscribeContextScope } from './scope'
import { stopOwnedRuntimeOrphans } from './runtime-orphans'

const instances = new Set<ManagedMnemosyneRuntime>()
let stopping = false
export function managedContextRuntimesRunning(): boolean { return !stopping && [...instances].some(runtime => runtime.isRunning()) }
export async function stopManagedContextRuntimes(): Promise<void> {
  stopping = true
  await Promise.allSettled([...instances].map(runtime => runtime.shutdown()))
}

/** Staging verifies assets with synthetic health data. Personal snapshots
 * require the separate reviewed profile, scoped binding and native consent;
 * an installed runtime cannot grant itself memory access or certification. */
export class ManagedMnemosyneRuntime {
  private state: ManagedRuntimeStatus
  private installer?: RuntimeInstaller
  private initialising?: Promise<void>
  private installing?: Promise<ManagedRuntimeStatus>
  private generation = 0
  private metadataUnavailable = false
  private activeRuntime?: MemoryRuntime
  private providerRuntime?: MemoryRuntime
  private providerFolder?: string
  private providerStarting?: Promise<MemoryRuntime>
  private verified?: { identity: string; promise: Promise<void> }
  constructor(private directory: string, private bridgeFile: string, private checkpoint: () => Promise<void> = async () => {}) {
    const supported = process.platform === 'linux' && process.arch === 'x64'
    this.state = { id: candidate.id, label: 'Mnemosyne on this device', version: candidate.provider.engineVersion, experimental: true, platformSupported: supported,
      certification: 'pending', processing: 'local-profile-under-test', storage: 'readable-derived-sqlite', state: 'not-installed',
      archiveLimitBytes: candidate.python.profiles['linux-x64'].maxBytes + candidate.provider.archive.maxBytes + candidate.yaml.archive.maxBytes,
      measuredInstalledBytes: 216725378, canRollback: false }
  }
  private initialise(): Promise<void> {
    if (this.initialising) return this.initialising
    this.initialising = (async () => {
      if (!this.state.platformSupported) return
      this.installer = new RuntimeInstaller(this.directory, { id: candidate.id, version: candidate.provider.engineVersion, certification: candidate.certification,
        artifacts: [{ role: 'python', archive: candidate.python.profiles['linux-x64'] }, { role: 'engine', archive: candidate.provider.archive }, { role: 'yaml', archive: candidate.yaml.archive }] },
      { health: (directory, installation, signal) => this.health(directory, installation, signal), beforeActivate: async signal => {
        signal.throwIfAborted()
        await this.checkpoint()
        signal.throwIfAborted()
      }, changed: progress => {
        this.state = { ...this.state, step: progress.step, ...(progress.step === 'download' ? { receivedBytes: progress.progress.received, totalBytes: progress.progress.total } : { receivedBytes: undefined, totalBytes: undefined }) }
      } })
      const current = await this.installer.current()
      if (current) this.state = current.integrity ? { ...this.state, state: 'ready-for-certification' }
        : { ...this.state, state: 'failed', error: 'Restage the verified runtime to add the installed-file integrity record. Canonical memory and the old runtime/data pair are preserved.' }
      this.state = { ...this.state, canRollback: await this.installer.canRollback() }
      this.metadataUnavailable = false
    })().catch(() => { this.metadataUnavailable = true; this.state = { ...this.state, state: 'failed', error: 'Runtime metadata is unavailable. Preserve the installation and restore a supported backup before retrying.' }; this.initialising = undefined })
    return this.initialising
  }
  async status(): Promise<ManagedRuntimeStatus> { await this.initialise(); return { ...this.state } }
  async installed(): Promise<RuntimeInstallation> {
    await this.initialise()
    if (this.installing || !this.state.platformSupported || this.metadataUnavailable) throw new Error('Finish verified runtime staging before activation.')
    const installed = await this.installer?.current()
    if (!installed) throw new Error('Stage the pinned runtime before activation.')
    const identity = JSON.stringify(installed)
    if (this.verified?.identity !== identity) {
      const promise = this.installer!.verify(installed).catch(error => { if (this.verified?.promise === promise) this.verified = undefined; throw error })
      this.verified = { identity, promise }
    }
    try { await this.verified.promise }
    catch (error) { this.state = { ...this.state, state: 'failed', error: 'Restage the verified runtime before processing memory. Its installed files could not be verified; canonical memory remains available.' }; throw error }
    return installed
  }
  async request(payload: Record<string, unknown>, host: Parameters<MemoryRuntime['request']>[1]): Promise<unknown> {
    const generation = this.generation, installed = await this.installed()
    host.signal.throwIfAborted()
    if (!host.authorised() || generation !== this.generation) throw new Error('POLICY_REFUSED')
    let runtime = this.providerFolder === installed.folder ? this.providerRuntime : undefined
    if (!runtime) {
      this.providerStarting ??= this.startProvider(installed, generation, host).finally(() => { this.providerStarting = undefined })
      runtime = await this.providerStarting
    }
    if (!host.authorised() || generation !== this.generation) throw new Error('POLICY_REFUSED')
    const result = await runtime.request(payload, host)
    if (payload.operation === 'replace') {
      await this.clearOlderCopies(installed, payload.namespace)
    }
    return result
  }
  private async startProvider(installed: RuntimeInstallation, generation: number, host: Parameters<MemoryRuntime['request']>[1]): Promise<MemoryRuntime> {
      await this.providerRuntime?.stop('Managed runtime/data pair changed.')
      await stopOwnedRuntimeOrphans(this.directory)
      const directory = join(this.directory, installed.folder), data = join(directory, 'derived')
      await mkdir(data, { recursive: true, mode: 0o700 })
      const info = await lstat(data)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Restore the private derived store; symbolic links are refused.')
      const path = (role: string): string => {
        const artifact = installed.artifacts.find(item => item.role === role)
        if (!artifact) throw new Error('Restage the complete pinned runtime.')
        return join(directory, artifact.directory, artifact.root)
      }
      // The bridge is app-owned code, not a runtime manifest contribution.
      const bridge = join(directory, 'ourgeo-bridge.py')
      const file = await open(bridge, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
      try { await file.writeFile(await readFile(this.bridgeFile)); await file.sync() } finally { await file.close() }
      if (!host.authorised() || generation !== this.generation) throw new Error('POLICY_REFUSED')
      this.providerRuntime = new MemoryRuntime({ executable: join(path('python'), 'bin', 'python3.12'), arguments: ['-I', '-B', '-S', bridge, path('engine'), join(path('yaml'), 'lib'), data, '--parent-pid', String(process.pid)], directory, environment: mnemosyneEnvironment(data), profile: candidate.id,
        verify: () => this.installer!.verify(installed) })
      this.providerFolder = installed.folder
      return this.providerRuntime
  }
  private async clearOlderCopies(installed: RuntimeInstallation, namespace: unknown): Promise<void> {
      // Older rollback pairs are rebuildable caches too. Forgetting must not
      // leave their copies available for a later rollback on this profile.
      if (typeof namespace !== 'string' || !/^[a-f0-9-]{36}$/.test(namespace)) throw new Error('POLICY_REFUSED')
      const folders = (await readdir(this.directory)).filter(name => /^installed_[a-f0-9-]{36}$/.test(name) && name !== installed.folder)
      if (folders.length > 32) throw new Error('Review old runtime cache pairs before further indexing.')
      for (const folder of folders) {
        const parent = join(this.directory, folder)
        if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink()) throw new Error('Restore the private runtime cache directories.')
        const old = join(parent, 'derived')
        let info
        try { info = await lstat(old) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Restore the private derived cache directories.')
        for (const suffix of ['', '-wal', '-shm', '-journal', '.init.lock']) await rm(join(old, `${namespace}.sqlite${suffix}`), { force: true })
      }
  }
  /** A disconnected index is still a managed copy. Forgetting can remove it
   * without restarting native code or granting the old connection access. */
  async forgetDerived(namespaces: string[]): Promise<void> {
    if (!namespaces.length) return
    if (namespaces.length > 32 || namespaces.some(namespace => !/^[a-f0-9-]{36}$/i.test(namespace))) throw new Error('Review the bounded managed memory namespaces before cleanup.')
    this.generation++
    await this.providerStarting?.catch(() => {})
    await this.providerRuntime?.stop('Forgotten memory requires a clean derived reconstruction.')
    await stopOwnedRuntimeOrphans(this.directory)
    this.providerRuntime = undefined; this.providerFolder = undefined
    let folders: string[]
    try { folders = (await readdir(this.directory)).filter(folder => /^installed_[a-f0-9-]{36}$/i.test(folder)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (folders.length > 32) throw new Error('Review older managed runtime caches before completing deletion.')
    for (const folder of folders) {
      const parent = join(this.directory, folder), data = join(parent, 'derived')
      const parentInfo = await lstat(parent)
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Restore the private runtime directories before completing deletion.')
      let info
      try { info = await lstat(data) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Restore the private derived cache directories before completing deletion.')
      for (const namespace of new Set(namespaces)) for (const suffix of ['', '-wal', '-shm', '-journal', '.init.lock']) await rm(join(data, `${namespace}.sqlite${suffix}`), { force: true })
    }
  }
  stage(suppliedLease: unknown, acknowledged: unknown): Promise<ManagedRuntimeStatus> {
    if (acknowledged !== true) return Promise.reject(new Error('Review and acknowledge the experimental native runtime before staging it.'))
    if (suppliedLease !== contextLease().id) return Promise.reject(new Error('SCOPE_CHANGED: review runtime setup in the active workspace.'))
    if (this.installing) return this.installing
    const lease = contextLease().id
    const generation = ++this.generation
    this.installing = (async () => {
      await this.initialise()
      if (contextLease().id !== lease || this.generation !== generation) throw new Error('SCOPE_CHANGED: runtime staging was cancelled.')
      if (this.metadataUnavailable) throw new Error('Restore runtime metadata before staging another release.')
      if (!this.installer || !this.state.platformSupported) throw new Error('This platform has connection-only support until its runtime is tested.')
      this.state = { ...this.state, state: 'installing', error: undefined }
      try {
        await this.providerStarting?.catch(() => {})
        await this.providerRuntime?.stop('Runtime staging requires a fresh provider reconstruction.')
        this.providerRuntime = undefined; this.providerFolder = undefined
        await this.installer.install()
        this.state = { ...this.state, state: 'ready-for-certification', canRollback: await this.installer.canRollback(), step: 'complete', receivedBytes: undefined, totalBytes: undefined }
      } catch {
        this.state = { ...this.state, state: this.state.state === 'cancelled' ? 'cancelled' : 'failed', error: 'Installation did not complete. The previous runtime/data pair is preserved; retry to resume verified downloads.' }
      }
      return { ...this.state }
    })().finally(() => { this.installing = undefined })
    return this.installing
  }
  cancel(): void {
    this.generation++
    if (this.installing) { this.installer?.cancel(); this.state = { ...this.state, state: 'cancelled' } }
    void this.activeRuntime?.stop('Managed runtime setup cancelled.')
    void this.providerRuntime?.stop('Managed runtime scope revoked.')
  }
  isRunning(): boolean { return Boolean(this.installing || this.activeRuntime || this.providerRuntime || this.providerStarting) }
  async shutdown(): Promise<void> {
    this.cancel()
    await this.activeRuntime?.stop('ouRGeo is closing.')
    await this.providerRuntime?.stop('ouRGeo is closing.')
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([this.installing?.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) })]) }
    finally { clearTimeout(timer) }
  }
  rollback(suppliedLease: unknown): Promise<ManagedRuntimeStatus> {
    if (suppliedLease !== contextLease().id) return Promise.reject(new Error('SCOPE_CHANGED'))
    if (this.installing) return Promise.reject(new Error('Cancel or finish runtime setup before restoring the previous pair.'))
    const generation = ++this.generation
    this.installing = (async () => {
      await this.initialise()
      if (contextLease().id !== suppliedLease || this.generation !== generation) throw new Error('SCOPE_CHANGED')
      if (!this.installer) throw new Error('Use a tested runtime platform or connect to your server.')
      this.state = { ...this.state, state: 'installing', step: 'health', error: undefined }
      try {
        await this.providerStarting?.catch(() => {})
        await this.providerRuntime?.stop('Runtime rollback requires a fresh provider reconstruction.')
        this.providerRuntime = undefined; this.providerFolder = undefined
        await this.installer.rollback()
        this.state = { ...this.state, state: 'ready-for-certification', canRollback: await this.installer.canRollback(), step: 'complete', error: undefined }
      } catch {
        this.state = { ...this.state, state: this.state.state === 'cancelled' ? 'cancelled' : 'failed', error: 'The previous pair could not be restored. The active pair is preserved; inspect the installation before retrying.' }
      }
      return { ...this.state }
    })().finally(() => { this.installing = undefined })
    return this.installing
  }
  private async health(directory: string, installation: RuntimeInstallation, signal: AbortSignal): Promise<void> {
    const path = (role: string): string => {
      const artifact = installation.artifacts.find(item => item.role === role)
      if (!artifact) throw new Error('Runtime package is incomplete. Reinstall the pinned release.')
      return join(directory, artifact.directory, artifact.root)
    }
    const bridge = join(directory, 'ourgeo-bridge.py')
    const script = await open(bridge, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
    try { await script.writeFile(await readFile(this.bridgeFile)); await script.sync() }
    finally { await script.close() }
    const data = join(directory, `.health-${randomUUID()}`)
    await mkdir(data, { mode: 0o700 })
    const runtime = new MemoryRuntime({ executable: join(path('python'), 'bin', 'python3.12'), arguments: ['-I', '-B', '-S', bridge, path('engine'), join(path('yaml'), 'lib'), data, '--parent-pid', String(process.pid)],
      directory, environment: mnemosyneEnvironment(data), profile: candidate.id })
    this.activeRuntime = runtime
    try {
      const result = await runtime.request({ operation: 'probe', namespace: randomUUID() }, { signal, authorised: () => !signal.aborted, timeoutMs: 15000 }) as { evidence?: unknown; complete?: unknown }
      if (!Array.isArray(result.evidence) || result.evidence.length || result.complete !== true) throw new Error('Runtime health did not match the pinned local profile.')
    } finally { await runtime.stop(); if (this.activeRuntime === runtime) this.activeRuntime = undefined; await rm(data, { recursive: true, force: true }) }
  }
}

export function registerManagedRuntimeHandlers(ipc: IpcMain, authorised: (event: IpcMainInvokeEvent) => void, directory: string, bridgeFile: string, checkpoint: () => Promise<void>): ManagedMnemosyneRuntime {
  const runtime = new ManagedMnemosyneRuntime(directory, bridgeFile, checkpoint)
  instances.add(runtime)
  subscribeContextScope(() => runtime.cancel())
  ipc.handle('context:runtimeStatus', event => { authorised(event); return runtime.status() })
  ipc.handle('context:stageRuntime', (event, lease, acknowledged) => { authorised(event); return runtime.stage(lease, acknowledged) })
  ipc.handle('context:cancelRuntime', event => { authorised(event); runtime.cancel() })
  ipc.handle('context:rollbackRuntime', (event, lease) => { authorised(event); return runtime.rollback(lease) })
  return runtime
}
