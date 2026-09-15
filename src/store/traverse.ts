import { create } from 'zustand'
import type { Position } from '@/lib/draw/types'
import type { BearingMode, DistanceUnit, GridFrame, TraverseCourse } from '@/lib/draw/cogo'
import type { CurveElementId, DegreeDefinition, TurnDirection } from '@/lib/draw/curve-cogo'

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
 * The courses kept here are a RECORD of what was typed, not the geometry. The
 * geometry is vertices and arc segments in the draft, exactly as if they had
 * been clicked — which is what makes undo, snapping, Save Edits and the R write
 * work with no knowledge of this tool at all.
 *
 * Straight courses and curved ones live in ONE list, and that is the decision
 * the whole feature turns on. A deed call runs *"N45°30'E 150.00 feet; thence
 * along a curve to the right, R = 250, Δ = 45°30'; thence S12°E 82.00 feet"* —
 * one figure. Keep the curves somewhere else and the closure ratio is computed
 * on a path missing them, and the echoed `ourgeo_traverse()` reproduces a
 * different shape from the one on screen. Neither failure announces itself.
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

/**
 * Which kind of course the strip is taking. Two doors in the ribbon lead here
 * — Distance & Bearing and Curve — and they differ only in what this starts on.
 */
export type CourseType = 'line' | 'tangent-curve' | 'curve' | 'spiral' | 'scs'

/**
 * A curve being typed.
 *
 * Two element slots rather than named fields, because a plan quotes whichever
 * two it likes: radius and delta, radius and arc length, chord and tangent.
 * Each slot carries WHAT it is as well as its value, so the pair the page uses
 * is chosen rather than converted by hand before typing.
 *
 * `orientation` only applies to a non-tangent curve. A tangent curve continues
 * the previous course, so its direction is not a question.
 */
/**
 * A transition curve being typed.
 *
 * A plan sheet quotes a spiral by its length and the radius it ends on, and an
 * SCS unit by those plus the total deflection — so those are the fields, and
 * everything else the sheet prints is derived and shown back for checking.
 *
 * `direction` applies only to a lone spiral: an SCS has one of each by
 * construction. An exit spiral is the one that runs from a curve back out to a
 * tangent, which is a different geometry and not merely a different label.
 */
export interface SpiralEntry {
  direction: 'in' | 'out'
  lengthText: string
  /** Blank means the exit spiral matches the entry one, which is the norm. */
  lengthOutText: string
  radiusText: string
  /** SCS only: the total deflection, spirals and curve together. */
  deltaText: string
}

export interface CurveEntry {
  turn: TurnDirection
  aId: CurveElementId
  aText: string
  bId: CurveElementId
  bText: string
  orientKind: 'chord' | 'radial'
  orientText: string
  degreeDefinition: DegreeDefinition
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
  courses: TraverseCourse[]
  /** Which kind of course the next one is. */
  courseType: CourseType
  /** What is in the curve fields right now — drives the ghost, not the draft. */
  curve: CurveEntry
  /** The same, for a transition course. */
  spiral: SpiralEntry
  /** What is in the two fields right now — drives the ghost, not the draft. */
  entry: TraverseEntry
  unit: DistanceUnit
  mode: BearingMode
  basis: TraverseBasis
  crs: CrsInfo | null
  /**
   * The projected frame for previewing a grid leg without a round trip, and
   * the vertex it was measured at.
   *
   * The pair is deliberate. A frame is only true of one point, and the origin
   * moves — a typed leg, a click, an undo — so a frame kept on its own goes
   * stale silently and previews the next leg with the convergence of the last
   * one. `frameAt` is what lets the reader check before using it.
   */
  frame: GridFrame | null
  frameAt: Position | null
  /** A leg is being computed by R (grid basis only). */
  busy: boolean
  /** A refusal to show under the fields — a parse error or R's own. */
  error: string | null
  /** What the course being typed says, for the label beside it on the map:
   *  "150.00 m · N45°30'E", or "R 250.00 ft · Δ 45°30' · L 198.53". Null when
   *  there is nothing to draw. */
  legLabel: string | null

