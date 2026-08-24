import type { DrawTool, DrawPointerEvent, DrawToolContext, DrawContextMenuItem, VertexRef, PathRef } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { canComplete } from '../draft'

const VERTEX_LAYER = 'drawing-vertices'
const CLOSE_VERTEX_LAYER = 'drawing-close-vertex'
const MIDPOINT_LAYER = 'drawing-midpoints'

function hitVertex(ctx: DrawToolContext, point: { x: number; y: number }): VertexRef | null {
  const map = ctx.getMap()
  if (!map) return null
  const hits = map.queryRenderedFeatures([point.x, point.y], {
    layers: [VERTEX_LAYER, CLOSE_VERTEX_LAYER]
  })
  if (!hits.length) return null
  const p = hits[0].properties ?? {}
  return { part: p.part ?? 0, ring: p.ring ?? 0, vertex: p.vertex }
}

function hitMidpoint(
  ctx: DrawToolContext,
  point: { x: number; y: number }
): (PathRef & { insertAfterIdx: number }) | null {
  const map = ctx.getMap()
  if (!map) return null
  const hits = map.queryRenderedFeatures([point.x, point.y], { layers: [MIDPOINT_LAYER] })
  if (!hits.length) return null
  const p = hits[0].properties ?? {}
  return { part: p.part ?? 0, ring: p.ring ?? 0, insertAfterIdx: p.insertAfterIdx }
}

/**
 * Unified vertex-editing tool: drag vertices to move them, drag a midpoint
 * handle to insert a vertex mid-edge, click a vertex to select it (Delete
 * removes it).
 */
export const editVerticesTool: DrawTool = {
  id: 'edit-vertices',

  cursor() {
    return useGeometryEditStore.getState().draggingVertex ? 'grabbing' : 'grab'
  },

  onDeactivate() {
    const store = useGeometryEditStore.getState()
    store.setDraggingVertex(null)
    store.setSelectedVertex(null)
  },

  onMouseDown(e: DrawPointerEvent, ctx: DrawToolContext): boolean | void {
    const store = useGeometryEditStore.getState()
    if (!selectActiveSession(store)) return

    const vertex = hitVertex(ctx, e.point)
    if (vertex) {
      store.beginDraftEdit()
      store.setDraggingVertex(vertex)
      store.setSelectedVertex(vertex)
      return true
    }

    // Midpoint handle: insert a new vertex at the handle position and start
    // dragging it immediately (industry-standard midpoint-drag insert).
    const mid = hitMidpoint(ctx, e.point)
    if (mid) {
      const ref: PathRef = { part: mid.part, ring: mid.ring }
      store.insertVertexAt(ref, mid.insertAfterIdx, e.lngLat[0], e.lngLat[1])
      const inserted: VertexRef = { ...ref, vertex: mid.insertAfterIdx + 1 }
      store.setDraggingVertex(inserted)
      store.setSelectedVertex(inserted)
      return true
    }
  },

  onMouseMove(e: DrawPointerEvent) {
    const store = useGeometryEditStore.getState()
    const dragging = store.draggingVertex
    if (!dragging) return
    store.moveVertexTo(dragging, e.lngLat[0], e.lngLat[1])
  },

  onMouseUp() {
    const store = useGeometryEditStore.getState()
    if (store.draggingVertex) store.setDraggingVertex(null)
  },

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    // Selection happens on mousedown (so a drag also selects); a plain click
    // on empty space clears the selection.
    const store = useGeometryEditStore.getState()
    if (!hitVertex(ctx, e.point) && store.selectedVertex) store.setSelectedVertex(null)
  },

  onContextMenu(e: DrawPointerEvent, ctx: DrawToolContext): DrawContextMenuItem[] | void {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return

    const vertex = hitVertex(ctx, e.point)
    const items: DrawContextMenuItem[] = []
    if (vertex) {
      items.push({
        label: 'Delete vertex',
        onClick: () => store.removeVertexAt(vertex)
      })
    }
    items.push({
      label: 'Finish editing',
      onClick: () => void ctx.finish(),
      disabled: !canComplete(session)
    })
    items.push({ label: 'Cancel changes', onClick: () => ctx.cancel(), danger: true })
    return items
  }
}
