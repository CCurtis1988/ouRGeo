// The two directions between a shell and the R session.
//
// A generic embedded terminal is worth having. One that knows where R is
// working is worth more, and it is the whole of what makes this ouRGeo's
// terminal rather than a terminal that happens to be inside ouRGeo: a relative
// path means the same thing at the shell prompt as it does at the R prompt,
// and when it stops meaning that, either side can fix it in one gesture.
//
// Rule 0 does not bind on the terminal — no R runs, so there is no R to echo.
// It binds hard on the half of this file that DOES touch R: `changeWorkingDir`
// echoes `setwd("…")` to the console exactly as the working-directory menu
// does, because it is the same function, called for the same reason.

import { changeWorkingDir } from '../working-dir'
import { useSessionStore } from '@/store/session'
import { useTerminalStore } from '@/store/terminal'
import { writeToSession } from './sessions'

/** Shell-quote a path for a POSIX shell: single quotes, with any embedded
 *  single quote closed, escaped and reopened. */
function posixQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/** …and for PowerShell/cmd, where single quotes double rather than escape. */
function windowsQuote(path: string): string {
  return `'${path.replace(/'/g, "''")}'`
}

/**
 * Quote a path for whichever shell family this platform runs.
 *
 * Quoted rather than interpolated because a directory chosen from a file
 * picker can contain a space, a quote or a `$` — and an unquoted `cd` with a
 * space in it does not fail loudly, it silently changes to the first word.
 */
export function quoteForShell(path: string): string {
  return navigator.platform.startsWith('Win') ? windowsQuote(path) : posixQuote(path)
}

/**
 * Type `cd <R's working directory>` into a shell.
 *
 * Typed rather than executed silently, and left for the user to press Enter
 * on? No — it is sent with the newline, because the menu item says "Go to",
 * not "Type". But it IS sent through the same write path as a keystroke, so it
 * lands in the shell's own history and scrollback: what happened is visible in
 * the terminal afterwards, which is the terminal's equivalent of echoing the R.
 */
export function goToRWorkingDir(sessionId: string): { ok: boolean; error?: string } {
  const dir = useSessionStore.getState().workingDir
  if (!dir) return { ok: false, error: 'R has not reported a working directory yet.' }
  writeToSession(sessionId, `cd ${quoteForShell(dir)}\r`)
  return { ok: true }
}

/**
 * Point R at the directory this shell is in.
 *
 * Only offered when the shell actually reported one — OSC 7 is best-effort and
 * plenty of shells never emit it, so the menu item is disabled rather than
 * present and failing. Guessing the directory would be worse than not offering:
 * `setwd` to the wrong place changes what every relative path in the session
 * means, silently.
 */
export async function setRWorkingDirFromShell(
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = useTerminalStore.getState().sessions.find((s) => s.id === sessionId)
  if (!session?.cwd) {
    return { ok: false, error: 'This shell has not reported a directory.' }
  }
  const res = await changeWorkingDir(session.cwd)
  return { ok: res.ok, error: res.error }
}

/** Whether the shell has told us where it is — what gates the menu item. */
export function shellReportsDirectory(sessionId: string): boolean {
  return !!useTerminalStore.getState().sessions.find((s) => s.id === sessionId)?.cwd
}
