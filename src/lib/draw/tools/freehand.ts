import type { DrawTool, DrawPointerEvent, DrawToolContext, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { simplifyPathPx } from '../shapes'

/** Minimum cursor travel (px) before another stream vertex is sampled. */
const MIN_SAMPLE_PX = 3

/**
 * Freehand / stream digitizing: hold the mouse down and sketch; on release
 * the stroke is Douglas-Peucker-simplified and committed (closed for polygon
 * sessions, open for lines).
 */
export const freehandTool: DrawTool & {
  stroke: Position[]
  lastPx: { x: number; y: number } | null
} = {
  id: 'freehand',
  stroke: [],
  lastPx: null,

  cursor: () => 'crosshair',

  onDeactivate() {
    this.stroke = []
    this.lastPx = null
    useDrawPreviewStore.getState().setGhost(null)
  },

  onMouseDown(e: DrawPointerEvent): boolean | void {
    const session = selectActiveSession(useGeometryEditStore.getState())
    if (!session) return
    this.stroke = [e.rawLngLat]
    this.lastPx = e.point
    return true // capture: suppress map pan while sketching
  },

  onMouseMove(e: DrawPointerEvent) {
    if (this.stroke.length === 0 || !this.lastPx) return
    const dx = e.point.x - this.lastPx.x
    const dy = e.point.y - this.lastPx.y
    if (Math.hypot(dx, dy) < MIN_SAMPLE_PX) return
    this.stroke.push(e.rawLngLat)
    this.lastPx = e.point
    const session = selectActiveSession(useGeometryEditStore.getState())
    const isPolygon =
      session?.geometryType === 'POLYGON' || session?.geometryType === 'MULTIPOLYGON'
    const coords = this.stroke.map(([x, y]) => [x, y])
    useDrawPreviewStore.getState().setGhost(
      isPolygon && coords.length >= 3
        ? { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
        : { type: 'LineString', coordinates: coords }
    )
  },

  onMouseUp(_e: DrawPointerEvent, ctx: DrawToolContext) {
    const stroke = this.stroke
    this.stroke = []
    this.lastPx = null
    useDrawPreviewStore.getState().setGhost(null)
    if (stroke.length < 2) return

    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    const map = ctx.getMap()
    if (!map) return

    const simplified = simplifyPathPx(stroke, (ll) => map.project(ll), 2)
    const isPolygon =
      session.geometryType === 'POLYGON' || session.geometryType === 'MULTIPOLYGON'
    if (isPolygon && simplified.length < 3) return
    if (!isPolygon && simplified.length < 2) return

    store.setActivePathVertices(simplified)
    void ctx.finish()
  }
}
