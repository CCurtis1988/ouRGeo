import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { downloadRuntimeArtifact, type DownloadArtifact, type DownloadProgress } from './runtime-download'
import { unpackRuntimeArchive } from './runtime-archive'

export interface RuntimeInstallProfile {
  id: string
  version: string
  certification: 'pending' | 'certified'
  artifacts: { role: string; archive: DownloadArtifact }[]
}
export interface RuntimeInstallation {
  version: 1
  profileId: string
  providerVersion: string
  folder: string
  createdAt: string
  state: 'ready-for-certification' | 'ready'
  artifacts: { role: string; directory: string; sha256: string; root: string }[]
}
export type InstallProgress =
  | { step: 'download'; role: string; progress: DownloadProgress }
  | { step: 'verify' | 'unpack'; role: string }
  | { step: 'health' | 'activate' | 'complete'; state?: RuntimeInstallation['state'] }
export interface InstallerHost {
  /** Health checks use a fresh synthetic data directory in this installation.
   * They cannot migrate or open a previous runtime's provider database. */
  health: (directory: string, installation: RuntimeInstallation, signal: AbortSignal) => Promise<void>
  /** Stop the old supervised runtime and checkpoint canonical state before
   * switching. Derived databases stay in their original installation folders. */
  beforeActivate?: (signal: AbortSignal) => Promise<void>
  changed?: (progress: InstallProgress) => void
  fetcher?: typeof fetch
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Use a private runtime directory without filesystem links.')
}
async function jsonFile(path: string): Promise<unknown | null> {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    if (!(await handle.stat()).isFile() || (await handle.stat()).size > 8192) throw new Error('Runtime installation metadata is damaged. Preserve it and restore a supported backup.')
    return JSON.parse(await handle.readFile('utf8'))
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  finally { await handle?.close() }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() }
  finally { await handle.close() }
  try { await rename(temporary, path) }
  catch (error) { await unlink(temporary); throw error }
  if (process.platform !== 'win32') {
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() }
    finally { await directory.close() }
  }
}
function installation(value: unknown): RuntimeInstallation | null {
  if (value === null) return null
  const item = value as Partial<RuntimeInstallation>
  if (!item || item.version !== 1 || typeof item.folder !== 'string' || !/^installed_[a-f0-9-]{36}$/.test(item.folder)
    || typeof item.profileId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(item.profileId) || typeof item.providerVersion !== 'string' || item.providerVersion.length > 80
    || !['ready', 'ready-for-certification'].includes(String(item.state)) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
    || !Array.isArray(item.artifacts) || !item.artifacts.length || item.artifacts.length > 8
    || item.artifacts.some(artifact => !artifact || typeof artifact.role !== 'string' || !/^[a-z0-9-]{1,40}$/.test(artifact.role)
      || typeof artifact.directory !== 'string' || !/^\.runtime-[a-zA-Z0-9_-]+$/.test(artifact.directory)
      || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256) || typeof artifact.root !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(artifact.root))) {
    throw new Error('Runtime installation metadata is damaged. Preserve it and restore a supported backup.')
  }
  return item as RuntimeInstallation
}

/** Updates build a new immutable runtime/data pair. Activation switches one
 * pointer after health succeeds; it never opens an old database with a new or
 * downgraded binary. Interrupted staging can be removed without touching memory. */
