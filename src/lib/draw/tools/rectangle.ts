import type { DrawTool, DrawPointerEvent, DrawToolContext, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { rectangleCorners } from '../shapes'

/**
 * Two-click screen-aligned rectangle (Shift = square). The second click
 * replaces the active ring with the rectangle and finishes the feature.
 */
export const rectangleTool: DrawTool & { firstCorner: Position | null } = {
  id: 'rectangle',
  firstCorner: null,

  cursor: () => 'crosshair',

  onDeactivate() {
    this.firstCorner = null
    useDrawPreviewStore.getState().setGhost(null)
  },

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    if (!this.firstCorner) {
      this.firstCorner = e.lngLat
      return
    }
    const map = ctx.getMap()
    if (!map) return
    const corners = rectangleCorners(
      this.firstCorner,
      e.lngLat,
      e.shiftKey,
      (ll) => map.project(ll),
      (p) => map.unproject(p)
    )
    this.firstCorner = null
    useDrawPreviewStore.getState().setGhost(null)
    store.setActivePathVertices(corners)
    void ctx.finish()
  },

  onMouseMove(e: DrawPointerEvent, ctx: DrawToolContext) {
    if (!this.firstCorner) return
    const map = ctx.getMap()
    if (!map) return
    const corners = rectangleCorners(
      this.firstCorner,
      e.lngLat,
      e.shiftKey,
      (ll) => map.project(ll),
      (p) => map.unproject(p)
    )
    useDrawPreviewStore.getState().setGhost({
      type: 'Polygon',
      coordinates: [[...corners.map(([x, y]) => [x, y]), [corners[0][0], corners[0][1]]]]
    })
  },

  onContextMenu(_e: DrawPointerEvent, ctx: DrawToolContext) {
    return [
      {
        label: 'Cancel rectangle',
        onClick: () => {
          this.firstCorner = null
          useDrawPreviewStore.getState().setGhost(null)
          ctx.cancel()
        },
        danger: true
      }
    ]
  }
}
