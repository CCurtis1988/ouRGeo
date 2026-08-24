import type { DrawTool, DrawPointerEvent, DrawToolContext, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { circleVertices } from '../shapes'

/**
 * Center + radius circle: first click sets the center, second click sets the
 * radius, densified to 64 segments and committed as the active ring.
 */
export const circleTool: DrawTool & { center: Position | null } = {
  id: 'circle',
  center: null,

  cursor: () => 'crosshair',

  onDeactivate() {
    this.center = null
    useDrawPreviewStore.getState().setGhost(null)
  },

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    if (!this.center) {
      this.center = e.lngLat
      return
    }
    const map = ctx.getMap()
    if (!map) return
    const verts = circleVertices(
      this.center,
      e.lngLat,
      (ll) => map.project(ll),
      (p) => map.unproject(p)
    )
    if (verts.length === 0) return
    this.center = null
    useDrawPreviewStore.getState().setGhost(null)
    store.setActivePathVertices(verts)
    void ctx.finish()
  },

  onMouseMove(e: DrawPointerEvent, ctx: DrawToolContext) {
    if (!this.center) return
    const map = ctx.getMap()
    if (!map) return
    const verts = circleVertices(
      this.center,
      e.lngLat,
      (ll) => map.project(ll),
      (p) => map.unproject(p)
    )
    if (verts.length === 0) return
    useDrawPreviewStore.getState().setGhost({
      type: 'Polygon',
      coordinates: [[...verts.map(([x, y]) => [x, y]), [verts[0][0], verts[0][1]]]]
    })
  },

  onContextMenu(_e: DrawPointerEvent, ctx: DrawToolContext) {
    return [
      {
        label: 'Cancel circle',
        onClick: () => {
          this.center = null
          useDrawPreviewStore.getState().setGhost(null)
          ctx.cancel()
        },
        danger: true
      }
    ]
  }
}