  pushVertex: (p: Position) => void
  popVertex: () => void
  setEntry: (e: Partial<TraverseEntry>) => void
  setCourseType: (t: CourseType) => void
  setCurve: (c: Partial<CurveEntry>) => void
  setSpiral: (c: Partial<SpiralEntry>) => void
  addCourse: (course: TraverseCourse) => void
  dropLastCourse: () => void
  setUnit: (u: DistanceUnit) => void
  setMode: (m: BearingMode) => void
  setBasis: (b: TraverseBasis) => void
  setCrs: (c: CrsInfo | null) => void
  setFrame: (f: GridFrame | null, at: Position | null) => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void
  setLegLabel: (legLabel: string | null) => void
  /** Put the tool down: forget the run, keep the preferences. */
  reset: () => void
}

const EMPTY_ENTRY: TraverseEntry = { distance: '', bearing: '' }

/**
 * Radius and delta first, because that is what the overwhelming majority of
 * plats quote. The element CHOICES persist across courses within a run — a plan
 * that books its curves by radius and arc length books all of them that way —
 * while the values clear, like the distance and bearing fields do.
 */
const EMPTY_SPIRAL: SpiralEntry = {
  direction: 'in', lengthText: '', lengthOutText: '', radiusText: '', deltaText: '',
}

const EMPTY_CURVE: CurveEntry = {
  turn: 'right',
  aId: 'radius', aText: '',
  bId: 'delta', bText: '',
  orientKind: 'chord', orientText: '',
  degreeDefinition: 'arc',
}

export const useTraverseStore = create<TraverseState>((set) => ({
  path: [],
  courses: [],
  courseType: 'line',
  curve: EMPTY_CURVE,
  spiral: EMPTY_SPIRAL,
  entry: EMPTY_ENTRY,
  // Seeded from `spatial-settings.json` on load (see spatialSettings) — these
  // are the shipped defaults, not the user's.
  unit: 'm',
  mode: 'azimuth',
  basis: 'geodesic',
  crs: null,
  frame: null,
  frameAt: null,
  busy: false,
  error: null,
  legLabel: null,

  pushVertex: (p) => set((s) => ({ path: [...s.path, p], error: null })),
  popVertex: () => set((s) => ({ path: s.path.slice(0, -1) })),
  setEntry: (e) => set((s) => ({ entry: { ...s.entry, ...e }, error: null })),
  setCourseType: (courseType) => set({ courseType, error: null }),
  setCurve: (c) => set((s) => ({ curve: { ...s.curve, ...c }, error: null })),
  setSpiral: (c) => set((s) => ({ spiral: { ...s.spiral, ...c }, error: null })),
  addCourse: (course) => set((s) => ({
    courses: [...s.courses, course],
    entry: EMPTY_ENTRY,
    // The element ids stay; only what was typed into them clears.
    curve: { ...s.curve, aText: '', bText: '', orientText: '' },
    spiral: { ...s.spiral, lengthText: '', lengthOutText: '', radiusText: '', deltaText: '' },
    error: null,
  })),
  dropLastCourse: () => set((s) => ({ courses: s.courses.slice(0, -1), error: null })),
  setUnit: (unit) => set({ unit }),
  setMode: (mode) => set({ mode }),
  setBasis: (basis) => set({ basis, error: null }),
  setCrs: (crs) => set({ crs }),
  setFrame: (frame, frameAt) => set({ frame, frameAt }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setLegLabel: (legLabel) => set({ legLabel }),

  reset: () => set((s) => ({
    path: [], courses: [], entry: EMPTY_ENTRY,
    curve: { ...s.curve, aText: '', bText: '', orientText: '' },
    spiral: { ...s.spiral, lengthText: '', lengthOutText: '', radiusText: '', deltaText: '' },
    frame: null, frameAt: null, busy: false, error: null, legLabel: null,
  })),
}))
