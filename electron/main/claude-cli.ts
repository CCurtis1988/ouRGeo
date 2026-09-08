import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type { IpcMain, WebContents } from 'electron'
import { dialog, powerSaveBlocker } from 'electron'
import { startMcpBridge, type McpToolDef } from './claude-mcp'
import { buildClaudeArgs, mcpConfigJson, userMessageLine } from '../../src/lib/ai-claude-args'

/**
 * Running the user's own Claude Code CLI, so a Claude subscription can drive
 * the assistant.
 *
 * A subscription is not an API key and cannot be turned into one. What it can
 * do is authenticate the CLI the user already installed and signed in to, and
 * that CLI's `--print` mode emits, inside its own NDJSON, the verbatim
 * Anthropic Messages streaming events our own transport already reads.
 *
 * **The line this must never cross:** ouRGeo does not read, copy or reuse the
 * CLI's stored credentials — not `~/.claude/.credentials.json`, not the OS
 * keychain, not a token lifted from either — to call the API itself. It spawns
 * the user's program and lets it do its own authentication. Nothing here
 * should ever need to know what a Claude token looks like.
 *
 * Spawning belongs in main (r-bridge, knit, terminal are the precedent), and
 * the IPC contract is `ai-proxy.ts`'s, line for line: a request id, chunks
 * back on `claude:chunk:<id>`, then done or error.
 */

let configuredPath: string | null = null

// ── Finding the binary ─────────────────────────────────────────────────────

/**
 * Where a `claude` might be, in the order worth trying.
 *
 * The PATH problem is the one the terminal already documents: launchd gives a
 * GUI app a minimal PATH, so on macOS neither `~/.local/bin` nor Homebrew is
 * on it, and "not installed" would be the wrong answer for a machine that has
 * it. Every candidate is confirmed by running `--version`, never by
 * `existsSync` — a stale shim from an uninstalled npm global is the common
 * failure, and it exists right up until you run it.
 */
function candidatePaths(): string[] {
  const home = os.homedir()
  const exe = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  const out = [
    exe, // whatever PATH has, if anything
    path.join(home, '.local', 'bin', exe),
    path.join(home, '.claude', 'local', exe),
    path.join(home, '.bun', 'bin', exe),
  ]
  if (process.platform === 'darwin') {
    out.push('/opt/homebrew/bin/claude', '/usr/local/bin/claude')
  } else if (process.platform !== 'win32') {
    out.push('/usr/local/bin/claude', '/usr/bin/claude')
  } else {
    out.push(path.join(process.env.APPDATA ?? '', 'npm', 'claude.cmd'))
  }
  return out.filter(Boolean)
}

function run(
  binary: string, args: string[], timeoutMs = 15000
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      binary, args,
      // `.cmd` on Windows is a batch script, which CreateProcess cannot run
      // directly — the usual npm-shim trap.
      { timeout: timeoutMs, windowsHide: true, shell: process.platform === 'win32' },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
    )
  })
}

export interface ClaudeInstallation {
  path: string
  version: string
}

export async function detectClaude(): Promise<ClaudeInstallation | null> {
  const tried = configuredPath ? [configuredPath, ...candidatePaths()] : candidatePaths()
  // All at once, then the first that worked IN PRIORITY ORDER. Sequentially
  // this is one CLI start-up per miss — about a second each — and the settings
  // row sat on "Looking for the Claude Code CLI…" for six seconds on a machine
  // where it was installed. Probing costs nothing; waiting does.
  const results = await Promise.all(tried.map((p) => run(p, ['--version'])))
  for (let i = 0; i < tried.length; i++) {
    const res = results[i]
    // `2.1.263 (Claude Code)` — anything else is some other `claude` on PATH.
    const m = res.ok ? /(\d+\.\d+\.\d+)/.exec(res.stdout) : null
    if (m && /claude/i.test(res.stdout)) return { path: tried[i], version: m[1] }
  }
  return null
}

export interface ClaudeAuth {
  loggedIn: boolean
  authMethod: string | null
  subscriptionType: string | null
  email: string | null
  /** Only set when the CLI could not be asked at all. */
  error?: string
}

/**
 * Who the CLI is signed in as.
 *
 * `claude auth status --json` answers it, and the answer is what the settings
 * row shows instead of an API-key field. `authMethod: "claude.ai"` is the
 * subscription path — an `apiKey` there means the CLI is billing an API
 * account, which is a thing worth saying out loud rather than letting the user
 * discover on an invoice.
 */
export async function claudeAuthStatus(binary: string): Promise<ClaudeAuth> {
  const res = await run(binary, ['auth', 'status', '--json'])
  try {
    const d = JSON.parse(res.stdout) as Record<string, unknown>
    return {
      loggedIn: d.loggedIn === true,
      authMethod: typeof d.authMethod === 'string' ? d.authMethod : null,
      subscriptionType: typeof d.subscriptionType === 'string' ? d.subscriptionType : null,
      email: typeof d.email === 'string' ? d.email : null,
    }
  } catch {
    return {
      loggedIn: false, authMethod: null, subscriptionType: null, email: null,
      error: res.stderr.trim() || 'Could not read the CLI’s authentication status.',
    }
  }
}

// ── Running one turn ───────────────────────────────────────────────────────

interface StartRequest {
  prompt: string
  systemPrompt: string
  model: string
  sessionId: string
  resume: boolean
  tools: McpToolDef[]
  cwd: string
}

