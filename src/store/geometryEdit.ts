import { create } from 'zustand'
import { useSpatialSettingsStore, computeInitialViewState } from './spatialSettings'
import type { ToolId, DraftGeometry, PathRef, VertexRef, Position, CurveMode } from '@/lib/draw/types'
import {
  emptyDraft,
  appendVertex,
  insertVertexAfter,
  moveVertex,
  removeVertex,
  removeLastVertex,
  dropEmptyPath,
  startPart,
  startHole,
  setPathVertices,
  translateDraft
} from '@/lib/draw/draft'

export type { ToolId, DraftGeometry, PathRef, VertexRef, CurveMode }

export type GeometryType =
  | 'POINT'
  | 'MULTIPOINT'
  | 'LINESTRING'
  | 'POLYGON'
  | 'MULTILINESTRING'
  | 'MULTIPOLYGON'

export type ColLib = 'sf' | 'geos'

export type SnapType = 'vertex' | 'edge' | 'midpoint' | 'intersection'

export interface SnapTarget {
  lng: number
  lat: number
  type: SnapType
}

/** One undo step: the draft plus the active path (so undoing a "start hole" restores focus). */
interface DraftSnapshot {
  draft: DraftGeometry
  activePath: PathRef
}

/**
 * One staged commit, recorded so Ctrl+Z can reach past the in-progress draft:
 * a geometry commit is undone by restoring the previous staged entry + shown
 * geometry; a row-add is undone by deleting the appended row in R.
 */
export interface CommitLogEntry {
  kind: 'geometry' | 'row-add'
  groupKey: string
  rowId: number
  /** The staged edit this commit replaced (geometry kind), if any. */
  prevPending: import('./spatial').PendingGeometryEdit | null
  /** What the feature showed before this commit. */
  prevGeometry: GeoJSON.Geometry | null
  accessPath: string
  envName: string
}

const MAX_UNDO = 100

export interface GeometryEditSession {
  accessPath: string
  envName: string
  columnName: string
  colLib: ColLib
  geometryType: GeometryType
  currentRow: number
  totalRows: number
  /**
   * The session appends a row per feature instead of filling the rows it was
   * opened on.
   *
   * "Add Point(s)" starts a session at row 0 of a dataset that already has
   * rows, and means *append* by every click — while a session opened from the
   * data viewer's "Redraw geometry…" means *fill this row, then the next one*.
   * Nothing else on the session tells those two apart, and Distance & Bearing
   * has to know which it is: filling row 1 of a layer the user asked to add
   * points to would overwrite a point that is already there.
   */
  appendRows?: boolean
  /** The in-progress drawing (parts → exterior ring + holes). */
  draft: DraftGeometry
  /** The path new vertices are appended to (draw tool). */
  activePath: PathRef
  /** Draft undo/redo history — cleared on commit/advance. */
  undoStack: DraftSnapshot[]
  redoStack: DraftSnapshot[]
  /** Geometry of this row before any drawing started — used to restore on Cancel */
  originalGeometry: GeoJSON.Geometry | null
  /** Committed geometries accumulated this session — displayed by DrawingLayer for non-map objects */
  committedFeatures: GeoJSON.Feature[]
}

export interface ViewState {
  longitude: number
  latitude: number
  zoom: number
}

export interface NamedSession {
  id: string
  name: string
  /** Whether the name was auto-generated (and can be overwritten by startEditing) */
  autoNamed: boolean
  /** Null when the slot exists but no feature has been selected yet */
  session: GeometryEditSession | null
  /** Spatial layer IDs that belong to this session */
  layerIds: string[]
  /** Independent map extent for this session */
  viewState: ViewState
}

/** Selector for the currently active GeometryEditSession (null if none). */
export const selectActiveSession = (s: GeometryEditState): GeometryEditSession | null =>
  s.namedSessions.find((ns) => ns.id === s.activeSessionId)?.session ?? null

/**
 * Selector for the active session's owned layer IDs.
 * Returns null when there is no active session (meaning: show all layers).
 */
export const selectActiveSessionLayerIds = (s: GeometryEditState): string[] | null =>
  s.namedSessions.find((ns) => ns.id === s.activeSessionId)?.layerIds ?? null

/**
 * Selector for the active session's view state.
 * Returns null when there is no active session (caller should use global default).
 */
