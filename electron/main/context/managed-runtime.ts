import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ManagedRuntimeStatus } from '../../../src/lib/context/providers/runtimes'
import { MNEMOSYNE_LOCAL_CANDIDATE as candidate } from './runtime-catalogue'
import { RuntimeInstaller, type RuntimeInstallation } from './runtime-installer'
import { MemoryRuntime, mnemosyneEnvironment } from './runtimes'
import { contextLease, subscribeContextScope } from './scope'

const instances = new Set<ManagedMnemosyneRuntime>()
let stopping = false
export function managedContextRuntimesRunning(): boolean { return !stopping && [...instances].some(runtime => runtime.isRunning()) }
export async function stopManagedContextRuntimes(): Promise<void> {
  stopping = true
  await Promise.allSettled([...instances].map(runtime => runtime.shutdown()))
}

/** This candidate stages verified assets and uses synthetic health data only.
 * Its availability never grants personal memory access or certifies offline
 * behaviour. Production provider activation requires a separate host gate. */
export class ManagedMnemosyneRuntime {
  private state: ManagedRuntimeStatus
  private installer?: RuntimeInstaller
  private initialising?: Promise<void>
  private installing?: Promise<ManagedRuntimeStatus>
  private generation = 0
  private metadataUnavailable = false
  private activeRuntime?: MemoryRuntime
  constructor(private directory: string, private bridgeFile: string) {
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
      { health: (directory, installation, signal) => this.health(directory, installation, signal), changed: progress => {
        this.state = { ...this.state, step: progress.step, ...(progress.step === 'download' ? { receivedBytes: progress.progress.received, totalBytes: progress.progress.total } : { receivedBytes: undefined, totalBytes: undefined }) }
      } })
      if (await this.installer.current()) this.state = { ...this.state, state: 'ready-for-certification' }
      this.state = { ...this.state, canRollback: await this.installer.canRollback() }
      this.metadataUnavailable = false
    })().catch(() => { this.metadataUnavailable = true; this.state = { ...this.state, state: 'failed', error: 'Runtime metadata is unavailable. Preserve the installation and restore a supported backup before retrying.' }; this.initialising = undefined })
    return this.initialising
  }
  async status(): Promise<ManagedRuntimeStatus> { await this.initialise(); return { ...this.state } }
  stage(suppliedLease: unknown, acknowledged: unknown): Promise<ManagedRuntimeStatus> {
    if (acknowledged !== true) return Promise.reject(new Error('Review and acknowledge the experimental native runtime before staging it.'))
    if (suppliedLease !== contextLease().id) return Promise.reject(new Error('SCOPE_CHANGED: review runtime setup in the active workspace.'))
    if (this.installing) return this.installing
    const lease = contextLease().id
    const generation = this.generation
    this.installing = (async () => {
      await this.initialise()
      if (contextLease().id !== lease || this.generation !== generation) throw new Error('SCOPE_CHANGED: runtime staging was cancelled.')
      if (this.metadataUnavailable) throw new Error('Restore runtime metadata before staging another release.')
      if (!this.installer || !this.state.platformSupported) throw new Error('This platform has connection-only support until its runtime is tested.')
      this.state = { ...this.state, state: 'installing', error: undefined }
      try {
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
  }
  isRunning(): boolean { return Boolean(this.installing || this.activeRuntime) }
  async shutdown(): Promise<void> {
    this.cancel()
    await this.activeRuntime?.stop('ouRGeo is closing.')
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([this.installing?.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000) })]) }
    finally { clearTimeout(timer) }
  }
  rollback(suppliedLease: unknown): Promise<ManagedRuntimeStatus> {
    if (suppliedLease !== contextLease().id) return Promise.reject(new Error('SCOPE_CHANGED'))
    if (this.installing) return Promise.reject(new Error('Cancel or finish runtime setup before restoring the previous pair.'))
    const generation = this.generation
    this.installing = (async () => {
      await this.initialise()
      if (contextLease().id !== suppliedLease || this.generation !== generation) throw new Error('SCOPE_CHANGED')
      if (!this.installer) throw new Error('Use a tested runtime platform or connect to your server.')
      this.state = { ...this.state, state: 'installing', step: 'health', error: undefined }
      try {
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
    const runtime = new MemoryRuntime({ executable: join(path('python'), 'bin', 'python3.12'), arguments: ['-I', '-S', bridge, path('engine'), join(path('yaml'), 'lib'), data],
      directory, environment: mnemosyneEnvironment(data), profile: candidate.id })
    this.activeRuntime = runtime
    try {
      const result = await runtime.request({ operation: 'probe', namespace: randomUUID() }, { signal, authorised: () => !signal.aborted, timeoutMs: 15000 }) as { evidence?: unknown; complete?: unknown }
      if (!Array.isArray(result.evidence) || result.evidence.length || result.complete !== true) throw new Error('Runtime health did not match the pinned local profile.')
    } finally { await runtime.stop(); if (this.activeRuntime === runtime) this.activeRuntime = undefined; await rm(data, { recursive: true, force: true }) }
  }
}

export function registerManagedRuntimeHandlers(ipc: IpcMain, authorised: (event: IpcMainInvokeEvent) => void, directory: string, bridgeFile: string): void {
  const runtime = new ManagedMnemosyneRuntime(directory, bridgeFile)
  instances.add(runtime)
  subscribeContextScope(() => runtime.cancel())
  ipc.handle('context:runtimeStatus', event => { authorised(event); return runtime.status() })
  ipc.handle('context:stageRuntime', (event, lease, acknowledged) => { authorised(event); return runtime.stage(lease, acknowledged) })
  ipc.handle('context:cancelRuntime', event => { authorised(event); runtime.cancel() })
  ipc.handle('context:rollbackRuntime', (event, lease) => { authorised(event); return runtime.rollback(lease) })
}
