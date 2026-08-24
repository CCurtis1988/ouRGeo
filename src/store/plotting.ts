import { create } from 'zustand'

/**
 * One captured plot. `dataUrl` is the fixed-size PNG R broadcast over the
 * WebSocket; `plotId` identifies the `recordPlot()` recording R kept, which
 * lets `/r/plot/export` re-render this exact plot at any size. It is null for
 * plots restored from disk — those predate the current R process.
 */
export interface PlotEntry {
  dataUrl: string
  plotId: string | null
}

/** What the popout window mirrors from this store. */
export interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

interface PlottingState {
  isOpen: boolean
  plots: PlotEntry[]
  currentIndex: number  // -1 when no plots

  toggleOpen(): void
  ensureOpen(): void
  addPlot(dataUrl: string, plotId?: string | null): void
  goBack(): void
  goForward(): void
  setIndex(index: number): void
}

export const usePlottingStore = create<PlottingState>((set) => ({
  isOpen: false,
  plots: [],
  currentIndex: -1,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  ensureOpen: () => set((s) => (s.isOpen ? {} : { isOpen: true })),

  addPlot: (dataUrl, plotId = null) =>
    set((s) => {
      const plots = [...s.plots, { dataUrl, plotId }]
      return { plots, currentIndex: plots.length - 1, isOpen: true }
    }),

  goBack: () => set((s) => ({ currentIndex: Math.max(0, s.currentIndex - 1) })),
  goForward: () =>
    set((s) => ({ currentIndex: Math.min(s.plots.length - 1, s.currentIndex + 1) })),
  setIndex: (index) =>
    set((s) => ({ currentIndex: Math.max(0, Math.min(s.plots.length - 1, index)) })),
}))

/** Build the snapshot pushed to the popout window. */
export function buildPlotPopoutState(): PlotPopoutState {
  const { plots, currentIndex } = usePlottingStore.getState()
  const entry = currentIndex >= 0 ? plots[currentIndex] : undefined
  return {
    dataUrl: entry?.dataUrl ?? null,
    plotId: entry?.plotId ?? null,
    index: currentIndex,
    total: plots.length,
  }
}

/**
 * Normalise persisted plots. Accepts the legacy `string[]` shape and always
 * clears `plotId` — restored plots come from a previous R process, so their
 * recordings are gone.
 */
export function normalizePersistedPlots(raw: unknown): PlotEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p): PlotEntry[] => {
    if (typeof p === 'string') return [{ dataUrl: p, plotId: null }]
    const dataUrl = (p as PlotEntry | undefined)?.dataUrl
    return typeof dataUrl === 'string' ? [{ dataUrl, plotId: null }] : []
  })
}
