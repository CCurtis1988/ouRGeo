import type { DrawTool, DrawPointerEvent, DrawToolContext, DrawContextMenuItem, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { canComplete, canStartNextPart, canStartHole, getPath } from '../draft'
import { densifyArc } from '../arc'
import { densifyBezier, bezierArcSpline, tangentArcVia, incomingTangent } from '../curves'

/** Two positions closer than this (in degrees) are treated as the same click. */
const DUPLICATE_EPS = 1e-9

/**
 * Unified digitizing tool: click to place vertices, rubber band to cursor,
 * double-click/Enter to finish, Esc to cancel, right-click for finish/undo/
 * hole/next-part/cancel. POINT sessions commit on every click (row per click).
 *
 * The active `curveType` (store) picks how a non-initial segment is built:
 *   - 'none'         straight — one click per vertex.
 *   - 'arc'          two clicks: through-point, then end.
 *   - 'endpoint-arc' two clicks: end, then a point the arc passes through.
 *   - 'tangent'      one click (end); the arc leaves the previous segment tangent.
 *   - 'bezier'       three clicks (control 1, control 2, end); the cubic Bézier is
 *                    committed as an arc spline (real OGC circular arcs).
 * All curve modes ultimately commit `{kind:'arc',via}` segments, so the WKT/sf
 * pipeline is shared. `pendingCurvePts` holds the clicks gathered so far for the
 * in-progress curve segment.
 */
export const drawTool: DrawTool & { pendingCurvePts: Position[] } = {
  id: 'draw',
  pendingCurvePts: [],

  cursor: () => 'crosshair',

  onDeactivate() {
    this.pendingCurvePts = []
    const preview = useDrawPreviewStore.getState()
    preview.setCursor(null)
    preview.setGhost(null)
  },

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const [lng, lat] = e.lngLat
    const click: Position = [lng, lat]

    if (session.geometryType === 'POINT') {
      store.addVertex(lng, lat)
      void ctx.finish()
      return
    }

    const path = getPath(session.draft, session.activePath)
    const activeVerts = path?.vertices ?? []
    const mode = store.curveType

    // The first click of a path always seeds the start vertex; curve
    // construction begins from the next click.
    if (mode === 'none' || activeVerts.length === 0) {
      store.addVertex(lng, lat)
      return
    }

    const start = activeVerts[activeVerts.length - 1]
    const clearGhost = () => useDrawPreviewStore.getState().setGhost(null)

    if (mode === 'arc') {
      // click 1 = through-point (via), click 2 = end
      if (this.pendingCurvePts.length === 0) {
        this.pendingCurvePts = [click]
        return
      }
      const via = this.pendingCurvePts[0]
      this.pendingCurvePts = []
      clearGhost()
      store.addArcVertex(lng, lat, via)
      return
    }

    if (mode === 'endpoint-arc') {
      // click 1 = end, click 2 = a point the arc passes through (via)
      if (this.pendingCurvePts.length === 0) {
        this.pendingCurvePts = [click]
        return
      }
      const end = this.pendingCurvePts[0]
      this.pendingCurvePts = []
      clearGhost()
      store.addArcVertex(end[0], end[1], click)
      return
    }

    if (mode === 'tangent') {
      // one click (end); via derived from the incoming tangent direction
      const tangent = incomingTangent(path!)
      const via = tangent ? tangentArcVia(start, click, tangent) : null
      if (!via) {
        store.addVertex(lng, lat) // no direction or degenerate → straight
        return
      }
      store.addArcVertex(lng, lat, via)
      return
    }

    if (mode === 'bezier') {
      // click 1 = control 1, click 2 = control 2, click 3 = end
      if (this.pendingCurvePts.length < 2) {
        this.pendingCurvePts.push(click)
        return
      }
      const [c1, c2] = this.pendingCurvePts
      this.pendingCurvePts = []
      clearGhost()
      store.appendArcSegmentsToActivePath(bezierArcSpline(start, c1, c2, click))
      return
    }

    store.addVertex(lng, lat)
  },

  onDblClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session || session.geometryType === 'POINT') return
    this.pendingCurvePts = []
    useDrawPreviewStore.getState().setGhost(null)

    // The double-click's two click events each placed a vertex — drop the
    // duplicate before finishing.
    const path = getPath(session.draft, session.activePath)
    const v = path?.vertices ?? []
    if (v.length >= 2) {
      const [a, b] = [v[v.length - 2], v[v.length - 1]]
      if (Math.abs(a[0] - b[0]) < DUPLICATE_EPS && Math.abs(a[1] - b[1]) < DUPLICATE_EPS) {
        store.undoVertex()
      }
    }
    const after = selectActiveSession(useGeometryEditStore.getState())
    if (after && canComplete(after)) void ctx.finish()
  },

  onMouseMove(e: DrawPointerEvent) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session || session.geometryType === 'POINT') return
    const preview = useDrawPreviewStore.getState()
    const path = getPath(session.draft, session.activePath)
    const verts = path?.vertices ?? []
    if (verts.length === 0) {
      preview.setCursor(null)
      preview.setGhost(null)
      return
    }

    const start = verts[verts.length - 1]
    const cursor = e.lngLat
    const mode = store.curveType
    const pending = this.pendingCurvePts

    // Ghost = the curve currently being constructed (last vertex → cursor).
    let arcPts: Position[] | null = null
    let bezierPts: Position[] | null = null

    if (mode === 'arc' && pending.length === 1) {
      arcPts = densifyArc(start, pending[0], cursor) // start → via → cursor(end)
    } else if (mode === 'endpoint-arc' && pending.length === 1) {
      arcPts = densifyArc(start, cursor, pending[0]) // start → cursor(via) → end
    } else if (mode === 'tangent') {
      const tangent = incomingTangent(path!)
      const via = tangent ? tangentArcVia(start, cursor, tangent) : null
      arcPts = via ? densifyArc(start, via, cursor) : null
    } else if (mode === 'bezier' && pending.length >= 1) {
      const c1 = pending[0]
      const c2 = pending.length >= 2 ? pending[1] : cursor
      bezierPts = densifyBezier(start, c1, c2, cursor)
    }

    if (arcPts) {
      preview.setGhost({
        type: 'LineString',
        coordinates: [[start[0], start[1]], ...arcPts.map(([x, y]) => [x, y])]
      })
      preview.setCursor(null)
      return
    }
    if (bezierPts) {
      preview.setGhost({ type: 'LineString', coordinates: bezierPts.map(([x, y]) => [x, y]) })
      preview.setCursor(null)
      return
    }

    preview.setGhost(null)
    preview.setCursor(cursor)
  },

  onContextMenu(e: DrawPointerEvent, ctx: DrawToolContext): DrawContextMenuItem[] | void {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return

    const activePathLen = getPath(session.draft, session.activePath)?.vertices.length ?? 0
    const items: DrawContextMenuItem[] = []
    if (this.pendingCurvePts.length > 0) {
      items.push({
        label: 'Cancel curve point',
        onClick: () => {
          this.pendingCurvePts = []
          useDrawPreviewStore.getState().setGhost(null)
        }
      })
    }
    if (session.geometryType !== 'POINT') {
      items.push({
        label: 'Finish feature',
        onClick: () => void ctx.finish(),
        disabled: !canComplete(session)
      })
    }
    items.push({
      label: 'Remove last vertex',
      onClick: () => store.undoVertex(),
      disabled: activePathLen === 0
    })
    if (canStartHole(session)) {
      items.push({ label: 'Start hole', onClick: () => store.startNewHole() })
    }
    if (canStartNextPart(session)) {
      items.push({ label: 'Start next part', onClick: () => store.startNextPart() })
    }
    items.push({ label: 'Cancel drawing', onClick: () => ctx.cancel(), danger: true })
    return items
  }
}