export class RuntimeInstaller {
  private running?: Promise<RuntimeInstallation>
  private abort?: AbortController
  constructor(private root: string, private profile: RuntimeInstallProfile, private host: InstallerHost) {
    if (!/^[a-z0-9-]{1,80}$/.test(profile.id) || !profile.version || profile.version.length > 80 || !profile.artifacts.length || profile.artifacts.length > 8
      || new Set(profile.artifacts.map(item => item.role)).size !== profile.artifacts.length
      || profile.artifacts.some(item => !/^[a-z0-9-]{1,40}$/.test(item.role))) throw new Error('Choose a supported host runtime catalogue profile.')
  }
  async current(): Promise<RuntimeInstallation | null> {
    const active = installation(await jsonFile(join(this.root, 'active.json')))
    if (active) {
      const info = await lstat(join(this.root, active.folder))
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The active runtime is unavailable. Preserve its data and reinstall a verified release.')
    }
    return active
  }
  async canRollback(): Promise<boolean> {
    const previous = installation(await jsonFile(join(this.root, 'previous.json')))
    if (!previous || previous.folder === (await this.current())?.folder) return false
    const info = await lstat(join(this.root, previous.folder))
    return info.isDirectory() && !info.isSymbolicLink()
  }
  install(): Promise<RuntimeInstallation> {
    if (this.running) return this.running
    this.abort = new AbortController()
    this.running = this.stage(this.abort.signal).finally(() => { this.running = undefined; this.abort = undefined })
    return this.running
  }
  cancel(): void { this.abort?.abort() }
  async rollback(): Promise<RuntimeInstallation> {
    if (this.running) throw new Error('Cancel or finish installation before restoring the previous runtime.')
    this.abort = new AbortController()
    this.running = this.restore(this.abort.signal).finally(() => { this.running = undefined; this.abort = undefined })
    return this.running
  }
  private async restore(signal: AbortSignal): Promise<RuntimeInstallation> {
    await privateDirectory(this.root)
    const release = await this.lock()
    try {
      const previous = installation(await jsonFile(join(this.root, 'previous.json')))
      if (!previous) throw new Error('No previous runtime/data pair is available. Keep built-in memory and reinstall a verified release.')
      const directory = join(this.root, previous.folder), info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The previous runtime is unavailable. Preserve its data and restore a supported backup.')
      signal.throwIfAborted()
      await this.host.health(directory, previous, signal)
      await this.host.beforeActivate?.(signal)
      signal.throwIfAborted()
      await atomicJson(join(this.root, 'active.json'), previous)
      return previous
    } finally { await release() }
  }
  private async lock(): Promise<() => Promise<void>> {
    const path = join(this.root, '.install-lock'), nonce = randomUUID()
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); await handle.sync() }
      finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const old = await jsonFile(path) as { pid?: unknown; nonce?: unknown } | null
      if (!old || !Number.isSafeInteger(old.pid) || Number(old.pid) < 1 || typeof old.nonce !== 'string') throw new Error('Runtime install lock is damaged. Preserve this directory and inspect recovery before retrying.')
      try { process.kill(Number(old.pid), 0) }
      catch (failure) {
        if ((failure as NodeJS.ErrnoException).code === 'ESRCH') {
          // Check it again so a concurrently restarted installer cannot lose
          // its own lock while this process recovers an abandoned one.
          const current = await jsonFile(path) as { nonce?: unknown } | null
          if (current?.nonce === old.nonce) { await unlink(path); return this.lock() }
        }
      }
      throw new Error('Another runtime installation is active. Wait or cancel it before retrying.')
    }
    return async () => {
      const current = await jsonFile(path) as { nonce?: unknown } | null
      if (current?.nonce === nonce) await unlink(path)
    }
  }
  private async stage(signal: AbortSignal): Promise<RuntimeInstallation> {
    await privateDirectory(this.root)
    const release = await this.lock()
    let staged: string | undefined
    try {
      const previous = await this.current() // Corrupt metadata cannot be overwritten.
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^\.install-[a-zA-Z0-9_-]+$/.test(entry.name)) await rm(join(this.root, entry.name), { recursive: true, force: true })
      }
      signal.throwIfAborted()
      staged = await mkdtemp(join(this.root, '.install-'))
      const artifacts: RuntimeInstallation['artifacts'] = []
      for (const { role, archive } of this.profile.artifacts) {
        signal.throwIfAborted()
        const file = await downloadRuntimeArtifact(archive, join(this.root, 'downloads'), signal, progress => this.host.changed?.({ step: 'download', role, progress }), this.host.fetcher)
        this.host.changed?.({ step: 'verify', role })
        this.host.changed?.({ step: 'unpack', role })
        const directory = await unpackRuntimeArchive(file, staged, archive, signal)
        artifacts.push({ role, directory: directory.slice(staged.length + 1), sha256: archive.sha256, root: archive.root })
      }
      const value: RuntimeInstallation = { version: 1, profileId: this.profile.id, providerVersion: this.profile.version, folder: `installed_${randomUUID()}`, createdAt: new Date().toISOString(),
        state: this.profile.certification === 'certified' ? 'ready' : 'ready-for-certification', artifacts }
      this.host.changed?.({ step: 'health' })
      await this.host.health(staged, value, signal)
      signal.throwIfAborted()
      await atomicJson(join(staged, 'installation.json'), value)
      await rename(staged, join(this.root, value.folder))
      staged = undefined
      this.host.changed?.({ step: 'activate' })
      await this.host.beforeActivate?.(signal)
      signal.throwIfAborted()
      // Old installed folders include their own provider data and remain
      // readable/exportable. No database migration happens through this pointer.
      if (previous) await atomicJson(join(this.root, 'previous.json'), previous)
      await atomicJson(join(this.root, 'active.json'), value)
      this.host.changed?.({ step: 'complete', state: value.state })
      return value
    } finally {
      if (staged) await rm(staged, { recursive: true, force: true })
      await release()
    }
  }
}
