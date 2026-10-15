import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export interface RuntimeLaunch {
  executable: string
  arguments: string[]
  directory: string
  environment: Record<string, string>
  profile: string
  verify?: () => Promise<void>
}
export interface RuntimeOperation {
  signal: AbortSignal
  timeoutMs: number
  authorised: () => boolean
}
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type Launch = (configuration: RuntimeLaunch) => ChildProcessWithoutNullStreams

export function mnemosyneEnvironment(directory: string): Record<string, string> {
  return { LANG: 'C.UTF-8', MNEMOSYNE_HOME: directory, MNEMOSYNE_DATA_DIR: directory,
    MNEMOSYNE_NO_EMBEDDINGS: '1', MNEMOSYNE_FORCE_LOCAL: '1', MNEMOSYNE_LLM_ENABLED: '0', MNEMOSYNE_HOST_LLM_ENABLED: '0',
    MNEMOSYNE_LLM_CONFLICT_DETECTION: '0', MNEMOSYNE_AUTO_SLEEP_ENABLED: '0', MNEMOSYNE_PROACTIVE_LINKING: '0',
    MNEMOSYNE_ENHANCED_RECALL: '0', MNEMOSYNE_POLYPHONIC_RECALL: '0', MNEMOSYNE_MODALITY_ENABLED: '0',
    MNEMOSYNE_SYNC_REMOTE: '', MNEMOSYNE_CROSS_SESSION: '0',
    ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }
}

/** Private stdio never receives shell fragments, endpoint URLs or inherited
 * credentials. Cancellation stops the child: abandoning a promise alone would
 * let a revoked scope finish a write in the background. */
export class MemoryRuntime {
  private child?: ChildProcessWithoutNullStreams
  private starting?: Promise<void>
  private startingReject?: (error: Error) => void
  private pending = new Map<number, Pending>()
  private counter = 0
  private generation = 0
  private active = 0
  private inputBytes = 0
  private idle?: ReturnType<typeof setTimeout>
  private closing: Promise<void> = Promise.resolve()

  constructor(private readonly configuration: RuntimeLaunch,
    private readonly launch: Launch = configuration => spawn(configuration.executable, configuration.arguments,
      { cwd: configuration.directory, env: configuration.environment, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
    private readonly idleMs = 30000) {}

  private async start(): Promise<void> {
    if (this.starting) return this.starting
    const generation = this.generation
    this.starting = (async () => {
      await this.closing
      await this.configuration.verify?.()
      if (this.generation !== generation) throw new Error('Runtime startup cancelled.')
      const child = this.launch(this.configuration)
      this.child = child
      await new Promise<void>((resolve, reject) => {
        this.startingReject = reject
        const decoder = new StringDecoder('utf8')
        let buffer = '', ready = false, errors = 0
        const timer = setTimeout(() => { void this.stop('Runtime startup timed out. Retry or reinstall the verified runtime.') }, 10000)
        const fail = (reason: string): void => { if (this.child === child) void this.stop(reason) }
        child.stdout.on('data', (bytes: Buffer) => {
          if (this.child !== child) return
          buffer += decoder.write(bytes)
          // JSON wrappers, IDs and snippets are bounded as well as their bodies.
          if (Buffer.byteLength(buffer) > 128000) { fail('Runtime response exceeded its limit.'); return }
          let newline: number
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)
            let value: Record<string, unknown>
            try {
              const parsed: unknown = JSON.parse(line)
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid envelope')
              value = parsed as Record<string, unknown>
            } catch { fail('Runtime returned malformed content. Reinstall the verified runtime.'); return }
            if (!ready) {
              if (value.ready !== true || value.protocol !== 1 || value.profile !== this.configuration.profile) { fail('Runtime readiness did not match the installed profile.'); return }
              ready = true
              clearTimeout(timer)
              this.startingReject = undefined
              resolve()
              continue
            }
            const pending = typeof value.id === 'number' ? this.pending.get(value.id) : undefined
            if (!pending || typeof value.ok !== 'boolean') { fail('Runtime response did not match an outstanding operation.'); return }
            this.pending.delete(value.id as number)
            if (value.ok) pending.resolve(value.result)
            else pending.reject(new Error(['BUDGET_LIMIT', 'INVALID_REQUEST', 'STORE_UNAVAILABLE'].includes(String(value.code)) ? String(value.code) : 'Runtime operation failed. Inspect its health and retry.'))
          }
        })
        // Do not accumulate or disclose native logs: they may contain private
        // queries. A noisy/broken child is bounded and stopped instead.
        child.stderr.on('data', (bytes: Buffer) => { errors += bytes.length; if (errors > 256000) fail('Runtime diagnostic output exceeded its limit.') })
        child.on('error', () => fail('Runtime could not start. Verify the private runtime installation.'))
        child.on('close', () => {
          clearTimeout(timer)
          if (this.child === child) void this.stop('Runtime stopped. Retry after checking its health.')
        })
      })
    })().catch(error => { if (this.generation === generation) this.starting = undefined; throw error })
    return this.starting
  }

