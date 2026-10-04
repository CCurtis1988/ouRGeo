import { randomBytes } from 'node:crypto'
import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'

const PORT_ANNOUNCE_PREFIX = 'OURGEO_PORT:'
const READY_SIGNAL = 'OURGEO_READY'
const STARTUP_TIMEOUT_MS = 30_000

class RBridge {
  activePreflight: string | null = null
  readonly preflightSecret = randomBytes(32).toString('hex')
  private process: ChildProcess | null = null
  private _port: number | null = null
  private _isReady = false
  private _startPromise: Promise<void> | null = null
  private _customPath: string | null = null
  private _stopping = false

  onUnexpectedExit?: () => void

  get port(): number | null {
    return this._port
  }

  get isReady(): boolean {
    return this._isReady
  }

  get currentPath(): string {
    return this._customPath ?? this.getDefaultRScriptPath()
  }

  setPath(path: string | null): void {
    this._customPath = path
  }

  async restart(): Promise<void> {
    this.stop()
    return this.start()
  }

  private getDefaultRScriptPath(): string {
    if (process.platform === 'win32') {
      return 'Rscript.exe'
    }
    return 'Rscript'
  }

  private getRScriptPath(): string {
    return this._customPath ?? this.getDefaultRScriptPath()
  }

  private getRDir(): string {
    if (is.dev) {
      return join(process.cwd(), 'r')
    }
    return join(process.resourcesPath, 'r')
  }

  start(): Promise<void> {
    if (this._startPromise) return this._startPromise

    this._startPromise = new Promise<void>((resolve, reject) => {
      const rscript = this.getRScriptPath()
      const rDir = this.getRDir()

      // server.R is passed as an ABSOLUTE path, and R starts in the user's home
      // directory rather than in `r/`.
      //
      // The working directory is what every relative path in the session means
      // — where read_csv("data.csv") looks, where ggsave() writes — so starting
      // in ouRGeo's own program directory pointed all of them at the install.
      // In a packaged build that is inside resources/, which the user has no
      // business writing to and may not be able to. Home is where a desktop
      // app's session belongs, and the console header now says so out loud.
      //
      // The absolute path matters: server.R resolves its own module directory
      // from `--file=`, which R reports verbatim, so a bare "server.R" would be
      // normalized against the new cwd and find nothing.
      const script = join(rDir, 'server.R')
      const home = homedir()
      console.log('[RBridge] Spawning R process:', rscript, script, '(cwd:', home + ')')

      this.process = spawn(rscript, [script], {
        cwd: home,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          OURGEO_MODE: 'server',
          OURGEO_PREFLIGHT_SECRET: this.preflightSecret
        }
      })
      const child = this.process
      this._stopping = false
      let stdoutBuffer = ''

      const timeout = setTimeout(() => {
        reject(new Error('R server startup timed out'))
        this.stop()
      }, STARTUP_TIMEOUT_MS)

      this.process.stdout?.on('data', (data: Buffer) => {
        if (this.process !== child) return
        stdoutBuffer += data.toString()
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()

          if (trimmed.startsWith('OURGEO_PREFLIGHT_BUSY:')) this.activePreflight = trimmed.slice('OURGEO_PREFLIGHT_BUSY:'.length)
          if (trimmed.startsWith('OURGEO_PREFLIGHT_IDLE:')) this.activePreflight = null

          if (trimmed.startsWith(PORT_ANNOUNCE_PREFIX)) {
            const portStr = trimmed.slice(PORT_ANNOUNCE_PREFIX.length).trim()
            this._port = parseInt(portStr, 10)
            console.log('[RBridge] R server port:', this._port)
          }

          if (trimmed === READY_SIGNAL) {
            this._isReady = true
            clearTimeout(timeout)
            console.log('[RBridge] R server ready')
            resolve()
          }

          if (trimmed.startsWith('OURGEO_ERROR:')) {
            clearTimeout(timeout)
            reject(new Error(trimmed.slice('OURGEO_ERROR:'.length).trim()))
          }

          // Forward all stdout to console for debugging
          if (trimmed) {
            console.log('[R stdout]', trimmed)
          }
        }
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) {
          console.error('[R stderr]', text)
        }
      })

      this.process.on('error', (err) => {
        console.error('[RBridge] Process error:', err)
        clearTimeout(timeout)
        if (this.process === child) { this.process = null; this._startPromise = null }
        reject(err)
      })

      this.process.on('exit', (code, signal) => {
        console.log('[RBridge] R process exited, code:', code, 'signal:', signal)
        clearTimeout(timeout)
        // An old process exiting after restart must not erase the new process's
        // port/state. Startup failures are reported once, not crash-restarted.
        if (this.process !== child) return
        const wasUnexpected = !this._stopping && this._isReady
        if (!this._isReady) reject(new Error(`R server exited before connecting (code ${code}). Run the health check to repair its packages.`))
        this.process = null
        this._isReady = false
        this._port = null
        this._startPromise = null
        this._stopping = false
        if (wasUnexpected && this.onUnexpectedExit) {
          this.onUnexpectedExit()
        }
      })
    })

    return this._startPromise
  }

  stop(): void {
    if (this.process) {
      this._stopping = true
      console.log('[RBridge] Stopping R process')
      this.process.kill('SIGTERM')
      this.process = null
      this._isReady = false
      this._port = null
      this.activePreflight = null
      this._startPromise = null
    }
  }

  interrupt(): void {
    if (!this.process || this.process.killed) return
    console.log('[RBridge] Sending SIGINT to R process')
    this.process.kill('SIGINT')
  }
}

export const rBridge = new RBridge()
