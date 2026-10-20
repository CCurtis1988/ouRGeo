// Shapes shared by the main-process draft store (electron/main/project-drafts.ts)
// and the renderer that fills it. Pure, so both tsconfig projects compile it
// and the Vitest suite covers the rules that decide anything.

/** The large or frequently-changing parts of a draft, each its own file so a
 *  keystroke never rewrites the map's GeoJSON or the plot history. */
export const DRAFT_SLICES = ['ui', 'layers', 'plots', 'view'] as const
export type DraftSlice = typeof DRAFT_SLICES[number]
export const isDraftSlice = (value: string): value is DraftSlice => (DRAFT_SLICES as readonly string[]).includes(value)

export interface DraftMeta {
  version: 1
  key: string
  /** The bundle's path; null for scratch. */
  path: string | null
  name: string
  projectId: string | null
  /** When the renderer last wrote any part of it. */
  updatedAt: string | null
  /** True while the draft holds work the bundle does not — what the project
   *  menu's "kept on this computer" line reports. */
  changed: boolean
  /** sha256 of the bundle this draft started from. A different file
   *  signature on open or before Save means it changed elsewhere (§1.8). */
  baseSignature: string | null
  baseSavedAt: string | null
  /** When the R environment was last snapshotted, and how long it took. */
  checkpointAt: string | null
  checkpointMs: number | null
}

export interface DraftWrite {
  meta?: Partial<Pick<DraftMeta, 'name' | 'projectId' | 'changed'>>
  /** JSON text per slice; null deletes it. */
  slices?: Partial<Record<DraftSlice, string | null>>
  /** JSON text per document id; null deletes it. */
  docs?: Record<string, string | null>
  /** When set, document files not listed are deleted (closed tabs). */
  keepDocs?: string[]
}

export interface DraftRead {
  meta: DraftMeta
  slices: Partial<Record<DraftSlice, string>>
  docs: Record<string, string>
  /** Parts that exist but could not be read: a slice name, or `doc:<id>`. */
  unreadable: string[]
  envPath: string | null
  hasBase: boolean
}

export interface DraftListing {
  key: string
  path: string
  name: string
  updatedAt: string | null
  changed: boolean
  bytes: number
  fileExists: boolean
  /** Held by this window: listed, but not deletable. */
  open: boolean
}

export interface LaunchState {
  /** False when the renderer reloaded inside a running app. */
  firstLoad: boolean
  /** The previous run never reached its clean-exit marker. */
  crashed: boolean
  /** The named project open at quit, to reopen; null for scratch. */
  project: string | null
}

export interface LockRecord { pid: number; start: string | null; acquiredAt: string }

/** A lock is stale when its process is gone, or when the pid now belongs to a
 *  different process than the one that wrote it (a recycled pid). */
export function lockIsStale(lock: LockRecord, now: { alive: boolean; start: string | null }): boolean {
  if (lock.pid < 0 || !now.alive) return true
  return lock.start !== null && now.start !== null && lock.start !== now.start
}

/** A draft with no recorded change time counts as old: nothing says otherwise. */
export function olderThan(updatedAt: string | null, days: number, now: number): boolean {
  if (!Number.isFinite(days) || days <= 0) return false
  const at = updatedAt ? Date.parse(updatedAt) : NaN
  return !Number.isFinite(at) || now - at > days * 86_400_000
}

/** What the health check reports about stored drafts (§4.3): information,
 *  never a failure. Only drafts holding changes are "unsaved changes"; the
 *  open project's draft is never offered for deletion. */
export interface DraftHealth { count: number; bytes: number; orphans: DraftListing[]; old: DraftListing[] }
export function summariseDrafts(drafts: DraftListing[], now: number, oldDays = 90): DraftHealth {
  return {
    count: drafts.length,
    bytes: drafts.reduce((sum, d) => sum + d.bytes, 0),
    orphans: drafts.filter(d => !d.fileExists && !d.open),
    old: drafts.filter(d => d.fileExists && !d.open && olderThan(d.updatedAt, oldDays, now)),
  }
}
