import { create } from 'zustand'

// Per-chunk execution state, keyed tabId → chunkId.
//
// Deliberately a SEPARATE store, not fields on TabState. Outputs contain base64
// PNGs; if they lived on the tab they would be serialized by buildSessionData()
// into session.json *and* into every .ourgeoproj bundle, quietly ballooning both.
// Keeping them here makes that impossible.

export interface ChunkPlot {
  dataUrl: string
  /** Id in R's plot history, so the plot can be re-exported at another size. */
  plotId: string | null
}

export type ChunkStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface ChunkOutput {
  status: ChunkStatus
  stdout: string
  error: string | null
  plots: ChunkPlot[]
  widgets: string[]
  /** Code changed since this output was produced. */
  stale: boolean
  /** eval=FALSE — reported rather than silently doing nothing. */
  skipped: boolean
  durationMs: number | null
  collapsed: boolean
}

const EMPTY: ChunkOutput = {
  status: 'idle', stdout: '', error: null, plots: [], widgets: [],
  stale: false, skipped: false, durationMs: null, collapsed: false,
}

interface ChunkStore {
  /** tabId → chunkId → output */
  outputs: Record<string, Record<string, ChunkOutput>>

  get(tabId: string, chunkId: string): ChunkOutput | undefined
  set(tabId: string, chunkId: string, patch: Partial<ChunkOutput>): void
  clearChunk(tabId: string, chunkId: string): void
  /** Mark outputs stale for chunks whose code changed. */
  markStale(tabId: string, chunkIds: string[]): void
  /** Drop outputs for chunks that no longer exist, so PNGs don't accumulate. */
  prune(tabId: string, liveIds: Set<string>): void
  /** Drop everything for a closed tab. */
  clearTab(tabId: string): void
  toggleCollapsed(tabId: string, chunkId: string): void
}

export const useChunkStore = create<ChunkStore>((set, get) => ({
  outputs: {},

  get: (tabId, chunkId) => get().outputs[tabId]?.[chunkId],

  set: (tabId, chunkId, patch) =>
    set((s) => {
      const tab = s.outputs[tabId] ?? {}
      const cur = tab[chunkId] ?? EMPTY
      return { outputs: { ...s.outputs, [tabId]: { ...tab, [chunkId]: { ...cur, ...patch } } } }
    }),

  clearChunk: (tabId, chunkId) =>
    set((s) => {
      const tab = { ...(s.outputs[tabId] ?? {}) }
      delete tab[chunkId]
      return { outputs: { ...s.outputs, [tabId]: tab } }
    }),

  markStale: (tabId, chunkIds) =>
    set((s) => {
      const tab = s.outputs[tabId]
      if (!tab) return s
      let changed = false
      const next = { ...tab }
      for (const id of chunkIds) {
        // Only outputs that actually ran can go stale.
        if (next[id] && !next[id].stale && next[id].status !== 'idle') {
          next[id] = { ...next[id], stale: true }
          changed = true
        }
      }
      return changed ? { outputs: { ...s.outputs, [tabId]: next } } : s
    }),

  prune: (tabId, liveIds) =>
    set((s) => {
      const tab = s.outputs[tabId]
      if (!tab) return s
      const next: Record<string, ChunkOutput> = {}
      let dropped = false
      for (const [id, out] of Object.entries(tab)) {
        if (liveIds.has(id)) next[id] = out
        else dropped = true
      }
      return dropped ? { outputs: { ...s.outputs, [tabId]: next } } : s
    }),

  clearTab: (tabId) =>
    set((s) => {
      if (!s.outputs[tabId]) return s
      const next = { ...s.outputs }
      delete next[tabId]
      return { outputs: next }
    }),

  toggleCollapsed: (tabId, chunkId) =>
    set((s) => {
      const tab = s.outputs[tabId]
      const cur = tab?.[chunkId]
      if (!cur) return s
      return {
        outputs: {
          ...s.outputs,
          [tabId]: { ...tab, [chunkId]: { ...cur, collapsed: !cur.collapsed } },
        },
      }
    }),
}))

export const EMPTY_CHUNK_OUTPUT = EMPTY
