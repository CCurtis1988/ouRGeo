import type { DrawTool, DrawPointerEvent, DrawToolContext, ToolId, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { hitTestFeature } from '../hit-test'
import { geometryTracePaths, projectOntoPath, extractSubPath } from '../trace'
import type { TracePath, PathProjection } from '../trace'
import { offsetPath } from '../offset'

interface TraceState {
  paths: TracePath[]
  pathIdx: number
  start: PathProjection
}

/**
 * Trace tool family: click a point on an existing feature's linework, move
 * along the boundary (Tab flips direction on rings), click again to accept
 * the traced run into the draft. The offset variant shifts the traced run
 * perpendicular by the ribbon's offset distance (meters).
 */
function createTraceTool(id: ToolId, withOffset: boolean) {
  const tool: DrawTool & {
    state: TraceState | null
    reversed: boolean
    flipDirection: () => void
  } = {
    id,
    state: null,
    reversed: false,

    cursor: () => 'crosshair',

    onDeactivate() {
      this.state = null
      this.reversed = false
      useDrawPreviewStore.getState().setGhost(null)
    },

    flipDirection() {
      this.reversed = !this.reversed
    },

    onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
      const store = useGeometryEditStore.getState()
      const session = selectActiveSession(store)
      if (!session) return
      const map = ctx.getMap()
      if (!map) return

      if (!this.state) {
        // First click: lock onto a feature's linework
        const hit = hitTestFeature(map, e.point)
        if (!hit?.feature.geometry) return
        const paths = geometryTracePaths(hit.feature.geometry)
        if (paths.length === 0) return
        // Choose the path whose projection is nearest to the click
        let best: { idx: number; proj: PathProjection; dist: number } | null = null
        for (let i = 0; i < paths.length; i++) {
          const proj = projectOntoPath(paths[i], e.lngLat)
          if (!proj) continue
          const d = Math.hypot(proj.point[0] - e.lngLat[0], proj.point[1] - e.lngLat[1])
          if (!best || d < best.dist) best = { idx: i, proj, dist: d }
        }
        if (!best) return
        this.state = { paths, pathIdx: best.idx, start: best.proj }
        this.reversed = false
        return
      }

      // Second click: accept the traced run
      const path = this.state.paths[this.state.pathIdx]
      const end = projectOntoPath(path, e.lngLat)
      if (!end) return
      let traced = extractSubPath(path, this.state.start, end, this.reversed)
      if (withOffset) {
        traced = offsetPath(traced, useGeometryEditStore.getState().offsetDistance)
      }
      this.state = null
      useDrawPreviewStore.getState().setGhost(null)
      if (traced.length >= 2) store.appendVerticesToActivePath(traced)
    },

    onMouseMove(e: DrawPointerEvent, _ctx: DrawToolContext) {
      if (!this.state) return
      const path = this.state.paths[this.state.pathIdx]
      const end = projectOntoPath(path, e.lngLat)
      if (!end) return
      let traced = extractSubPath(path, this.state.start, end, this.reversed)
      if (withOffset) {
        traced = offsetPath(traced, useGeometryEditStore.getState().offsetDistance)
      }
      if (traced.length < 2) {
        useDrawPreviewStore.getState().setGhost(null)
        return
      }
      useDrawPreviewStore.getState().setGhost({
        type: 'LineString',
        coordinates: traced.map(([x, y]: Position) => [x, y])
      })
    },

    onContextMenu(_e: DrawPointerEvent, ctx: DrawToolContext) {
      const items = []
      if (this.state) {
        items.push({
          label: 'Restart trace',
          onClick: () => {
            this.state = null
            useDrawPreviewStore.getState().setGhost(null)
          }
        })
      }
      items.push({ label: 'Cancel drawing', onClick: () => ctx.cancel(), danger: true })
      return items
    }
  }
  return tool
}

export const traceTool = createTraceTool('trace', false)
export const offsetTraceTool = createTraceTool('offset-trace', true)

/** Tab hotkey: flip the trace direction on whichever trace tool is active. */
export function flipActiveTraceDirection(activeToolId: ToolId | null) {
  if (activeToolId === 'trace') traceTool.flipDirection()
  else if (activeToolId === 'offset-trace') offsetTraceTool.flipDirection()
}
