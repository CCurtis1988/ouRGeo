import type { DrawTool, DrawPointerEvent, DrawToolContext, DrawContextMenuItem, Position } from '../types'
import {
  useGeometryEditStore, selectActiveSession, type GeometryEditSession,
} from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useTraverseStore } from '@/store/traverse'
import { canComplete, getPath } from '../draft'
import { destination, incomingAzimuth, reduceGridLeg, courseOutAzimuth, type TraverseCourse } from '../cogo'
import { pathEndAzimuth } from '../curve-cogo'
import { buildTraverseRCode } from '../traverse-rcode'
import { useSessionStore } from '@/store/session'

/**
 * Distance & Bearing — the tool the website has always described.
 *
 * > *"Don't eyeball it — type it. Enter an absolute coordinate, or place the
 * > next vertex relative to the last one by distance and bearing."*
 *
 * One click sets where the measuring starts; every vertex after it comes from
 * the entry strip under the map (`TraverseBar.tsx`), which is where the numbers
 * are typed and where the coordinate system is named. A leg is an ordinary
 * vertex append, so undo, snapping, Save Edits and the R write know nothing
 * about this tool.
 *
 * **What the first click places depends on whether the geometry is a chain.**
 *
 * On a line or a polygon it is the first vertex, because the figure starts
 * where the measuring starts. On a POINT layer it is a *reference point*: a
 * temporary mark to measure from, and nothing in the dataset. That is not a
 * refinement, it is what a point traverse IS — the monument a set of points is
 * shot from is not usually one of them, and every row of a point layer is its
 * own feature, so a click that quietly appended one would be answering a
 * question about *where to measure from* by writing data.
 *
 * A click while a point traverse is running re-places that reference, which is
 * how a traverse resumes from a different mark. It flushes the run first
 * (`echoTraverse`), because the R that reproduces a traverse describes ONE
 * chain from ONE origin, and the chain has just been broken.
 *
 * Both kinds take the click's `lngLat`, which the interaction layer has already
 * snapped when snapping is on — so a reference point lands on the monument, not
 * near it, under exactly the setting the ribbon's magnet button shows.
 *
 * What it deliberately does not draw is a rubber band to the cursor. The ghost
 * belongs to the numbers in the strip: what is on the map is what has been
 * typed, and a second dashed line following the mouse would say the next
 * vertex is coming from there.
 */

/**
 * The vertices this traverse has placed, wherever they actually live.
 *
 * A line or polygon session keeps them in the draft, where the ribbon's undo
 * can reach them — read them from there, or an Undo Vertex would leave the
 * strip measuring from a vertex that no longer exists. A POINT session has no
 * draft that outlives a leg (each leg is committed and the draft cleared), so
 * its trail is the one the store keeps: the reference point first, then every
 * point the run has placed.
 */
export function traversePath(session: GeometryEditSession, storePath: Position[]): Position[] {
  if (session.geometryType === 'POINT') return storePath
  return getPath(session.draft, session.activePath)?.vertices ?? []
}

/** Where the next leg starts, or null when the traverse has not begun. */
export function traverseOrigin(session: GeometryEditSession, storePath: Position[]): Position | null {
  const path = traversePath(session, storePath)
  return path.length > 0 ? path[path.length - 1] : null
}

/**
 * The azimuth a relative bearing turns from — the one the last course ARRIVED
 * on, which is not the one it left on. See `cogo.ts`.
 *
 * A chain reads it off the draft's last SEGMENT rather than its last two
 * vertices, because after a curve those two vertices are a chord and the
 * tangent is somewhere else entirely — half the sweep of the final arc piece
 * away. `pathEndAzimuth` recovers it from the arc's own three points, so it
 * survives an undo and a feature reopened from the layer, neither of which a
 * remembered value would.
 */
export function traverseIncoming(
  session: GeometryEditSession, storePath: Position[], courses: TraverseCourse[] = []
): number | null {
  if (session.geometryType !== 'POINT') {
    const path = getPath(session.draft, session.activePath)
    return path ? pathEndAzimuth(path) : null
  }
  // A point traverse keeps only where each course LANDED, so after a curve the
  // trail's last two points are a chord and the tangent is not in the geometry
  // at all. The course record is the only place it survives.
  const last = courses[courses.length - 1]
  if (last) return courseOutAzimuth(last)
  return incomingAzimuth(storePath)
}

/**
 * Whether the click that starts a traverse places a reference point rather
 * than a vertex — true exactly when the geometry is not a chain.
 *
 * MULTIPOINT is deliberately on the chain side: its parts live in one draft
 * and are committed together, so the first one is a vertex like any other.
 */
export function usesReferencePoint(session: GeometryEditSession): boolean {
  return session.geometryType === 'POINT'
}

/**
 * Whether a placed point becomes a new row at the end of the dataset rather
 * than the geometry of the row the session is on.
 *
 * "Add Point(s)" opens a session that means append; the data viewer's "Redraw
 * geometry…" opens one that means fill this row and move to the next. Same
 * tool, and the only thing that says which is the session it is running in.
 */
export function appendsRows(session: GeometryEditSession): boolean {
  return session.appendRows === true
}

/**
 * Start measuring from here: echo whatever run is finished, then make this the
 * reference point of a new one.
 *
 * POINT sessions only — a chain's origin is its first vertex and lives in the
 * draft.
 */
export function startTraverseRun(p: Position): void {
  // `echoTraverse` only resets when it had something to say, so the reset is
  // explicit: re-placing the reference before typing anything must still start
  // a new run rather than extending the trail from the old mark.
  echoTraverse()
  useTraverseStore.getState().reset()
  useTraverseStore.getState().pushVertex(p)
}