export const selectActiveSessionViewState = (s: GeometryEditState): ViewState | null =>
  s.namedSessions.find((ns) => ns.id === s.activeSessionId)?.viewState ?? null

/**
 * Returns the layer IDs that would become orphaned (owned by no session)
 * if the given session were deleted. Used before calling deleteNamedSession
 * to know which layers to remove from the global spatial store.
 */
export function computeOrphanedLayerIds(namedSessions: NamedSession[], sessionId: string): string[] {
  const toDelete = namedSessions.find((ns) => ns.id === sessionId)
  if (!toDelete) return []
  const otherLayerIds = new Set(
    namedSessions.filter((ns) => ns.id !== sessionId).flatMap((ns) => ns.layerIds)
  )
  return toDelete.layerIds.filter((id) => !otherLayerIds.has(id))
}

/** Parameters accepted by startEditing — draft state is optional (defaults to empty). */
export type StartEditingParams = Omit<
  GeometryEditSession,
  'committedFeatures' | 'draft' | 'activePath' | 'undoStack' | 'redoStack'
> & {
  draft?: DraftGeometry
  activePath?: PathRef
}

interface GeometryEditState {
  namedSessions: NamedSession[]
  activeSessionId: string | null
  isEditMode: boolean
  /** The active drawing tool. Null when neither edit mode nor a session is active. */
  activeToolId: ToolId | null
  draggingVertex: VertexRef | null
  /** Vertex selected in the edit-vertices tool (Delete key target). */
  selectedVertex: VertexRef | null
  pendingRowAdd: boolean
  isSnapping: boolean
  snapTarget: SnapTarget | null
  pointAddedSignal: number
  /** Active segment-construction mode for the draw tool (straight / curve types). */
  curveType: CurveMode
  /** Perpendicular offset distance (meters) for the offset-trace tool. */
  offsetDistance: number
  /** When set, the AttributePopover collects values for this freshly drawn row. */
  attributePrompt: { accessPath: string; envName: string; row: number } | null
  /** "Ignore until next save": suppress the attribute popup until Save Edits runs. */
  attributePromptSnoozed: boolean
  /** Staged commits (geometry + row adds), newest last — Ctrl+Z reaches past the draft into these. */
  commitLog: CommitLogEntry[]

  logCommit: (entry: CommitLogEntry) => void
  /** Pop and return the newest commit entry (caller performs the revert side effects). */
  popCommit: () => CommitLogEntry | null
  /** Save/discard barrier: forget history for a saved group. */
  clearCommitsForGroup: (groupKey: string) => void

  startEditing: (params: StartEditingParams) => void
  stopEditing: () => void
  // Atomic: clears the active session AND resets the tool to 'select' in a
  // single store mutation. Used by Complete Drawing on db-backed layers so
  // subscribers see one transition rather than two, eliminating an
  // intermediate render where session is null but the tool is still
  // 'edit-vertices'.
  finishEditingAndExitToSelect: () => void
  requestRowAdd: () => void
  resolveRowAdd: (confirmed: boolean, newTotal: number) => void

  setCurveType: (v: CurveMode) => void
  setOffsetDistance: (d: number) => void
  setAttributePrompt: (p: { accessPath: string; envName: string; row: number } | null) => void
  setAttributePromptSnoozed: (v: boolean) => void

  // Draft mutations (undo snapshots handled internally)
  addVertex: (lng: number, lat: number) => void
  /** Append a vertex joined by a circular arc through `via`. */
  addArcVertex: (lng: number, lat: number, via: Position) => void
  /** Append several vertices in one undo step (trace / offset-trace). */
  appendVerticesToActivePath: (vertices: Position[]) => void
  /** Append several circular-arc segments in one undo step (Bézier arc spline). */
  appendArcSegmentsToActivePath: (arcs: { via: Position; end: Position }[]) => void
  undoVertex: () => void
  startNextPart: () => void
  startNewHole: () => void
  removeVertexAt: (ref: VertexRef) => void
  insertVertexAt: (ref: PathRef, afterIdx: number, lng: number, lat: number) => void
  /** Replace the active path's vertices wholesale (shape tools). */
  setActivePathVertices: (vertices: Position[]) => void
  moveVertexTo: (ref: VertexRef, lng: number, lat: number) => void
  translateDraftBy: (dLng: number, dLat: number) => void
  /** Push an undo snapshot before a drag gesture (drag moves don't snapshot per-move). */
  beginDraftEdit: () => void
  undoDraft: () => void
  redoDraft: () => void

