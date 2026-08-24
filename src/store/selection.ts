import { create } from 'zustand'
import { applyPicksToSelections, selKey, type LayerPick } from '@/lib/selection-apply'

export type SelectMode = 'point' | 'lasso'

export interface PendingCandidate {
  accessPath: string
  envName: string
  layerId: string
  featureIndex: number
  label: string
}

export interface PendingSelection {
  candidates: PendingCandidate[]
  checked: boolean[] // parallel to candidates
  merge: boolean // shift held at capture time
  anchor: { x: number; y: number } // map-container-relative px
}

interface SelectionState {
  selections: Record<string, number[]> // datasetKey → sorted 0-based row indices
  selectMode: SelectMode
  isSelectActive: boolean
  pending: PendingSelection | null

  setSelection: (accessPath: string, envName: string, indices: number[]) => void
  clearSelection: (accessPath: string, envName: string) => void
  clearAll: () => void
  getSelection: (accessPath: string, envName: string) => number[]
  hasSelection: (accessPath: string, envName: string) => boolean

  setSelectMode: (m: SelectMode) => void
  toggleSelectTool: () => void
  setSelectToolActive: (v: boolean) => void
  setPending: (p: PendingSelection | null) => void
  setPendingChecked: (i: number, v: boolean) => void
  setPendingCheckedMany: (idxs: number[], v: boolean) => void
  applyPicks: (
    picks: LayerPick[],
    merge: boolean,
    visibleLayers: { accessPath: string; envName: string }[],
  ) => void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selections: {},
  selectMode: 'point',
  isSelectActive: false,
  pending: null,

  setSelection: (accessPath, envName, indices) =>
    set((s) => ({
      selections: {
        ...s.selections,
        [selKey(accessPath, envName)]: [...indices].sort((a, b) => a - b),
      },
    })),

  clearSelection: (accessPath, envName) =>
    set((s) => {
      const next = { ...s.selections }
      delete next[selKey(accessPath, envName)]
      return { selections: next }
    }),

  clearAll: () => set({ selections: {} }),

  getSelection: (accessPath, envName) =>
    get().selections[selKey(accessPath, envName)] ?? [],

  hasSelection: (accessPath, envName) =>
    (get().selections[selKey(accessPath, envName)]?.length ?? 0) > 0,

  setSelectMode: (m) => set({ selectMode: m, pending: null }),

  toggleSelectTool: () =>
    set((s) => ({
      isSelectActive: !s.isSelectActive,
      pending: s.isSelectActive ? null : s.pending,
    })),

  setSelectToolActive: (v) =>
    set((s) => ({ isSelectActive: v, pending: v ? s.pending : null })),

  setPending: (p) => set({ pending: p }),

  setPendingChecked: (i, v) =>
    set((s) => {
      if (!s.pending) return s
      const checked = [...s.pending.checked]
      checked[i] = v
      return { pending: { ...s.pending, checked } }
    }),

  setPendingCheckedMany: (idxs, v) =>
    set((s) => {
      if (!s.pending) return s
      const checked = [...s.pending.checked]
      for (const i of idxs) checked[i] = v
      return { pending: { ...s.pending, checked } }
    }),

  applyPicks: (picks, merge, visibleLayers) =>
    set((s) => ({
      selections: applyPicksToSelections(s.selections, picks, merge, visibleLayers),
      pending: null,
    })),
}))