interface Live {
  child: ChildProcess
  bridge: { close: () => void } | null
  /** Temp files for this run: the system prompt, and the MCP config. */
  files: string[]
  blocker: number | null
  /** Tool calls waiting on the renderer, keyed by the id we handed it. */
  pending: Map<string, { resolve: (s: string) => void; reject: (e: Error) => void }>
}

const live = new Map<string, Live>()

function send(wc: WebContents, channel: string, ...args: unknown[]): void {
  if (!wc.isDestroyed()) wc.send(channel, ...args)
}

async function cleanup(id: string): Promise<void> {
  const l = live.get(id)
  if (!l) return
  live.delete(id)
  l.bridge?.close()
  for (const p of l.pending.values()) p.reject(new Error('the run ended'))
  if (l.blocker !== null && powerSaveBlocker.isStarted(l.blocker)) {
    powerSaveBlocker.stop(l.blocker)
  }
  // The system prompt is the user's session context — objects, console
  // output, open documents — and the MCP config holds the bridge's bearer
  // token. Both live exactly as long as the run needs them.
  await Promise.all(l.files.map((f) => fs.rm(f, { force: true }).catch(() => {})))
}

export function registerClaudeCliHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('claude:detect', () => detectClaude())
  ipcMain.handle('claude:getPath', () => configuredPath)
  ipcMain.handle('claude:setPath', (_e, p: string | null) => { configuredPath = p || null })
  ipcMain.handle('claude:authStatus', async (_e, binary?: string) => {
    const bin = binary || (await detectClaude())?.path
    if (!bin) {
      return {
        loggedIn: false, authMethod: null, subscriptionType: null, email: null,
        error: 'The Claude Code CLI was not found on this machine.',
      } satisfies ClaudeAuth
    }
    return claudeAuthStatus(bin)
  })

  ipcMain.handle('claude:browse', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select the claude executable',
      properties: ['openFile'],
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.on('claude:start', async (event, id: string, req: StartRequest) => {
    const wc = event.sender
    try {
      const install = configuredPath
        ? { path: configuredPath, version: '' }
        : await detectClaude()
      if (!install) throw new Error('The Claude Code CLI was not found. Set its path in Settings → AI Assistant.')

      // Tens of thousands of characters of session context — objects, console
      // tail, open documents — go in a file, because Windows caps a command
      // line at 32,767 characters and this is the piece that grows.
      const stem = path.join(os.tmpdir(), `ourgeo-claude-${crypto.randomBytes(8).toString('hex')}`)
      const promptFile = `${stem}.txt`
      await fs.writeFile(promptFile, req.systemPrompt, 'utf8')
      const files = [promptFile]

      const bridge = req.tools.length > 0
        ? await startMcpBridge(req.tools, (name, input) => new Promise<string>((resolve, reject) => {
            const l = live.get(id)
            if (!l) { reject(new Error('the run ended')); return }
            const callId = crypto.randomUUID()
            l.pending.set(callId, { resolve, reject })
            // The renderer runs it: same `runTool` every other provider uses,
            // so the confirm modal, the console echo and the switches are the
            // same ones, decided in the same place.
            send(wc, `claude:tool:${id}`, { callId, name, input })
          }))
        : null

      let mcpConfigFile: string | null = null
      if (bridge) {
        mcpConfigFile = `${stem}.mcp.json`
        // The token is in this file, so it lives in the OS temp directory for
        // the length of one run and is deleted with the prompt.
        await fs.writeFile(mcpConfigFile, mcpConfigJson({ url: bridge.url, token: bridge.token }), 'utf8')
        files.push(mcpConfigFile)
      }

      const args = buildClaudeArgs({
        binary: install.path,
        systemPromptFile: promptFile,
        model: req.model,
        sessionId: req.sessionId,
        resume: req.resume,
        mcpConfigFile,
        tools: req.tools,
        cwd: req.cwd,
      })

      const child = spawn(install.path, args, {
        cwd: req.cwd,
        windowsHide: true,
        shell: process.platform === 'win32',
        env: { ...process.env },
      })

      // A long request must not be interrupted by idle-suspend — the same
      // reason raster registration and /r/execute hold one.
      const blocker = powerSaveBlocker.start('prevent-app-suspension')
      live.set(id, { child, bridge, files, blocker, pending: new Map() })

      child.stdin?.write(userMessageLine(req.prompt))
      child.stdin?.end()

      // NDJSON, buffered across reads: one event routinely straddles two
      // chunks, and a tool's arguments arrive as many small ones.
      let buf = ''
      child.stdout?.on('data', (d: Buffer) => {
        buf += d.toString()
        for (;;) {
          const nl = buf.indexOf('\n')
          if (nl < 0) break
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) send(wc, `claude:chunk:${id}`, line)
        }
      })
      let stderr = ''
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

      child.on('error', (err) => {
        void cleanup(id).then(() => send(wc, `claude:error:${id}`, String(err)))
      })
      child.on('close', (code) => {
        if (buf.trim()) send(wc, `claude:chunk:${id}`, buf)
        void cleanup(id).then(() => send(wc, `claude:done:${id}`, code, stderr))
      })
    } catch (err) {
      await cleanup(id)
      send(wc, `claude:error:${id}`, err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.on('claude:toolResult', (_e, id: string, callId: string, output: string) => {
    const p = live.get(id)?.pending.get(callId)
    live.get(id)?.pending.delete(callId)
    p?.resolve(output)
  })

  ipcMain.on('claude:abort', (_e, id: string) => {
    const l = live.get(id)
    if (!l) return
    l.child.kill('SIGTERM')
    void cleanup(id)
  })
}
