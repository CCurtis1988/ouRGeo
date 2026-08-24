import type { DrawTool, DrawPointerEvent, DrawToolContext } from '../types'

/**
 * Add-point tool: each click appends a new row to the dataset with a POINT
 * geometry at the clicked (snapped) position.
 */
export const addPointTool: DrawTool = {
  id: 'add-point',

  cursor: () => 'crosshair',

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    void ctx.commitPoint(e.lngLat[0], e.lngLat[1])
  }
}
