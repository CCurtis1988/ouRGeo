import { create } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'

// Files dropped from scratch when it was left (docs/project-persistence-spec.md
// §2.5). Scratch keeps only its untitled notes, so a script the user had open
// there must not simply vanish: it is listed here, newest first, and opening
// it re-reads the file as it is now. A preference-side file — kept across
// sessions, never in a project.

export const MAX_RECENTLY_CLOSED = 20
export interface RecentlyClosed { path: string; closedAt: string }

const store = createJsonFileStore('recently-closed.json', 'Recently Closed')

/** `missing`: files found gone when last checked — shown greyed out. */
export const useRecentlyClosedStore = create<{ items: RecentlyClosed[]; missing: Record<string, boolean> }>(() => ({ items: [], missing: {} }))

/** Newest first, de-duplicated by path, capped. Pure for the test. */
export function mergeRecentlyClosed(existing: RecentlyClosed[], paths: string[], now = new Date().toISOString()): RecentlyClosed[] {
  const added = paths.map(path => ({ path, closedAt: now }))
  const seen = new Set<string>()
  return [...added, ...existing].filter(item => !seen.has(item.path) && seen.add(item.path)).slice(0, MAX_RECENTLY_CLOSED)
}

export function addRecentlyClosed(paths: string[]): void {
  if (!paths.length) return
  const items = mergeRecentlyClosed(useRecentlyClosedStore.getState().items, paths)
  useRecentlyClosedStore.setState({ items })
  void store.write({ items })
}

export function removeRecentlyClosed(path: string): void {
  const items = useRecentlyClosedStore.getState().items.filter(item => item.path !== path)
  useRecentlyClosedStore.setState({ items })
  void store.write({ items })
}

let loading: Promise<void> | null = null
export function loadRecentlyClosed(): Promise<void> {
  loading ??= store.read<{ items?: RecentlyClosed[] }>().then(data => {
    const items = Array.isArray(data.items) ? data.items.filter(item => item && typeof item.path === 'string').slice(0, MAX_RECENTLY_CLOSED) : []
    // Merge rather than replace: something closed before the file was read
    // must not be overwritten by the older list.
    useRecentlyClosedStore.setState(state => ({ items: mergeRecentlyClosed(items, state.items.map(item => item.path)) }))
  }, () => {})
  return loading
}
