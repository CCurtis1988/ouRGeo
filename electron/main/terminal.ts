// The shells behind the Terminal panel.
//
// Every pseudo-terminal lives here, in main, and the renderer holds only a
// view onto it. That split is not the usual "main owns the OS" reflex — it
// buys three specific things the renderer cannot do for itself:
//
//   • COALESCING. A pty emits data in whatever sizes the program writes it,
//     and `cat` on a large file produces thousands of tiny reads. One IPC
//     message per read floods the channel and janks the renderer for the whole
//     duration of the command. Output is therefore batched here, upstream of
//     the channel, and the renderer sees a handful of large writes instead.
//
//   • FLOW CONTROL. `yes` produces output faster than any terminal can render
//     it, forever. Without back-pressure the queue grows without bound and the
//     UI stops responding. The renderer acks what it has drawn and the pty is
//     paused until it catches up.
//
//   • SURVIVING A RELOAD. The pty is a child of main, so a renderer reload —
//     Ctrl+R in dev, or the automatic reload `index.ts` does when the renderer
//     process dies — does not kill the user's shell. Each session keeps a
//     bounded ring of recent output so the reattaching renderer can redraw the
//     screen. That ring is in memory and is never written to disk: terminal
//     output is exactly the kind of thing that must not turn up in
//     `session.json` or inside a `.ourgeoproj`.
//
// The pty module itself is loaded LAZILY and behind a try/catch. Its binary is
// platform-specific (an `optionalDependencies` install), so on an architecture
// with no prebuild the import throws — and a throw at module load would take
// the whole main process down over a panel the user may never open. Loaded
// this way, the failure is a message in the panel instead.

import type { IpcMain, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { accessSync, constants } from 'fs'
import { availableShells, resolveShell, type ShellProfile } from '../../src/lib/terminal/shells'

// ── Tuning ─────────────────────────────────────────────────────────────────
//
// The two flush numbers are a latency/throughput trade: 8ms is comfortably
// under a frame, so typing still echoes instantly, while a burst coalesces into
// at most ~125 messages a second however hard the program writes.

const FLUSH_MS = 8
const FLUSH_CHARS = 64 * 1024

/** Pause the pty above this many unacknowledged characters, resume below LOW. */
const HIGH_WATER = 512 * 1024
const LOW_WATER = 128 * 1024

/** How much recent output a reattaching renderer gets back. */
const REPLAY_CHARS = 128 * 1024

// ── Types crossing IPC ─────────────────────────────────────────────────────

export interface TerminalCreateRequest {
  /** Profile id from `terminal:shells`; omitted means "the best one". */
  profileId?: string | null
  cwd?: string | null
  cols?: number
  rows?: number
}

export interface TerminalCreateResult {
  ok: boolean
  id?: string
  profile?: ShellProfile
  error?: string
}

export interface TerminalAttachResult {
  ok: boolean
  /** Recent output, to redraw a screen after a reload. */
  replay?: string
  alive?: boolean
  exitCode?: number | null
  error?: string
}

export interface TerminalInfo {
  id: string
  profileId: string
  pid: number
  alive: boolean
  exitCode: number | null
}

// ── The lazily-loaded native module ────────────────────────────────────────

type PtyProcess = {
  readonly pid: number
  onData(cb: (data: string) => void): unknown
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pause(): void
  resume(): void
}

type PtyModule = {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
      useConpty?: boolean
    },
  ): PtyProcess
}

let ptyModule: PtyModule | null = null
let ptyError: string | null = null
let ptyTried = false

async function loadPty(): Promise<PtyModule | null> {
  if (ptyTried) return ptyModule
  ptyTried = true
  try {
    const mod = (await import('@lydell/node-pty')) as unknown as
      { default?: PtyModule } & PtyModule
    // The package sets `module.exports` to the platform package wholesale, so
    // depending on how the CJS/ESM interop resolves it the callable surface is
    // either the namespace or its `default`. Take whichever has `spawn`.
    ptyModule = typeof mod.spawn === 'function' ? mod : (mod.default ?? null)
    if (!ptyModule) ptyError = 'The terminal backend loaded but exposed no spawn function.'
  } catch (err) {
    ptyModule = null
    ptyError = err instanceof Error ? err.message : String(err)
    console.error('[Terminal] node-pty unavailable:', ptyError)
  }
  return ptyModule
}

