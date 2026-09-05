// Opening, adopting and closing shell sessions.
//
// The imperative half of the Terminal panel, kept out of the components for
// the reason every other extraction in this repo exists: the AI actions call
// exactly these functions, so `terminal:open` and the `+` button cannot drift
// into doing subtly different things.
//
// ── Two races this file exists to lose safely ──────────────────────────────
//
// **React StrictMode double-invokes effects in dev.** A session created from a
// mount effect would spawn TWO shells, and the second is invisible — it has no
// tab, and it sits there holding a pty until the app quits. So creation is
// idempotent by construction: `ensureSession` checks the store and de-dupes
// concurrent calls through a single in-flight promise.
//
// **Output can arrive before a view is ready for it.** `attach` returns the
// replay buffer, but data emitted between the request and the reply is sent
// immediately — so a sink registered after the await would miss it, and the
// symptom is a missing first line that only shows up on a fast machine. The
// sink is therefore registered BEFORE the attach, buffering until the replay
// has been written.

import { useTerminalStore, type TerminalSession } from '@/store/terminal'
import { useSessionStore } from '@/store/session'

type Sink = (data: string) => void

/**
 * Listeners per session, plural.
 *
 * One-per-session was the first shape and it was wrong: `terminal:run` has to
 * watch the stream for its completion marker WHILE the view keeps drawing it,
 * because a command the assistant ran that produces nothing on screen is
 * exactly the failure the visible-tab rule exists to prevent. A set costs
 * nothing and removes the whole question.
 */
const sinks = new Map<string, Set<Sink>>()
let wired = false

/** Start listening for pty output and exits. Idempotent; called by everything
 *  that might be the first to need it. */
export function initTerminals(): void {
  if (wired || typeof window === 'undefined' || !window.electronAPI?.terminal) return
  wired = true
  window.electronAPI.terminal.onData((id, data) => {
    const listeners = sinks.get(id)
    if (!listeners) return
    // A copy: a listener that unsubscribes itself mid-notify (the run watcher
    // does exactly that when it sees its marker) would otherwise mutate the
    // set being iterated.
    for (const fn of [...listeners]) fn(data)
  })
  window.electronAPI.terminal.onExit((id, exitCode) => {
    useTerminalStore.getState().markExited(id, exitCode)
  })
}

/**
 * Route one session's output somewhere, and acknowledge what was drawn.
 *
 * The returned unsubscribe leaves the SESSION running — a view unmounting is
 * not a shell exiting. Output produced meanwhile accumulates in main's replay
 * ring and, once the unacknowledged total passes the high-water mark, back-
 * pressures the pty; both are what should happen to a program still writing to
 * a terminal nobody is looking at.
 */
export function registerSink(id: string, sink: Sink): () => void {
  initTerminals()
  const set = sinks.get(id) ?? new Set<Sink>()
  set.add(sink)
  sinks.set(id, set)
  return () => {
    const live = sinks.get(id)
    if (!live) return
    live.delete(sink)
    if (live.size === 0) sinks.delete(id)
  }
}

/** Where a new terminal starts: R's working directory, so a relative path
 *  means the same thing in the shell as it does at the R prompt. */
function startingDirectory(): string | null {
  const { prefs } = useTerminalStore.getState()
  if (!prefs.followRWorkingDir) return null
  return useSessionStore.getState().workingDir
}

/** `Bash`, then `Bash 2` — the shell's own title sequence usually replaces
 *  this within a prompt or two, but a tab must never be born nameless. */
function titleFor(label: string, profileId: string, existing: TerminalSession[]): string {
  const n = existing.filter((s) => s.profileId === profileId).length
  return n === 0 ? label : `${label} ${n + 1}`
}

/** Open a shell. Resolves to the session id, or null when the backend refused
 *  — the reason is put on the store for the panel to show. */
