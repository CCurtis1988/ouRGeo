// Driving the terminal.
//
// The assistant can open a shell, run a command in it and read what came back
// — behind a switch of its own, because this is the one group where a mistyped
// argument reaches the machine rather than the R session.
//
// ── What the Terminal switch is, and what it is not ────────────────────────
//
// Every action here carries `requires: 'terminal'`, so both the Terminal
// switch and Autopilot must be on. That is a deliberate second act, not a
// security boundary, and the docs say so in those words: R's own `system()`
// has always reached the OS from behind Autopilot alone, so a determined model
// was never actually contained. What the switch buys is that running shell
// commands is something the user turned on ON PURPOSE, once, rather than
// something that came along with a general-purpose assistant.
//
// The accountability is the other half, and it matters more than the gate:
// every command is TYPED INTO A TAB THE USER CAN SEE, in the shell they are
// using, and logged to the R console as an `info` entry. Nothing runs in a
// hidden shell. That is the same rule `describeWebCall` and `describeVoiceCall`
// follow, and here it is the thing that makes an autopilot-tier default
// defensible.

import { ok, fail, argStr, argNum, type UiAction } from './types'
import { useTerminalStore } from '@/store/terminal'
import { useLayoutStore } from '@/store/layout'
import {
  openSession, closeSession, writeToSession, interruptSession, refreshCwd,
  registerSink, initTerminals,
} from '@/lib/terminal/sessions'
import { shellFamily } from '@/lib/terminal/shells'
import {
  buildRunLine, parseRunMarker, isRunMarker, stripRunEcho, RUN_OSC,
} from '@/lib/terminal/run-markers'

/** How long to wait for a command's completion marker before giving up on it
 *  and reporting what arrived. Long enough for a `git clone` or an install;
 *  the caller is told when it expires rather than being left to guess. */
const RUN_TIMEOUT_MS = 120_000

/** Where a run's output is capped. A model handed a megabyte of `find /` learns
 *  nothing it did not know at 8 KB, and pays for all of it. */
const MAX_OUTPUT = 8_000

/**
 * The completion marker as it arrives in the stream.
 *
 * Built rather than written out because the OSC number lives in one place, and
 * because both terminators are legal: xterm and most shells use BEL, but the
 * ST form (ESC backslash) is the standard one and some emit it.
 */