// ── Sessions ───────────────────────────────────────────────────────────────

interface Session {
  id: string
  profile: ShellProfile
  pty: PtyProcess
  /** Where output goes. Reassigned on attach, so a reloaded renderer takes over
   *  from the destroyed one rather than the session going quiet. */
  target: WebContents
  pending: string[]
  pendingChars: number
  timer: ReturnType<typeof setTimeout> | null
  unacked: number
  paused: boolean
  replay: string[]
  replayChars: number
  alive: boolean
  exitCode: number | null
}

const sessions = new Map<string, Session>()

function send(session: Session, channel: string, payload: unknown): void {
  if (session.target.isDestroyed()) return
  session.target.send(channel, payload)
}

function flush(session: Session): void {
  if (session.timer) {
    clearTimeout(session.timer)
    session.timer = null
  }
  if (session.pending.length === 0) return

  const data = session.pending.join('')
  session.pending = []
  session.pendingChars = 0

  remember(session, data)
  session.unacked += data.length
  send(session, 'terminal:data', { id: session.id, data })

  if (!session.paused && session.unacked > HIGH_WATER) {
    session.paused = true
    try { session.pty.pause() } catch { /* a dead pty cannot be paused */ }
  }
}

/**
 * Keep the tail of the output, for a reattaching renderer.
 *
 * Trimmed by whole chunks wherever possible: an escape sequence cut in half
 * replays as garbage, and dropping a whole chunk at least cuts at a boundary
 * the writer chose. A single chunk larger than the whole budget is sliced —
 * there is nothing else to do with it, and it is already an unusual write.
 */
function remember(session: Session, data: string): void {
  session.replay.push(data)
  session.replayChars += data.length
  while (session.replayChars > REPLAY_CHARS && session.replay.length > 1) {
    session.replayChars -= session.replay.shift()!.length
  }
  if (session.replayChars > REPLAY_CHARS && session.replay.length === 1) {
    const only = session.replay[0]
    session.replay[0] = only.slice(only.length - REPLAY_CHARS)
    session.replayChars = session.replay[0].length
  }
}

function onData(session: Session, data: string): void {
  session.pending.push(data)
  session.pendingChars += data.length
  if (session.pendingChars >= FLUSH_CHARS) {
    flush(session)
    return
  }
  if (!session.timer) session.timer = setTimeout(() => flush(session), FLUSH_MS)
}

function ack(session: Session, chars: number): void {
  session.unacked = Math.max(0, session.unacked - chars)
  if (session.paused && session.unacked <= LOW_WATER) {
    session.paused = false
    try { session.pty.resume() } catch { /* a dead pty cannot be resumed */ }
  }
}

/**
 * The environment a shell is launched with.
 *
 * Electron's own variables are stripped rather than inherited: a shell that
 * still has `ELECTRON_RUN_AS_NODE` set will turn any `electron` the user runs
 * from it into a bare Node, and `NODE_OPTIONS` from our own process has no
 * business reaching the user's tools. `TERM` and `COLORTERM` are what tell
 * those tools that colour is available at all.
 */
function shellEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k === 'ELECTRON_RUN_AS_NODE' || k === 'NODE_OPTIONS' || k === 'ELECTRON_NO_ATTACH_CONSOLE') {
      continue
    }
    out[k] = v
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  out.TERM_PROGRAM = 'ouRGeo'
  return out
}

function exists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The shells on this machine. Recomputed per call — installing a shell while
 *  ouRGeo is open should show up in the menu without a restart. */
function profiles(): ShellProfile[] {
  return availableShells(process.platform, process.env, exists)
}

function destroy(session: Session): void {
  if (session.timer) clearTimeout(session.timer)
  session.timer = null
  try { session.pty.kill() } catch { /* already gone */ }
  sessions.delete(session.id)
}

