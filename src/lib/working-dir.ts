// R's working directory: reading it, moving it, and fitting it on one line.
//
// The directory decides what every relative path in the session means — where
// `read_csv("data.csv")` looks, where `ggsave()` writes, what knitr resolves
// against — so it belongs on screen rather than behind a `getwd()` the user has
// to remember to run. The console header is where it goes, because that is
// where relative paths are typed.
//
// R remains the source of truth. The store is updated from the server's own
// `getwd()`, never from what the picker was told to do, so a `setwd()` typed
// into the console and one chosen from the dialog land in exactly the same
// place.

import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { createJsonFileStore } from '@/lib/persistence'
import { rStr } from '@/lib/r-identifier'

/** Directories the user has worked in, most recent first. */
const RECENTS_MAX = 8
const store = createJsonFileStore('working-dirs.json', 'Working Directories')

export async function loadRecentDirs(): Promise<string[]> {
  const data = await store.read<{ recent?: unknown }>()
  const list = Array.isArray(data.recent) ? data.recent : []
  return list.filter((p): p is string => typeof p === 'string' && p.length > 0).slice(0, RECENTS_MAX)
}

async function rememberDir(path: string): Promise<string[]> {
  const previous = await loadRecentDirs()
  const next = [path, ...previous.filter((p) => p !== path)].slice(0, RECENTS_MAX)
  await store.merge({ recent: next })
  return next
}

/** Pull the current directory from R into the store. */
export async function refreshWorkingDir(): Promise<void> {
  try {
    const res = await rClient.getWorkingDir()
    if (res.success && res.path) {
      useSessionStore.getState().setWorkingDir(res.path, res.home ?? null)
    }
  } catch {
    // A directory we cannot read is not worth an error in the console; the
    // header simply shows nothing until the next broadcast.
  }
}

export interface ChangeResult {
  ok: boolean
  path?: string
  error?: string
  recent?: string[]
}

/**
 * Move R to `path`, echoing the equivalent call to the console.
 *
 * The echo is not decoration: ouRGeo's contract is that every GUI operation
 * shows the R that would do the same thing, so a session's console remains a
 * script of what happened. A failure is returned rather than thrown so the
 * caller can show it next to the control the user just used.
 */
export async function changeWorkingDir(path: string): Promise<ChangeResult> {
  const session = useSessionStore.getState()
  session.addConsoleEntry('input', `setwd(${rStr(path)})`)
  try {
    const res = await rClient.setWorkingDir(path)
    if (!res.success || !res.path) {
      const error = res.error ?? 'Could not change the working directory.'
      session.addConsoleEntry('error', error)
      return { ok: false, error }
    }
    session.setWorkingDir(res.path)
    return { ok: true, path: res.path, recent: await rememberDir(res.path) }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    session.addConsoleEntry('error', error)
    return { ok: false, error }
  }
}

// ── Display ─────────────────────────────────────────────────────────────────

/** Split a path into its segments, keeping the leading separator if any. */
function segments(path: string): { root: string; parts: string[]; sep: string } {
  const sep = path.includes('\\') && !path.startsWith('/') ? '\\' : '/'
  const drive = /^[A-Za-z]:[\\/]/.exec(path)
  if (drive) {
    return { root: drive[0], parts: path.slice(drive[0].length).split(/[\\/]/).filter(Boolean), sep }
  }
  const root = path.startsWith(sep) ? sep : ''
  return { root, parts: path.slice(root.length).split(sep).filter(Boolean), sep }
}

/**
 * Shorten `path` until `fits` accepts it, dropping whole segments from the
 * middle.
 *
 * Segments rather than characters, because a path elided mid-word
 * (`/home/roos…/ourgeo`) reads as a different directory, while
 * `/home/…/Projects/ourgeo` is unambiguously the same one with the middle left
 * out. The tail is what identifies a working directory, so it goes last; the
 * root goes first, because "which disk" is the other thing worth knowing.
 */
export function elidePath(path: string, fits: (candidate: string) => boolean): string {
  if (!path || fits(path)) return path
  const { root, parts, sep } = segments(path)
  if (parts.length <= 1) return path

  // Drop from the middle outwards: keep the first segment and as much of the
  // tail as will fit, replacing what went with a single ellipsis.
  for (let keepTail = parts.length - 1; keepTail >= 1; keepTail--) {
    const head = parts.length - keepTail > 1 ? [parts[0], '…'] : [parts[0]]
    if (head.length === 1) continue // nothing elided at this size
    const candidate = root + [...head, ...parts.slice(-keepTail)].join(sep)
    if (fits(candidate)) return candidate
  }
  // Even `first/…/last` is too wide: fall back to the tail alone.
  for (let keepTail = parts.length - 1; keepTail >= 1; keepTail--) {
    const candidate = `…${sep}${parts.slice(-keepTail).join(sep)}`
    if (fits(candidate)) return candidate
  }
  return `…${sep}${parts[parts.length - 1]}`
}
