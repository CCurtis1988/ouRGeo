import { useCallback } from 'react'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useSpatialStore } from '@/store/spatial'
import { useSessionStore } from '@/store/session'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useGeometryCommit } from '@/hooks/useGeometryCommit'
import { rClient } from '@/lib/r-client'
import { findMatchingLayer } from '@/lib/geometry-geojson'
import { draftToGeoJSON } from '@/lib/draw/draft'
import { draftToWkt } from '@/lib/draw/wkt'
import { buildDeleteRowsRCode } from '@/lib/geometry-rcode'
import { triggerDataViewerRefresh } from '@/lib/data-viewer-refresh'

/**
 * Session-level drawing actions shared by the ribbon buttons, keyboard
 * shortcuts, and tool context menus: finish (stage + advance), cancel
 * (restore original geometry, end session), commitPoint (add-point), and
 * undoLast (draft undo first, then staged commits and row adds).
 */
export function useDrawActions() {
  const { commitAndAdvance, commitNewPoint } = useGeometryCommit()
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addHistory = useSessionStore((s) => s.addInputHistory)

  const finish = useCallback(async () => {
    const session = selectActiveSession(useGeometryEditStore.getState())
    if (!session) return
    const geometry = draftToGeoJSON(session.draft, session.geometryType)
    if (!geometry) return
    // WKT preserves arc segments as OGC curve types (map display stays on
    // the densified GeoJSON — GeoJSON has no curves).
    const wkt = draftToWkt(session.draft, session.geometryType)
    useDrawPreviewStore.getState().setCursor(null)
    await commitAndAdvance(geometry, wkt ?? undefined)
  }, [commitAndAdvance])

  const cancel = useCallback(() => {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session) return
    // POINT sessions commit a row per click; there is no in-progress draft to
    // roll back, and add-point sessions carry no meaningful originalGeometry
    // for their nominal current row (legacy End Draw behavior).
    if (session.geometryType !== 'POINT') {
      const layers = useSpatialStore.getState().layers
      const layer = findMatchingLayer(layers, session)
      if (layer) {
        useSpatialStore
          .getState()
          .updateLayerFeature(layer.id, session.currentRow, session.originalGeometry)
      }
    }
    store.stopEditing()
    useDrawPreviewStore.getState().clear()
  }, [])

  /**
   * Ctrl+Z semantics: undo the in-progress draft first; once that history is
   * exhausted, step back through staged commits — a geometry commit restores
   * the previous staged state, a row-add deletes the appended row (inverse R,
   * echoed to console).
   */
  const undoLast = useCallback(async () => {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (session && session.undoStack.length > 0) {
      store.undoDraft()
      return
    }
    const entry = store.popCommit()
    if (!entry) return
    const spatial = useSpatialStore.getState()

    if (entry.kind === 'geometry') {
      spatial.restoreStagedEdit(entry.groupKey, entry.rowId, entry.prevPending, entry.prevGeometry)
      return
    }

    // row-add: the row exists in R — delete it again.
    const meta = spatial.pendingEditMeta[entry.groupKey]
    const code = buildDeleteRowsRCode(entry.accessPath, [entry.rowId])
    addEntry('input', code)
    addHistory(code)
    try {
      const res = await rClient.execute(code)
      if (!res.success && res.error) addEntry('error', res.error)
    } catch (e) {
      addEntry('error', String(e))
    }
    spatial.unstageRow(entry.groupKey, entry.rowId)
    if (meta?.layerId) spatial.removeLayerFeatures(meta.layerId, [entry.rowId])
    // A session drawing on this dataset now points at a deleted row — end it.
    if (session && session.accessPath === entry.accessPath && session.envName === entry.envName) {
      store.stopEditing()
      useDrawPreviewStore.getState().clear()
    }
    triggerDataViewerRefresh(entry.accessPath, entry.envName)
  }, [addEntry, addHistory])

  return { finish, cancel, undoLast, commitPoint: commitNewPoint }
}