export async function openSession(opts: {
  profileId?: string | null
  cwd?: string | null
} = {}): Promise<string | null> {
  initTerminals()
  const store = useTerminalStore.getState()
  const res = await window.electronAPI.terminal.create({
    profileId: opts.profileId ?? store.prefs.profileId,
    cwd: opts.cwd ?? startingDirectory(),
  })
  if (!res.ok || !res.id || !res.profile) {
    store.setBackendError(res.error ?? 'The terminal could not be opened.')
    return null
  }
  store.setBackendError(null)
  store.addSession({
    id: res.id,
    profileId: res.profile.id,
    title: titleFor(res.profile.label, res.profile.id, store.sessions),
    renamed: false,
    cwd: opts.cwd ?? startingDirectory(),
    alive: true,
    exitCode: null,
    bell: false,
  })
  return res.id
}

let pending: Promise<string | null> | null = null

/**
 * Make sure the panel has at least one terminal, exactly once.
 *
 * Both guards are load-bearing: the store check stops a second shell when the
 * panel is toggled, and the in-flight promise stops one when two callers ask
 * during the same await — which in dev is simply what StrictMode does.
 */
export function ensureSession(): Promise<string | null> {
  const { sessions, activeId } = useTerminalStore.getState()
  if (sessions.length > 0) return Promise.resolve(activeId)
  if (pending) return pending
  pending = openSession().finally(() => { pending = null })
  return pending
}

/** Close a tab: kill the shell if it is still running, then drop the row. */
export async function closeSession(id: string): Promise<void> {
  sinks.delete(id)
  await window.electronAPI.terminal.kill(id)
  useTerminalStore.getState().removeSession(id)
}

/**
 * Re-adopt the shells main is still running.
 *
 * This is what makes a renderer reload — Ctrl+R, or the automatic reload
 * `index.ts` performs when the renderer process dies — non-destructive. The
 * ptys are children of main and never stopped; only this side's record of them
 * was lost, and `attach` hands back enough output to redraw each screen.
 */
export async function adoptRunningSessions(): Promise<void> {
  initTerminals()
  const running = await window.electronAPI.terminal.list()
  const store = useTerminalStore.getState()
  const known = new Set(store.sessions.map((s) => s.id))
  for (const info of running) {
    if (known.has(info.id)) continue
    store.addSession({
      id: info.id,
      profileId: info.profileId,
      // The shell's own title sequence will replace this within a prompt or
      // two; a name the user had chosen is not recoverable and is not worth
      // persisting for, since the session dies with the app anyway.
      title: info.profileId,
      renamed: false,
      cwd: null,
      alive: info.alive,
      exitCode: info.exitCode,
      bell: false,
    })
  }
}

/**
 * Ask the OS where the shell is, and remember the answer.
 *
 * Two sources, in order: what the shell told us via OSC 7, and — for the many
 * shells that say nothing (a stock bash says nothing at all) — the kernel,
 * which main can ask because we own the pty and therefore know its pid.
 *
 * Called when the tab menu is about to open rather than on a timer: the answer
 * only matters at the moment someone is deciding what to do with it, and
 * polling every terminal's cwd forever to keep a menu item enabled would be a
 * lot of syscalls for a label.
 */
export async function refreshCwd(id: string): Promise<string | null> {
  const store = useTerminalStore.getState()
  const known = store.sessions.find((s) => s.id === id)?.cwd ?? null
  const found = await window.electronAPI.terminal.cwd(id)
  const cwd = found ?? known
  if (cwd !== known) store.patchSession(id, { cwd })
  return cwd
}

/** Type into a shell. */
export function writeToSession(id: string, data: string): void {
  window.electronAPI.terminal.write(id, data)
}

/** Ctrl-C. Written as a char code rather than a literal control character,
 *  which would be invisible in the source and silently dropped by any tool
 *  that trims or re-encodes the file. */
export const ETX = String.fromCharCode(3)

export function interruptSession(id: string): void {
  writeToSession(id, ETX)
}