/**
 * Take back the last leg, wherever it went.
 *
 * A chain's leg is a draft vertex, so `undoVertex` is the whole story. A point
 * traverse's leg is a *committed row*, which is two facts to undo and not one:
 * the staged geometry (`ctx.undoLast`, the same Ctrl+Z path the ribbon uses),
 * and the row the session moved on to afterwards. Undoing only the first would
 * leave the next leg writing into the row after the one it just emptied.
 */
export async function undoTraverseLeg(ctx: Pick<DrawToolContext, 'undoLast'>): Promise<void> {
  const store = useGeometryEditStore.getState()
  const session = selectActiveSession(store)
  if (!session) return
  const traverse = useTraverseStore.getState()

  if (usesReferencePoint(session)) {
    // Nothing has been placed yet — the trail is just the reference, and there
    // is no leg to take back.
    if (traverse.path.length > 1) {
      await ctx.undoLast()
      // An appended row is deleted by the undo itself, along with the session
      // it was drawn in; only a filled row leaves the session standing on the
      // row after it.
      if (!appendsRows(session)) useGeometryEditStore.getState().retreatRow()
      traverse.popVertex()
      traverse.dropLastCourse()
    }
    return
  }

  store.undoVertex()
  traverse.dropLastCourse()
}

/**
 * Where a leg lands, given the basis it was entered in.
 *
 * Geodesic is exact and immediate. Grid is an ESTIMATE here — the projected
 * arithmetic that produces the committed vertex is R's (`/spatial/traverse`),
 * and this reduction using the convergence and scale factor R reported for the
 * current vertex is what lets the ghost follow the keystrokes without a round
 * trip per character. Over a leg the two agree to millimetres; the vertex that
 * is kept is always R's.
 */
export function previewLeg(
  origin: Position, distanceM: number, azimuth: number,
  basis: 'geodesic' | 'grid', frame: { x: number; y: number; convergence: number; scale: number } | null,
): Position {
  if (basis === 'grid' && frame) {
    const r = reduceGridLeg(distanceM, azimuth, frame)
    return destination(origin, r.distanceM, r.azimuth)
  }
  return destination(origin, distanceM, azimuth)
}

/**
 * The runnable R for the traverse just entered, as a console entry.
 *
 * Shared by the entry strip (which calls it on Finish and Close) and by the
 * tool being put down, and it clears the legs — so whichever happens first
 * echoes, and the other finds nothing to say.
 */
export function echoTraverse(): void {
  const st = useTraverseStore.getState()
  const session = selectActiveSession(useGeometryEditStore.getState())
  const path = session ? traversePath(session, st.path) : st.path
  if (path.length === 0 || st.courses.length === 0) return
  const code = buildTraverseRCode(path[0], st.courses, st.basis, st.crs)
  if (code) useSessionStore.getState().addConsoleEntry('info', code)
  st.reset()
}

export const distanceBearingTool: DrawTool = {
  id: 'distance-bearing',

  cursor: () => 'crosshair',

  onActivate() {
    // Picking the tool up mid-drawing continues from where the pencil was:
    // `traversePath` reads the draft, so a line already three vertices long is
    // simply a traverse three vertices in.
    useTraverseStore.getState().reset()
    useDrawPreviewStore.getState().setCursor(null)
  },

  onDeactivate() {
    // Putting the tool down ends the traverse, so this is the last moment to
    // say in R what was measured. A POINT traverse has no Finish button — each
    // leg is its own committed row — so without this the only traverses that
    // ever echoed would be the ones on lines and polygons.
    echoTraverse()
    useTraverseStore.getState().reset()
    const preview = useDrawPreviewStore.getState()
    preview.setCursor(null)
    preview.setGhost(null)
  },

  onClick(e: DrawPointerEvent) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const [lng, lat] = e.lngLat

    if (usesReferencePoint(session)) {
      // A reference point, not a feature: this says where to measure FROM.
      // `e.lngLat` is snapped when snapping is on, so it lands on the monument
      // rather than beside it.
      startTraverseRun([lng, lat])
      useDrawPreviewStore.getState().setGhost(null)
      return
    }
    store.addVertex(lng, lat)
    useDrawPreviewStore.getState().setGhost(null)
  },

  onDblClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session || session.geometryType === 'POINT') return
    // A double-click leaves the second of its two clicks on the geometry; the
    // draw tool drops it the same way.
    const verts = getPath(session.draft, session.activePath)?.vertices ?? []
    if (verts.length >= 2) {
      const [a, b] = [verts[verts.length - 2], verts[verts.length - 1]]
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) store.undoVertex()
    }
    const after = selectActiveSession(useGeometryEditStore.getState())
    if (after && canComplete(after)) void ctx.finish()
  },

  onContextMenu(e: DrawPointerEvent, ctx: DrawToolContext): DrawContextMenuItem[] | void {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const traverse = useTraverseStore.getState()
    const path = traversePath(session, traverse.path)

    const items: DrawContextMenuItem[] = []
    if (session.geometryType !== 'POINT') {
      items.push({
        label: 'Finish feature',
        onClick: () => void ctx.finish(),
        disabled: !canComplete(session),
      })
    }
    items.push({
      label: 'Undo leg',
      onClick: () => void undoTraverseLeg(ctx),
      // On a point traverse the reference is path[0] and is not a leg; take
      // the reference back by clicking somewhere else, not by undoing.
      disabled: path.length <= (usesReferencePoint(session) ? 1 : 0),
    })
    items.push({ label: 'Cancel drawing', onClick: () => ctx.cancel(), danger: true })
    return items
  },
}