function markerPattern(flags = ''): RegExp {
  const BEL = '\\u0007'
  const ESC = '\\u001b'
  return new RegExp(`${ESC}\\]${RUN_OSC};([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, flags)
}

/**
 * Terminal output as plain text.
 *
 * Escape sequences are noise to a reader — colour, cursor moves, title
 * changes — and a model paying per token should not be paying for them. Built
 * from character codes rather than written as literals: a raw ESC in source is
 * invisible to review and to any tool that re-encodes the file, which is the
 * same trap `run-markers.ts` avoids for the opposite reason.
 */
function stripAnsi(text: string): string {
  const ESC = '\\u001b'
  const BEL = '\\u0007'
  return text
    // OSC: ESC ] … terminated by BEL or ST.
    .replace(new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g'), '')
    // CSI: ESC [ … final byte.
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, 'g'), '')
    // Anything else two-character, so a stray ESC does not survive.
    .replace(new RegExp(`${ESC}.`, 'g'), '')
}

/** Ensure the panel is open and showing, so a command the assistant runs is
 *  one the user can watch. Opening a panel behind another tab is the same as
 *  not opening it. */
function revealPanel(): void {
  const layout = useLayoutStore.getState()
  layout.setPanelOpen('terminal', true)
  layout.setActivePanel('terminal')
}

function sessionOr(id: string): { id: string } | null {
  const store = useTerminalStore.getState()
  const wanted = id || store.activeId || ''
  const hit = store.sessions.find((s) => s.id === wanted && s.alive)
  return hit ? { id: hit.id } : null
}

/** The shell family of a session, for the run marker. */
function familyOf(sessionId: string): ReturnType<typeof shellFamily> {
  const store = useTerminalStore.getState()
  const session = store.sessions.find((s) => s.id === sessionId)
  const profile = store.profiles.find((p) => p.id === session?.profileId)
  return shellFamily(profile ?? { id: session?.profileId ?? '', path: session?.profileId ?? '' })
}

function trimOutput(text: string): string {
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '')
  if (clean.length <= MAX_OUTPUT) return clean
  // The TAIL, not the head: a command's verdict is at the end, and truncating
  // the other way hands back a build log's preamble and drops the error.
  return `… ${clean.length - MAX_OUTPUT} characters omitted …\n${clean.slice(-MAX_OUTPUT)}`
}

/**
 * Run one command and wait for it to finish.
 *
 * The waiting is the interesting part — see `run-markers.ts` for why a pty
 * cannot simply be asked. The marker arrives through xterm's OSC handler in
 * the view when the panel is showing, but this must work whether or not
 * anything is rendered, so it watches the raw stream itself and does its own
 * (much simpler) scan: a full sequence, never split, because a marker that
 * straddled two chunks would just time out rather than corrupt anything.
 */
async function runInSession(sessionId: string, command: string): Promise<{
  output: string; exitCode: number | null; timedOut: boolean
}> {
  initTerminals()
  const family = familyOf(sessionId)
  const line = buildRunLine(command, family)

  let buffer = ''
  let settle: ((v: { exitCode: number | null; timedOut: boolean }) => void) | null = null
  const finished = new Promise<{ exitCode: number | null; timedOut: boolean }>((resolve) => {
    settle = resolve
  })

  // A listener ALONGSIDE the view's, not instead of it: the user watches the
  // command run in their own tab, which is the whole basis on which running
  // shell commands from the assistant is safe to offer.
  const stopWatching = registerSink(sessionId, (data) => {
    buffer += data
    if (!line.reportsExitCode) return
    const m = markerPattern().exec(buffer)
    if (m && isRunMarker(m[1])) settle?.({ exitCode: parseRunMarker(m[1]), timedOut: false })
  })

  writeToSession(sessionId, line.text)

  const timer = setTimeout(() => settle?.({ exitCode: null, timedOut: true }), RUN_TIMEOUT_MS)
  // A shell we cannot instrument gets a quiet period instead: not a completion
  // signal, and reported as one would be a lie, so the caller says "finished
  // running" without a status.
  const quiet = line.reportsExitCode
    ? null
    : setTimeout(() => settle?.({ exitCode: null, timedOut: false }), 2_000)

  const result = await finished
  clearTimeout(timer)
  if (quiet) clearTimeout(quiet)
  stopWatching()

  // Strip our own plumbing out of what the model is shown: the marker sequence
  // itself, and the echoed command line that carries it.
  const withoutMarker = buffer.replace(markerPattern('g'), '')
  return {
    output: trimOutput(stripRunEcho(withoutMarker, command, family)),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
  }
}


export const terminalActions: UiAction[] = [
  {
    id: 'terminal:list',
    group: 'terminal',
    summary: 'List the open terminal tabs: which shell each is, where it is, and whether it is still running.',
    params: [],
    tier: 'always',
    requires: 'terminal',
    run: async () => {
      const store = useTerminalStore.getState()
      if (store.backendError) {
        return fail(`The terminal is unavailable on this system: ${store.backendError}`)
      }
      if (store.sessions.length === 0) return ok('No terminal is open. Use terminal:open.')
      const rows = await Promise.all(store.sessions.map(async (s) => {
        const cwd = s.alive ? await refreshCwd(s.id) : s.cwd
        const state = s.alive ? 'running' : `exited (${s.exitCode ?? '?'})`
        return `${s.id} — ${s.title} [${s.profileId}] in ${cwd ?? 'an unknown directory'}, ${state}`
      }))
      return ok(`${store.sessions.length} terminal(s):`, rows.join('\n'))
    },
  },

  {
    id: 'terminal:open',
    group: 'terminal',
    summary: 'Open a new terminal tab, optionally with a particular shell and starting directory.',
    params: [
      {
        name: 'shell',
        type: 'enum',
        description: 'Shell profile id. Omit for the user’s default.',
        valuesAt: () => useTerminalStore.getState().profiles.map((p) => p.id),
        lenient: true,
      },
      { name: 'cwd', type: 'string', description: 'Directory to start in. Omit for R’s working directory.' },
    ],
    tier: 'autopilot',
    requires: 'terminal',
    run: async (args) => {
      const store = useTerminalStore.getState()
      if (store.backendError) {
        return fail(`The terminal is unavailable on this system: ${store.backendError}`)
      }
      revealPanel()
      const shell = argStr(args, 'shell')
      if (shell && !store.profiles.some((p) => p.id === shell)) {
        return fail(
          `No shell called "${shell}" on this machine. Available: ` +
          `${store.profiles.map((p) => p.id).join(', ') || 'none detected'}.`,
        )
      }
      const id = await openSession({
        profileId: shell || null,
        cwd: argStr(args, 'cwd') || null,
      })
      if (!id) {
        return fail(useTerminalStore.getState().backendError ?? 'The shell could not be started.')
      }
      return ok(`Opened a terminal (${id}).`)
    },
  },

  {
    id: 'terminal:run',
    group: 'terminal',
    summary: 'Run a shell command in a terminal tab and return its output and exit code. The command is typed into a tab the user can see.',
    params: [
      { name: 'command', type: 'string', description: 'The command line to run.', required: true },
      { name: 'terminal', type: 'string', description: 'Session id from terminal:list. Omit for the active tab.' },
    ],
    tier: 'autopilot',
    requires: 'terminal',
    run: async (args) => {
      const command = argStr(args, 'command').trim()
      if (!command) return fail('No command given.')
      // A newline would run whatever is on the second line as a separate
      // command, unwatched and unreported — the marker only measures the first.
      if (/[\r\n]/.test(command)) {
        return fail(
          'Run one command at a time: this one contains a newline, and only the first line ' +
          'would be measured. Join them with && or ; if they belong together.',
        )
      }
      const store = useTerminalStore.getState()
      if (store.backendError) {
        return fail(`The terminal is unavailable on this system: ${store.backendError}`)
      }
      revealPanel()
      let target = sessionOr(argStr(args, 'terminal'))
      if (!target) {
        const id = await openSession()
        if (!id) {
          return fail(useTerminalStore.getState().backendError ?? 'No terminal could be opened.')
        }
        target = { id }
        // A shell needs a moment to print its first prompt; typing into it
        // before then can land the command in the middle of the prompt's own
        // output, where the echo the stripper looks for is not where it expects.
        await new Promise((r) => setTimeout(r, 700))
      }

      const res = await runInSession(target.id, command)
      const body = res.output.trim() || '(no output)'
      if (res.timedOut) {
        return ok(
          `Still running after ${RUN_TIMEOUT_MS / 1000}s — output so far. It has not been ` +
          'stopped; use terminal:interrupt if it should be.',
          body,
        )
      }
      if (res.exitCode === null) {
        return ok('Finished running. This shell does not report exit codes.', body)
      }
      return res.exitCode === 0
        ? ok('Exit code 0.', body)
        : ok(`Exit code ${res.exitCode}.`, body)
    },
  },

  {
    id: 'terminal:read',
    group: 'terminal',
    summary: 'Read what is on a terminal’s screen — the recent output, including anything the user ran themselves.',
    params: [
      { name: 'terminal', type: 'string', description: 'Session id. Omit for the active tab.' },
      { name: 'lines', type: 'number', description: 'How many lines from the end.', default: 60 },
    ],
    tier: 'always',
    requires: 'terminal',
    run: async (args) => {
      const store = useTerminalStore.getState()
      // Not `sessionOr`: reading an EXITED terminal is the normal case — the
      // tab stays after the shell dies precisely so the output can be read,
      // and refusing here would make the tab's whole reason for staying moot.
      const id = argStr(args, 'terminal') || store.activeId || ''
      if (!store.sessions.some((s) => s.id === id)) return fail('No terminal is open.')
      const res = await window.electronAPI.terminal.attach(id)
      if (!res.ok) return fail(res.error ?? 'That terminal is no longer open.')
      const wanted = Math.max(1, Math.min(500, argNum(args, 'lines', 60)))
      const lines = stripAnsi(res.replay ?? '')
        .replace(/\r\n/g, '\n').replace(/\r/g, '')
        .split('\n')
      return ok(
        `The last ${Math.min(wanted, lines.length)} lines of ${id}:`,
        lines.slice(-wanted).join('\n'),
      )
    },
  },

  {
    id: 'terminal:interrupt',
    group: 'terminal',
    summary: 'Send Ctrl+C to a terminal, stopping whatever is running in it.',
    params: [
      { name: 'terminal', type: 'string', description: 'Session id. Omit for the active tab.' },
    ],
    tier: 'autopilot',
    requires: 'terminal',
    run: (args) => {
      const target = sessionOr(argStr(args, 'terminal'))
      if (!target) return fail('No running terminal to interrupt.')
      interruptSession(target.id)
      return ok('Sent Ctrl+C.')
    },
  },

  {
    id: 'terminal:close',
    group: 'terminal',
    summary: 'Close a terminal tab, ending its shell.',
    params: [
      { name: 'terminal', type: 'string', description: 'Session id. Omit for the active tab.' },
    ],
    tier: 'autopilot',
    requires: 'terminal',
    run: async (args) => {
      const store = useTerminalStore.getState()
      const id = argStr(args, 'terminal') || store.activeId || ''
      if (!store.sessions.some((s) => s.id === id)) return fail('No such terminal tab.')
      await closeSession(id)
      return ok('Closed the terminal.')
    },
  },
]
