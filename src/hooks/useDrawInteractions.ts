import { useRef, useEffect, useCallback } from 'react'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import type { SnapTarget } from '@/store/geometryEdit'
import type { SpatialLayer } from '@/store/spatial'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { ToolManager } from '@/lib/draw/tool-manager'
import type { DrawPointerEvent } from '@/lib/draw/types'
import { SnapEngine } from '@/lib/draw/snap-engine'
import { useDrawActions } from './useDrawActions'

/**
 * Wires the drawing ToolManager to a react-map-gl map: normalizes pointer
 * events (applying snapping first), dispatches them to the active tool, and
 * exposes the tool cursor. Handlers are inert while no tool is active, so
 * MapView can call them unconditionally (after its own lasso handling).
 */
export function useDrawInteractions(mapRef: React.RefObject<MapRef>, layers: SpatialLayer[]) {
  const session = useGeometryEditStore(selectActiveSession)
  const isEditMode = useGeometryEditStore((s) => s.isEditMode)
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const draggingVertex = useGeometryEditStore((s) => s.draggingVertex)
  const pendingRowAdd = useGeometryEditStore((s) => s.pendingRowAdd)
  const isSnapping = useGeometryEditStore((s) => s.isSnapping)
  const snapTarget = useGeometryEditStore((s) => s.snapTarget)
  const setSnapTarget = useGeometryEditStore((s) => s.setSnapTarget)
  const actions = useDrawActions()

  // Fresh action callbacks for the long-lived manager
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  // Ref so click handlers read the latest snap target without re-subscribing
  const snapTargetRef = useRef<SnapTarget | null>(null)
  snapTargetRef.current = snapTarget

  const managerRef = useRef<ToolManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = new ToolManager({
      getMap: () => mapRef.current?.getMap() ?? null,
      finish: () => actionsRef.current.finish(),
      cancel: () => actionsRef.current.cancel(),
      commitPoint: (lng, lat) => actionsRef.current.commitPoint(lng, lat)
    })
  }
  useEffect(() => {
    return () => {
      managerRef.current?.dispose()
      managerRef.current = null
    }
  }, [])

  // Spatial-indexed snapping; per-layer indexes rebuild lazily on layer change
  const snapEngineRef = useRef<SnapEngine | null>(null)
  if (!snapEngineRef.current) snapEngineRef.current = new SnapEngine()
  useEffect(() => {
    if (isSnapping) snapEngineRef.current?.updateLayers(layers)
  }, [isSnapping, layers])

  const toPointerEvent = useCallback(
    (e: MapLayerMouseEvent, snap: SnapTarget | null): DrawPointerEvent => ({
      lngLat: snap ? [snap.lng, snap.lat] : [e.lngLat.lng, e.lngLat.lat],
      rawLngLat: [e.lngLat.lng, e.lngLat.lat],
      point: { x: e.point.x, y: e.point.y },
      snap,
      shiftKey: e.originalEvent.shiftKey,
      ctrlKey: e.originalEvent.ctrlKey || e.originalEvent.metaKey
    }),
    []
  )

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      managerRef.current?.handleClick(toPointerEvent(e, snapTargetRef.current))
    },
    [toPointerEvent]
  )

  const handleDblClick = useCallback(
    (e: MapLayerMouseEvent) => {
      managerRef.current?.handleDblClick(toPointerEvent(e, snapTargetRef.current))
    },
    [toPointerEvent]
  )

  const handleMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      managerRef.current?.handleMouseDown(toPointerEvent(e, snapTargetRef.current))
    },
    [toPointerEvent]
  )

  const handleMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      let snapResult: SnapTarget | null = null
      if (isSnapping && (session || isEditMode)) {
        const map = mapRef.current?.getMap()
        if (map && snapEngineRef.current) {
          const settings = useSpatialSettingsStore.getState().snapSettings
          snapResult = snapEngineRef.current.query(
            e.point,
            (ll) => map.project(ll),
            (p) => map.unproject(p),
            settings,
            session
          )
        }
        setSnapTarget(snapResult)
        snapTargetRef.current = snapResult
      }
      managerRef.current?.handleMouseMove(toPointerEvent(e, snapResult))
    },
    [isSnapping, session, isEditMode, setSnapTarget, toPointerEvent, mapRef]
  )

  const handleMouseUp = useCallback(
    (e: MapLayerMouseEvent) => {
      managerRef.current?.handleMouseUp(toPointerEvent(e, snapTargetRef.current))
    },
    [toPointerEvent]
  )

  const handleMouseLeave = useCallback(() => {
    if (snapTargetRef.current) {
      setSnapTarget(null)
      snapTargetRef.current = null
    }
    useDrawPreviewStore.getState().setCursor(null)
  }, [setSnapTarget])

  const handleContextMenu = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!managerRef.current?.activeTool) return
      e.preventDefault()
      managerRef.current.handleContextMenu(
        toPointerEvent(e, snapTargetRef.current),
        e.originalEvent.clientX,
        e.originalEvent.clientY
      )
    },
    [toPointerEvent]
  )

  // activeToolId/draggingVertex subscriptions keep the cursor current
  void activeToolId
  void draggingVertex
  // While the "add another?" prompt is up, drawing input is suspended — show
  // the default cursor so the map reads as inert.
  const cursor = pendingRowAdd ? undefined : managerRef.current?.cursor()

  return {
    handleClick,
    handleDblClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleContextMenu,
    cursor,
    /** True while a drawing session should suppress double-click zoom. */
    suppressDoubleClickZoom: session !== null
  }
}
