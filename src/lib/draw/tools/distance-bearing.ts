import type { DrawTool, DrawPointerEvent, DrawToolContext, DrawContextMenuItem, Position } from '../types'
import {
  useGeometryEditStore, selectActiveSession, type GeometryEditSession,
} from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useTraverseStore } from '@/store/traverse'
import { canComplete, getPath } from '../draft'
import { destination, incomingAzimuth, reduceGridLeg } from '../cogo'
import { buildTraverseRCode } from '../traverse-rcode'
import { useSessionStore } from '@/store/session'

/**
 * Distance & Bearing — the tool the website has always described.
 *
 * > *"Don't eyeball it — type it. Enter an absolute coordinate, or place the
 * > next vertex relative to the last one by distance and bearing."*
 *
 * One click sets the start; every vertex after it comes from the entry strip
 * under the map (`TraverseBar.tsx`), which is where the numbers are typed and
 * where the coordinate system is named. A leg is an ordinary vertex append, so
 * undo, snapping, Save Edits and the R write know nothing about this tool.
 *
 * **Clicking still works after the first one.** It appends a vertex and moves
 * the start on, exactly as the draw tool would. A traverse with one eyeballed
 * corner in the middle of it is a real thing people do, and refusing the click
 * would be an arbitrary wall — the tool is about being ABLE to type, not about
 * being forbidden to point.
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
 * draft at all (each leg commits a row), so its trail is the one the store
 * keeps.
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

/** The azimuth a relative bearing turns from — the one the last leg ARRIVED
 *  on, which is not the one it left on. See `cogo.ts`. */
export function traverseIncoming(session: GeometryEditSession, storePath: Position[]): number | null {
  return incomingAzimuth(traversePath(session, storePath))
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
  if (path.length === 0 || st.legs.length === 0) return
  const code = buildTraverseRCode(path[0], st.legs, st.basis, st.crs)
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

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const [lng, lat] = e.lngLat

    if (session.geometryType === 'POINT') {
      // Every leg of a point traverse is its own row, the first one included.
      useTraverseStore.getState().pushVertex([lng, lat])
      void ctx.commitPoint(lng, lat)
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
      onClick: () => {
        if (session.geometryType === 'POINT') traverse.popVertex()
        else store.undoVertex()
        traverse.dropLastLeg()
      },
      disabled: path.length === 0,
    })
    items.push({ label: 'Cancel drawing', onClick: () => ctx.cancel(), danger: true })
    return items
  },
}
