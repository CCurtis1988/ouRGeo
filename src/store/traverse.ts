import { create } from 'zustand'
import type { Position } from '@/lib/draw/types'
import type { BearingMode, DistanceUnit, GridFrame, TraverseLeg } from '@/lib/draw/cogo'

/**
 * What the Distance & Bearing tool is in the middle of.
 *
 * A store rather than component state, because three things outside the entry
 * strip read it: the tool itself (not a React component — it is a plain object
 * owned by the ToolManager), `DrawingLayer` (which draws the pending leg), and
 * the AI action. Same argument as `store/ui.ts` for dialogs and
 * `store/panelDrag.ts` for the panel grip: correct as `useState` right up until
 * something outside the component needs to read it.
 *
 * The legs kept here are a RECORD of what was typed, not the geometry. The
 * geometry is vertices in the draft, exactly as if they had been clicked —
 * which is what makes undo, snapping, Save Edits and the R write work with no
 * knowledge of this tool at all.
 */

/** Where the numbers are measured. */
export type TraverseBasis = 'geodesic' | 'grid'

/** What R says about the target layer's coordinate system. */
export interface CrsInfo {
  /** What `sf::st_crs(x)$input` reported — "EPSG:32610", a name, or a proj string. */
  input: string | null
  epsg: number | null
  name: string | null
  isGeographic: boolean
  /** The CRS's own linear unit, e.g. "metre" or "US survey foot". */
  unitName: string | null
  unitToMetre: number | null
}

export interface TraverseEntry {
  distance: string
  bearing: string
}

interface TraverseState {
  /**
   * The vertices this traverse has placed, for a POINT session only.
   *
   * Everything else reads its trail out of the draft, where undo and the
   * ribbon can reach it — but a POINT session has no draft: each click commits
   * a row and the geometry goes to the map layer, so there is nowhere else for
   * "what did the last leg land on?" to live. `traversePath` in the tool picks
   * the right one, and is the only thing that should read this.
   */
  path: Position[]
  /** Entered this run, in order. Cleared when the tool is put down. */
  legs: TraverseLeg[]
  /** What is in the two fields right now — drives the ghost, not the draft. */
  entry: TraverseEntry
  unit: DistanceUnit
  mode: BearingMode
  basis: TraverseBasis
  crs: CrsInfo | null
  /** The projected frame at the current vertex, for previewing a grid leg
   *  without a round trip. Null in geodesic mode and until R answers. */
  frame: GridFrame | null
  /** A leg is being computed by R (grid basis only). */
  busy: boolean
  /** A refusal to show under the fields — a parse error or R's own. */
  error: string | null

  pushVertex: (p: Position) => void
  popVertex: () => void
  setEntry: (e: Partial<TraverseEntry>) => void
  addLeg: (leg: TraverseLeg) => void
  dropLastLeg: () => void
  setUnit: (u: DistanceUnit) => void
  setMode: (m: BearingMode) => void
  setBasis: (b: TraverseBasis) => void
  setCrs: (c: CrsInfo | null) => void
  setFrame: (f: GridFrame | null) => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  /** Put the tool down: forget the run, keep the preferences. */
  reset: () => void
}

const EMPTY_ENTRY: TraverseEntry = { distance: '', bearing: '' }

export const useTraverseStore = create<TraverseState>((set) => ({
  path: [],
  legs: [],
  entry: EMPTY_ENTRY,
  // Seeded from `spatial-settings.json` on load (see spatialSettings) — these
  // are the shipped defaults, not the user's.
  unit: 'm',
  mode: 'azimuth',
  basis: 'geodesic',
  crs: null,
  frame: null,
  busy: false,
  error: null,

  pushVertex: (p) => set((s) => ({ path: [...s.path, p], error: null })),
  popVertex: () => set((s) => ({ path: s.path.slice(0, -1) })),
  setEntry: (e) => set((s) => ({ entry: { ...s.entry, ...e }, error: null })),
  addLeg: (leg) => set((s) => ({ legs: [...s.legs, leg], entry: EMPTY_ENTRY, error: null })),
  dropLastLeg: () => set((s) => ({ legs: s.legs.slice(0, -1), error: null })),
  setUnit: (unit) => set({ unit }),
  setMode: (mode) => set({ mode }),
  setBasis: (basis) => set({ basis, error: null }),
  setCrs: (crs) => set({ crs }),
  setFrame: (frame) => set({ frame }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),

  reset: () => set({ path: [], legs: [], entry: EMPTY_ENTRY, frame: null, busy: false, error: null }),
}))
