import type { DrawTool, DrawPointerEvent, DrawToolContext, DrawContextMenuItem, Position } from '../types'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { canComplete, draftIsEmpty } from '../draft'

/**
 * Whole-feature move tool: drag anywhere to translate every vertex of the
 * session's draft. Commit with Enter/Complete as usual.
 */
export const moveFeatureTool: DrawTool = {
  id: 'move-feature',

  cursor() {
    return this.draggingFrom ? 'grabbing' : 'move'
  },

  draggingFrom: null as Position | null,

  onDeactivate() {
    this.draggingFrom = null
  },

  onMouseDown(e: DrawPointerEvent): boolean | void {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session || draftIsEmpty(session.draft)) return
    store.beginDraftEdit()
    this.draggingFrom = e.rawLngLat
    return true
  },

  onMouseMove(e: DrawPointerEvent) {
    if (!this.draggingFrom) return
    const store = useGeometryEditStore.getState()
    const [fromLng, fromLat] = this.draggingFrom
    const [lng, lat] = e.rawLngLat
    store.translateDraftBy(lng - fromLng, lat - fromLat)
    this.draggingFrom = e.rawLngLat
  },

  onMouseUp() {
    this.draggingFrom = null
  },

  onContextMenu(_e: DrawPointerEvent, ctx: DrawToolContext): DrawContextMenuItem[] | void {
    const session = selectActiveSession(useGeometryEditStore.getState())
    if (!session) return
    return [
      {
        label: 'Finish editing',
        onClick: () => void ctx.finish(),
        disabled: !canComplete(session)
      },
      { label: 'Cancel changes', onClick: () => ctx.cancel(), danger: true }
    ]
  }
} as DrawTool & { draggingFrom: Position | null }