  async request(payload: unknown, host: RuntimeOperation): Promise<unknown> {
    host.signal.throwIfAborted()
    if (!host.authorised()) throw new Error('POLICY_REFUSED')
    if (this.active >= 8) throw new Error('Runtime is busy. Retry shortly.')
    const id = ++this.counter
    const input = JSON.stringify({ id, payload }) + '\n'
    const bytes = Buffer.byteLength(input)
    if (bytes > 48_000_000 || this.inputBytes + bytes > 48_000_000) throw new Error('BUDGET_LIMIT')
    clearTimeout(this.idle)
    this.active++
    this.inputBytes += bytes
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectCancellation: (error: Error) => void = () => {}
    const cancel = (): void => { void this.stop('Runtime operation cancelled or its scope revoked.'); rejectCancellation(new Error('Runtime operation cancelled.')) }
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject
      timer = setTimeout(() => { cancel(); reject(new Error('Runtime operation timed out. Verify its state before retrying.')) }, Math.min(30000, Math.max(1, host.timeoutMs)))
      host.signal.addEventListener('abort', cancel, { once: true })
    })
    try {
      // A startup cancellation must reject even before a request enters the
      // pending map. stop() rejects the shared readiness handshake too.
      await Promise.race([this.start(), cancelled])
      host.signal.throwIfAborted()
      if (!host.authorised()) { cancel(); throw new Error('POLICY_REFUSED') }
      if (this.pending.size >= 8) throw new Error('Runtime is busy. Retry shortly.')
      const result = await Promise.race([new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.child!.stdin.write(input, error => { if (error) cancel() })
      }), cancelled])
      host.signal.throwIfAborted()
      if (!host.authorised()) { cancel(); throw new Error('POLICY_REFUSED') }
      return result
    } finally {
      this.active--
      this.inputBytes -= bytes
      clearTimeout(timer)
      host.signal.removeEventListener('abort', cancel)
      if (!this.active && this.child) {
        this.idle = setTimeout(() => { void this.stop('Runtime stopped while idle.') }, this.idleMs)
        this.idle.unref()
      }
    }
  }

  async stop(reason = 'Memory runtime disconnected.'): Promise<void> {
    this.generation++
    clearTimeout(this.idle)
    const child = this.child
    this.child = undefined
    this.starting = undefined
    this.startingReject?.(new Error(reason))
    this.startingReject = undefined
    for (const call of this.pending.values()) call.reject(new Error(reason))
    this.pending.clear()
    if (!child) return this.closing
    this.closing = new Promise(resolve => {
      let finished = false
      const done = (): void => { if (finished) return; finished = true; clearTimeout(timer); resolve() }
      const timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 1000)
      child.once('close', done)
      if (child.exitCode !== null || child.signalCode !== null) done()
      else child.kill('SIGTERM')
    })
    return this.closing
  }
}