  advanceRow: (nextOriginalGeometry: GeoJSON.Geometry | null) => void
  /**
   * Step back to the row the last commit was written into — the inverse of the
   * advance `commitAndAdvance` performs, for a tool that can undo one placed
   * feature at a time (Distance & Bearing on a POINT layer).
   *
   * A commit that ran out of dataset did not advance anything; it raised the
   * "add another?" prompt instead, so undoing that one cancels the prompt
   * rather than moving the row.
   */
  retreatRow: () => void
  recordCommitted: (feature: GeoJSON.Feature) => void
  setEditMode: (active: boolean) => void
  setActiveTool: (id: ToolId | null) => void
  setDraggingVertex: (v: VertexRef | null) => void
  setSelectedVertex: (v: VertexRef | null) => void
  setSnapping: (active: boolean) => void
  setSnapTarget: (t: SnapTarget | null) => void
  incrementTotalRows: () => void

  // Named session management
  createNamedSession: (name?: string) => void
  switchNamedSession: (id: string) => void
  deleteNamedSession: (id: string) => void
  renameNamedSession: (id: string, name: string) => void

  // Per-session layer ownership
  addLayerToActiveSession: (layerId: string) => void
  /** Removes layerId from the active session. Returns true if no session owns it anymore. */
  removeLayerFromActiveSession: (layerId: string) => boolean

  // Per-session view state
  setActiveSessionViewState: (vs: ViewState) => void
}

/** Update the GeometryEditSession inside the active NamedSession slot. */
function patchActiveSession(
  namedSessions: NamedSession[],
  activeSessionId: string | null,
  updater: (sess: GeometryEditSession) => GeometryEditSession
): NamedSession[] {
  if (!activeSessionId) return namedSessions
  return namedSessions.map((ns) => {
    if (ns.id !== activeSessionId || !ns.session) return ns
    return { ...ns, session: updater(ns.session) }
  })
}

/** Snapshot the current draft onto the undo stack (clearing redo). */
function pushUndo(sess: GeometryEditSession): GeometryEditSession {
  const snapshot: DraftSnapshot = { draft: sess.draft, activePath: sess.activePath }
  const undoStack = [...sess.undoStack, snapshot]
  if (undoStack.length > MAX_UNDO) undoStack.shift()
  return { ...sess, undoStack, redoStack: [] }
}

/** Apply a snapshotting draft mutation to the active session. */
function mutateDraft(
  s: GeometryEditState,
  fn: (sess: GeometryEditSession) => Pick<GeometryEditSession, 'draft' | 'activePath'>
): Partial<GeometryEditState> {
  return {
    namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => {
      const snapped = pushUndo(sess)
      const { draft, activePath } = fn(sess)
      return { ...snapped, draft, activePath }
    })
  }
}

function nextSessionName(namedSessions: NamedSession[]): string {
  const n = namedSessions.length + 1
  return `Session ${n}`
}