/** Kill every shell. Called on quit — a pty outliving the app is an orphan
 *  process the user has no way to see, let alone stop. */
export function killAllTerminals(): void {
  for (const session of [...sessions.values()]) destroy(session)
}

// ── IPC ────────────────────────────────────────────────────────────────────

export function registerTerminalHandlers(ipcMain: IpcMain): void {
  // Asked before the panel draws anything, so a machine with no usable binary
  // gets an explanation rather than a terminal that fails on first keystroke.
  ipcMain.handle('terminal:available', async (): Promise<{ ok: boolean; error?: string }> => {
    const mod = await loadPty()
    return mod ? { ok: true } : { ok: false, error: ptyError ?? 'unknown' }
  })

  ipcMain.handle('terminal:shells', (): ShellProfile[] => profiles())

  ipcMain.handle('terminal:create', async (
    event, req: TerminalCreateRequest,
  ): Promise<TerminalCreateResult> => {
    const mod = await loadPty()
    if (!mod) return { ok: false, error: ptyError ?? 'The terminal backend is unavailable.' }

    const profile = resolveShell(profiles(), req.profileId)
    if (!profile) {
      return { ok: false, error: 'No shell could be found on this system.' }
    }

    const cwd = req.cwd && req.cwd.length > 0 ? req.cwd : (process.env.HOME ?? process.cwd())
    let child: PtyProcess
    try {
      child = mod.spawn(profile.path, profile.args, {
        name: 'xterm-256color',
        cols: Math.max(2, req.cols ?? 80),
        rows: Math.max(1, req.rows ?? 24),
        cwd,
        env: shellEnv(),
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    const session: Session = {
      id: randomUUID(),
      profile,
      pty: child,
      target: event.sender,
      pending: [],
      pendingChars: 0,
      timer: null,
      unacked: 0,
      paused: false,
      replay: [],
      replayChars: 0,
      alive: true,
      exitCode: null,
    }
    sessions.set(session.id, session)

    child.onData((data) => onData(session, data))
    child.onExit(({ exitCode, signal }) => {
      session.alive = false
      session.exitCode = exitCode
      // Flush first: a program's last words are often the only explanation of
      // why it exited, and dropping them loses exactly the output that matters.
      flush(session)
      send(session, 'terminal:exit', { id: session.id, exitCode, signal: signal ?? null })
    })

    return { ok: true, id: session.id, profile }
  })

  // Reattach after a reload. The session keeps running throughout; this only
  // moves where its output is delivered and hands back what was missed.
  ipcMain.handle('terminal:attach', (event, id: string): TerminalAttachResult => {
    const session = sessions.get(id)
    if (!session) return { ok: false, error: 'That terminal is no longer open.' }
    flush(session)
    session.target = event.sender
    // The replay was already counted as sent to a renderer that is now gone;
    // the new one has drawn nothing, so the debt starts again from zero.
    session.unacked = 0
    if (session.paused) {
      session.paused = false
      try { session.pty.resume() } catch { /* dead */ }
    }
    return {
      ok: true,
      replay: session.replay.join(''),
      alive: session.alive,
      exitCode: session.exitCode,
    }
  })

  ipcMain.on('terminal:write', (_event, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session || !session.alive) return
    try { session.pty.write(data) } catch { /* raced with exit */ }
  })

  ipcMain.on('terminal:ack', (_event, id: string, chars: number) => {
    const session = sessions.get(id)
    if (session) ack(session, chars)
  })

  ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session || !session.alive) return
    try { session.pty.resize(Math.max(2, cols), Math.max(1, rows)) } catch { /* raced */ }
  })

  ipcMain.handle('terminal:kill', (_event, id: string): boolean => {
    const session = sessions.get(id)
    if (!session) return false
    destroy(session)
    return true
  })

  ipcMain.handle('terminal:list', (): TerminalInfo[] => (
    [...sessions.values()].map((s) => ({
      id: s.id,
      profileId: s.profile.id,
      pid: s.pty.pid,
      alive: s.alive,
      exitCode: s.exitCode,
    }))
  ))
}
