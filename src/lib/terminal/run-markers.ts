// Knowing when a command finished, and what it exited with.
//
// A pty does not tell you. It is a stream of bytes with no framing: there is
// no "command started", no "command ended", and no exit code — the shell
// prints a prompt and that is the only hint, which is unusable because a
// prompt is whatever the user configured it to be.
//
// So the command is followed by one that prints a marker of our own, and the
// run resolves when the marker arrives. The marker is an OSC sequence rather
// than a printable string for two reasons: the terminal does not draw it (so
// the user sees their command's output and nothing else), and xterm's own
// parser reassembles it — a sequence split across two reads is routine, and
// matching raw chunks would drop one every so often in a way that looks like a
// command hanging.
//
// Every shell spells "the last exit code" differently and gets it wrong
// silently: `$?` typed into fish prints nothing useful, `$status` typed into
// bash is empty. So the family is resolved from the profile, and an
// unrecognised shell is `unknown` — which loses the exit code rather than
// putting `$?` into the user's prompt as literal text.

import type { ShellFamily } from './shells'

/**
 * A private OSC number. 697 is unclaimed by the sequences terminals actually
 * implement, and unlike a printable sentinel it cannot collide with a
 * command's own output — `echo "OURGEO-DONE"` must not end a run.
 */
export const RUN_OSC = 697

/**
 * The escape sequence a shell should print when the command is done.
 *
 * **Never a raw ESC byte.** The marker is typed at the shell, and to a line
 * editor an ESC is not a character — it is the start of a meta sequence.
 * Writing one into bash's readline enters a key binding rather than inserting
 * text, and the command silently becomes something else entirely. Every form
 * below therefore uses notation the shell itself expands, so only printable
 * ASCII is ever typed: `\033`/`\007` for the printf shells, `[char]` for
 * PowerShell.
 */
function marker(family: ShellFamily): string | null {
  const body = `\\033]${RUN_OSC};ourgeo-done;`
  switch (family) {
    case 'posix':
      return `printf '${body}%s\\007' "$?"`
    case 'fish':
      // fish's printf expands the same escapes; only the status variable
      // differs, and `$?` in fish is not an error — it is a different variable
      // that silently prints nothing.
      return `printf '${body}%s\\007' "$status"`
    case 'powershell':
      // `$?` in PowerShell is a boolean, not a code, and a failed cmdlet with
      // no native exit code would otherwise report 0. So the two are combined.
      return 'Write-Host -NoNewline "$([char]27)]' + RUN_OSC + ';ourgeo-done;'
        + '$(if ($?) { if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE } } '
        + 'else { 1 })$([char]7)"'
    case 'cmd':
      // cmd has no escape expansion at all: emitting an ESC means putting a
      // raw one on the command line, which is the thing this whole comment
      // exists to avoid. cmd runs the command and reports no exit code — and
      // it is not the shell ouRGeo opens by default on Windows anyway.
      return null
    default:
      return null
  }
}

/** How the two commands are joined so the marker runs even when the first
 *  fails. `;` in POSIX and fish, `&` in cmd, `;` in PowerShell. */
function joiner(family: ShellFamily): string {
  return family === 'cmd' ? ' & ' : ' ; '
}

export interface RunLine {
  /** Exactly what to write to the pty, newline included. */
  text: string
  /** False when this shell has no reliable way to report an exit code, so the
   *  caller can say "finished" rather than claiming a status it invented. */
  reportsExitCode: boolean
}

/**
 * The line to type for `command`, with a completion marker where possible.
 *
 * An unknown shell still RUNS the command — losing the exit code is not a
 * reason to refuse to do the thing the user asked for. It just cannot be
 * waited on, so the caller falls back to a quiet period and says so.
 */
export function buildRunLine(command: string, family: ShellFamily): RunLine {
  const m = marker(family)
  // Carriage return, not newline: a pty is a terminal, and Enter is CR. A
  // bare \n works in most shells and silently does nothing in some line
  // editors, which is the worst of the two failure modes.
  if (!m) return { text: `${command}\r`, reportsExitCode: false }
  return { text: `${command}${joiner(family)}${m}\r`, reportsExitCode: true }
}

/**
 * Read an exit code out of the marker's payload.
 *
 * The payload is whatever the shell substituted, which on a shell that did not
 * understand the syntax is the literal text of the expression. Anything that
 * is not a plain integer is therefore reported as "no code" rather than
 * coerced — `NaN` presented as an exit status would be worse than silence.
 */
export function parseRunMarker(payload: string): number | null {
  const m = /^ourgeo-done;(-?\d+)$/.exec(payload.trim())
  if (!m) return null
  return Number(m[1])
}

/** Whether an OSC payload is one of ours at all. */
export function isRunMarker(payload: string): boolean {
  return payload.trimStart().startsWith('ourgeo-done;')
}

/**
 * Everything the terminal drew, minus the parts the user did not type.
 *
 * The echoed command line includes the marker we appended, and showing the
 * user `git status ; printf '\033]697…'` when they asked for `git status`
 * would be reporting our own plumbing back as if it were theirs.
 */
export function stripRunEcho(output: string, command: string, family: ShellFamily): string {
  const m = marker(family)
  if (!m) return output
  const echoed = `${command}${joiner(family)}${m}`
  const at = output.indexOf(echoed)
  if (at < 0) return output
  return output.slice(at + echoed.length).replace(/^\r?\n/, '')
}