export const useGeometryEditStore = create<GeometryEditState>((set, get) => ({
  namedSessions: [],
  activeSessionId: null,
  isEditMode: false,
  activeToolId: null,
  draggingVertex: null,
  selectedVertex: null,
  pendingRowAdd: false,
  isSnapping: false,
  snapTarget: null,
  pointAddedSignal: 0,
  curveType: 'none',
  offsetDistance: 10,
  attributePrompt: null,
  attributePromptSnoozed: false,
  commitLog: [],

  setCurveType: (curveType) => set({ curveType }),
  setOffsetDistance: (offsetDistance) => set({ offsetDistance }),
  setAttributePrompt: (attributePrompt) => set({ attributePrompt }),
  setAttributePromptSnoozed: (attributePromptSnoozed) => set({ attributePromptSnoozed }),

  logCommit: (entry) =>
    set((s) => ({ commitLog: [...s.commitLog.slice(-(MAX_UNDO - 1)), entry] })),

  popCommit: () => {
    const s = get()
    const entry = s.commitLog[s.commitLog.length - 1] ?? null
    if (entry) set({ commitLog: s.commitLog.slice(0, -1) })
    return entry
  },

  clearCommitsForGroup: (groupKey) =>
    set((s) => ({ commitLog: s.commitLog.filter((e) => e.groupKey !== groupKey) })),

  startEditing: (params) => {
    const s = get()
    const autoName = `${params.accessPath.split('$')[0]} — ${params.geometryType}`
    const newSessionData: GeometryEditSession = {
      ...params,
      draft: params.draft ?? emptyDraft(),
      activePath: params.activePath ?? { part: 0, ring: 0 },
      undoStack: [],
      redoStack: [],
      committedFeatures: []
    }
    // Sessions started outside edit mode (data viewer "Draw Geometry") default
    // to the draw tool; edit-mode feature selection switches to edit-vertices
    // explicitly afterwards.
    const activeToolId: ToolId = s.isEditMode ? (s.activeToolId ?? 'select') : 'draw'

    if (s.activeSessionId) {
      // Populate (or replace) the active slot's session data
      set({
        activeToolId,
        selectedVertex: null,
        namedSessions: s.namedSessions.map((ns) => {
          if (ns.id !== s.activeSessionId) return ns
          return {
            ...ns,
            // Auto-update the name if it was auto-generated
            name: ns.autoNamed ? autoName : ns.name,
            autoNamed: ns.autoNamed ? false : ns.autoNamed,
            session: newSessionData
          }
        })
      })
    } else {
      // No active slot — create a new one
      const id = crypto.randomUUID()
      const { initialExtentMode, userExtent } = useSpatialSettingsStore.getState()
      const viewState = computeInitialViewState(initialExtentMode, userExtent)
      set({
        activeToolId,
        selectedVertex: null,
        namedSessions: [
          ...s.namedSessions,
          { id, name: autoName, autoNamed: false, session: newSessionData, layerIds: [], viewState }
        ],
        activeSessionId: id
      })
    }
  },

  stopEditing: () => {
    const s = get()
    if (!s.activeSessionId) return
    set({
      namedSessions: s.namedSessions.map((ns) =>
        ns.id === s.activeSessionId ? { ...ns, session: null } : ns
      ),
      pendingRowAdd: false,
      selectedVertex: null,
      // Outside edit mode the toolbar disappears with the session; in edit
      // mode fall back to feature selection.
      activeToolId: s.isEditMode ? 'select' : null
    })
  },

  finishEditingAndExitToSelect: () => {
    const s = get()
    if (!s.activeSessionId) {
      set({ activeToolId: 'select', selectedVertex: null })
      return
    }
    set({
      namedSessions: s.namedSessions.map((ns) =>
        ns.id === s.activeSessionId ? { ...ns, session: null } : ns
      ),
      pendingRowAdd: false,
      selectedVertex: null,
      activeToolId: 'select'
    })
  },

  // The current row's geometry is committed at this point — reset the draft
  // so stray clicks can't keep mutating it while the "add another?" prompt
  // is up (for POINT sessions every extra click used to pile invisible
  // vertices onto the already-committed draft).
  requestRowAdd: () =>
    set((s) => ({
      pendingRowAdd: true,
      selectedVertex: null,
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        draft: emptyDraft(),
        activePath: { part: 0, ring: 0 },
        undoStack: [],
        redoStack: []
      }))
    })),

  resolveRowAdd: (confirmed, newTotal) => {
    const s = get()
    if (!confirmed) {
      set({ pendingRowAdd: false, namedSessions: s.namedSessions.map((ns) =>
        ns.id === s.activeSessionId ? { ...ns, session: null } : ns
      ) })
      return
    }
    if (!s.activeSessionId) { set({ pendingRowAdd: false }); return }
    set({
      pendingRowAdd: false,
      namedSessions: s.namedSessions.map((ns) => {
        if (ns.id !== s.activeSessionId || !ns.session) return ns
        return {
          ...ns,
          session: {
            ...ns.session,
            currentRow: ns.session.totalRows,
            totalRows: newTotal,
            draft: emptyDraft(),
            activePath: { part: 0, ring: 0 },
            undoStack: [],
            redoStack: [],
            originalGeometry: null
          }
        }
      })
    })
  },

  addVertex: (lng, lat) =>
    set((s) =>
      mutateDraft(s, (sess) => ({
        draft: appendVertex(sess.draft, sess.activePath, [lng, lat] as Position),
        activePath: sess.activePath
      }))
    ),

  addArcVertex: (lng, lat, via) =>
    set((s) =>
      mutateDraft(s, (sess) => ({
        draft: appendVertex(sess.draft, sess.activePath, [lng, lat] as Position, {
          kind: 'arc',
          via
        }),
        activePath: sess.activePath
      }))
    ),

  appendVerticesToActivePath: (vertices) =>
    set((s) =>
      mutateDraft(s, (sess) => {
        let draft = sess.draft
        for (const v of vertices) draft = appendVertex(draft, sess.activePath, v)
        return { draft, activePath: sess.activePath }
      })
    ),

  appendArcSegmentsToActivePath: (arcs) =>
    set((s) =>
      mutateDraft(s, (sess) => {
        let draft = sess.draft
        for (const a of arcs) {
          draft = appendVertex(draft, sess.activePath, a.end, { kind: 'arc', via: a.via })
        }
        return { draft, activePath: sess.activePath }
      })
    ),

  undoVertex: () =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => {
        const removed = removeLastVertex(sess.draft, sess.activePath)
        if (removed === sess.draft) return sess // nothing to remove — skip snapshot
        // If the active path is now empty and is a hole/extra part, drop it
        const { draft, active } = dropEmptyPath(removed, sess.activePath)
        return { ...pushUndo(sess), draft, activePath: active }
      })
    })),

  startNextPart: () =>
    set((s) =>
      mutateDraft(s, (sess) => {
        const { draft, active } = startPart(sess.draft)
        return { draft, activePath: active }
      })
    ),

  startNewHole: () =>
    set((s) =>
      mutateDraft(s, (sess) => {
        const { draft, active } = startHole(sess.draft, sess.activePath.part)
        return { draft, activePath: active }
      })
    ),

  removeVertexAt: (ref) =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => {
        const removed = removeVertex(sess.draft, ref, sess.geometryType)
        if (removed === sess.draft) return sess
        return { ...pushUndo(sess), draft: removed }
      })
    })),

  insertVertexAt: (ref, afterIdx, lng, lat) =>
    set((s) =>
      mutateDraft(s, (sess) => ({
        draft: insertVertexAfter(sess.draft, ref, afterIdx, [lng, lat] as Position),
        activePath: sess.activePath
      }))
    ),

  setActivePathVertices: (vertices) =>
    set((s) =>
      mutateDraft(s, (sess) => ({
        draft: setPathVertices(sess.draft, sess.activePath, vertices),
        activePath: sess.activePath
      }))
    ),

  moveVertexTo: (ref, lng, lat) =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        draft: moveVertex(sess.draft, ref, [lng, lat] as Position)
      }))
    })),

  translateDraftBy: (dLng, dLat) =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        draft: translateDraft(sess.draft, dLng, dLat)
      }))
    })),

  beginDraftEdit: () =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, pushUndo)
    })),

  undoDraft: () =>
    set((s) => ({
      selectedVertex: null,
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => {
        const prev = sess.undoStack[sess.undoStack.length - 1]
        if (!prev) return sess
        return {
          ...sess,
          draft: prev.draft,
          activePath: prev.activePath,
          undoStack: sess.undoStack.slice(0, -1),
          redoStack: [...sess.redoStack, { draft: sess.draft, activePath: sess.activePath }]
        }
      })
    })),

  redoDraft: () =>
    set((s) => ({
      selectedVertex: null,
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => {
        const next = sess.redoStack[sess.redoStack.length - 1]
        if (!next) return sess
        return {
          ...sess,
          draft: next.draft,
          activePath: next.activePath,
          redoStack: sess.redoStack.slice(0, -1),
          undoStack: [...sess.undoStack, { draft: sess.draft, activePath: sess.activePath }]
        }
      })
    })),

  advanceRow: (nextOriginalGeometry) => {
    const s = get()
    if (!s.activeSessionId) return
    const ns = s.namedSessions.find((ns) => ns.id === s.activeSessionId)
    if (!ns?.session) return
    if (ns.session.currentRow + 1 >= ns.session.totalRows) {
      set({
        namedSessions: s.namedSessions.map((n) =>
          n.id === s.activeSessionId ? { ...n, session: null } : n
        )
      })
    } else {
      set({
        namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
          ...sess,
          currentRow: sess.currentRow + 1,
          draft: emptyDraft(),
          activePath: { part: 0, ring: 0 },
          undoStack: [],
          redoStack: [],
          originalGeometry: nextOriginalGeometry
        }))
      })
    }
  },

  retreatRow: () => {
    const s = get()
    if (!s.activeSessionId) return
    if (s.pendingRowAdd) { set({ pendingRowAdd: false }); return }
    set({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        currentRow: Math.max(0, sess.currentRow - 1),
        draft: emptyDraft(),
        activePath: { part: 0, ring: 0 },
        undoStack: [],
        redoStack: []
      }))
    })
  },

  recordCommitted: (feature) =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        committedFeatures: [...sess.committedFeatures, feature]
      }))
    })),

  setEditMode: (active) =>
    set((s) => ({
      isEditMode: active,
      activeToolId: active
        ? (s.activeToolId ?? 'select')
        : (selectActiveSession(s) ? s.activeToolId : null),
      selectedVertex: null,
      // Sessions persist across edit mode toggles — do NOT clear namedSessions or activeSessionId
    })),

  setActiveTool: (id) => set({ activeToolId: id, selectedVertex: null }),

  setDraggingVertex: (v) => set({ draggingVertex: v }),

  setSelectedVertex: (v) => set({ selectedVertex: v }),

  setSnapping: (active) => set({ isSnapping: active, snapTarget: active ? get().snapTarget : null }),

  setSnapTarget: (t) => set({ snapTarget: t }),

  incrementTotalRows: () =>
    set((s) => ({
      namedSessions: patchActiveSession(s.namedSessions, s.activeSessionId, (sess) => ({
        ...sess,
        totalRows: sess.totalRows + 1
      })),
      pointAddedSignal: s.pointAddedSignal + 1
    })),

  // --- Named session management ---

  createNamedSession: (name) => {
    const s = get()
    const id = crypto.randomUUID()
    const sessionName = name ?? nextSessionName(s.namedSessions)
    const { initialExtentMode, userExtent } = useSpatialSettingsStore.getState()
    const viewState = computeInitialViewState(initialExtentMode, userExtent)
    set({
      namedSessions: [...s.namedSessions, { id, name: sessionName, autoNamed: true, session: null, layerIds: [], viewState }],
      activeSessionId: id,
      activeToolId: 'select',
      selectedVertex: null
    })
  },

  switchNamedSession: (id) => {
    set({ activeSessionId: id, activeToolId: 'select', selectedVertex: null })
  },

  deleteNamedSession: (id) => {
    const s = get()
    const remaining = s.namedSessions.filter((ns) => ns.id !== id)
    let newActiveId = s.activeSessionId
    if (s.activeSessionId === id) {
      // Switch to the previous session (or null)
      const idx = s.namedSessions.findIndex((ns) => ns.id === id)
      const prev = remaining[idx - 1] ?? remaining[0] ?? null
      newActiveId = prev?.id ?? null
    }
    set({ namedSessions: remaining, activeSessionId: newActiveId })
  },

  renameNamedSession: (id, name) => {
    set((s) => ({
      namedSessions: s.namedSessions.map((ns) =>
        ns.id === id ? { ...ns, name, autoNamed: false } : ns
      )
    }))
  },

  addLayerToActiveSession: (layerId) => {
    const s = get()
    if (!s.activeSessionId) return
    set({
      namedSessions: s.namedSessions.map((ns) => {
        if (ns.id !== s.activeSessionId) return ns
        if (ns.layerIds.includes(layerId)) return ns
        return { ...ns, layerIds: [...ns.layerIds, layerId] }
      })
    })
  },

  removeLayerFromActiveSession: (layerId) => {
    const s = get()
    if (!s.activeSessionId) return false
    const updated = s.namedSessions.map((ns) => {
      if (ns.id !== s.activeSessionId) return ns
      return { ...ns, layerIds: ns.layerIds.filter((id) => id !== layerId) }
    })
    set({ namedSessions: updated })
    // Return true if no session owns this layer anymore
    return !updated.some((ns) => ns.layerIds.includes(layerId))
  },

  setActiveSessionViewState: (vs) => {
    const s = get()
    if (!s.activeSessionId) return
    set({
      namedSessions: s.namedSessions.map((ns) =>
        ns.id === s.activeSessionId ? { ...ns, viewState: vs } : ns
      )
    })
  }
}))
