import type { DrawTool, DrawPointerEvent, DrawToolContext, ToolId } from './types'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { drawTool } from './tools/draw'
import { selectTool } from './tools/select'
import { editVerticesTool } from './tools/edit-vertices'
import { moveFeatureTool } from './tools/move-feature'
import { addPointTool } from './tools/add-point'
import { rectangleTool } from './tools/rectangle'
import { circleTool } from './tools/circle'
import { freehandTool } from './tools/freehand'
import { traceTool, offsetTraceTool } from './tools/trace'
import { distanceBearingTool } from './tools/distance-bearing'

const ALL_TOOLS: DrawTool[] = [
  selectTool,
  drawTool,
  editVerticesTool,
  moveFeatureTool,
  addPointTool,
  rectangleTool,
  circleTool,
  freehandTool,
  traceTool,
  offsetTraceTool,
  distanceBearingTool
]

/**
 * Dispatches normalized pointer events to the active tool and fires
 * activate/deactivate transitions when the store's activeToolId changes
 * (tool switches can originate from the ribbon, hotkeys, or tools
 * themselves, so the manager watches the store rather than owning the id).
 */
export class ToolManager {
  private tools = new Map<ToolId, DrawTool>(ALL_TOOLS.map((t) => [t.id, t]))
  private lastToolId: ToolId | null = null
  private unsubscribe: () => void

  constructor(private ctx: DrawToolContext) {
    this.lastToolId = useGeometryEditStore.getState().activeToolId
    this.unsubscribe = useGeometryEditStore.subscribe((state) => {
      const next = state.activeToolId
      if (next === this.lastToolId) return
      const prev = this.lastToolId
      this.lastToolId = next
      if (prev) this.tools.get(prev)?.onDeactivate?.(this.ctx)
      useDrawPreviewStore.getState().closeContextMenu()
      if (next) this.tools.get(next)?.onActivate?.(this.ctx)
    })
  }

  dispose() {
    this.unsubscribe()
  }

  get activeTool(): DrawTool | null {
    const id = useGeometryEditStore.getState().activeToolId
    return id ? (this.tools.get(id) ?? null) : null
  }

  /**
   * Drawing input is suspended while the "add another feature?" prompt is
   * awaiting an answer — the committed row is done, and the next row does
   * not exist yet. Keyboard (Enter/Esc) drives the prompt instead.
   */
  private get suspended(): boolean {
    return useGeometryEditStore.getState().pendingRowAdd
  }

  cursor(): string | undefined {
    return this.activeTool?.cursor()
  }

  handleClick(e: DrawPointerEvent) {
    if (this.suspended) return
    this.activeTool?.onClick?.(e, this.ctx)
  }

  handleDblClick(e: DrawPointerEvent) {
    if (this.suspended) return
    this.activeTool?.onDblClick?.(e, this.ctx)
  }

  /** Returns true when the tool captured the gesture (map pan must stay off). */
  handleMouseDown(e: DrawPointerEvent): boolean {
    if (this.suspended) return false
    return this.activeTool?.onMouseDown?.(e, this.ctx) === true
  }

  handleMouseMove(e: DrawPointerEvent) {
    if (this.suspended) return
    this.activeTool?.onMouseMove?.(e, this.ctx)
  }

  handleMouseUp(e: DrawPointerEvent) {
    if (this.suspended) return
    this.activeTool?.onMouseUp?.(e, this.ctx)
  }

  /** Opens the tool's context menu at the event position, if the tool provides one. */
  handleContextMenu(e: DrawPointerEvent, screenX: number, screenY: number) {
    if (this.suspended) return
    const items = this.activeTool?.onContextMenu?.(e, this.ctx)
    if (items && items.length > 0) {
      useDrawPreviewStore.getState().openContextMenu(screenX, screenY, items)
    }
  }
}
