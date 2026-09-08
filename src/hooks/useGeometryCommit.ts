import { useCallback } from 'react'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useSessionStore } from '@/store/session'
import { useSpatialStore, pendingGroupKey } from '@/store/spatial'
import type { PendingEditMeta, PendingGeometryEdit } from '@/store/spatial'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { rClient } from '@/lib/r-client'
import { findMatchingLayer, geometryToWKT } from '@/lib/geometry-geojson'
import { isCurvedWkt } from '@/lib/draw/wkt'
import { triggerDataViewerRefresh } from '@/lib/data-viewer-refresh'

/**
 * Commit path for drawn geometry. Under the unified edit-session model
 * NOTHING is written on commit: edits for both in-memory R objects and
 * db-backed layers stage into spatial.pendingGeometryEdits, the map updates
 * instantly, and the user writes everything with Save Edits (per object).
 * Row additions are the exception — the grid reads rows from R, so the row
 * itself is appended immediately (echoed R) and tracked for undo.
 */
export function useGeometryCommit() {
  const advanceRow = useGeometryEditStore((s) => s.advanceRow)
  const finishEditingAndExitToSelect = useGeometryEditStore((s) => s.finishEditingAndExitToSelect)
  const requestRowAdd = useGeometryEditStore((s) => s.requestRowAdd)
  const recordCommitted = useGeometryEditStore((s) => s.recordCommitted)
  const incrementTotalRows = useGeometryEditStore((s) => s.incrementTotalRows)
  const logCommit = useGeometryEditStore((s) => s.logCommit)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addHistory = useSessionStore((s) => s.addInputHistory)
  const addPendingGeometryEdit = useSpatialStore((s) => s.addPendingGeometryEdit)
  const appendLayerFeature = useSpatialStore((s) => s.appendLayerFeature)
  const commitGeometryEdit = useSpatialStore((s) => s.commitGeometryEdit)

  const commitAndAdvance = useCallback(
    async (geometry: GeoJSON.Geometry | null, draftWkt?: string) => {
      // The session and the layers are read HERE, not subscribed to.
      //
      // A subscribed `session` is the one that existed when this callback was
      // built, and a caller is entitled to move the session on immediately
      // before committing: Distance & Bearing answers the "add another row?"
      // prompt and then places its leg in the same keystroke, and with the
      // captured session that leg was staged into the row BEFORE the one just
      // appended — silently overwriting the previous point. Every caller
      // reaches this within a tick of mutating the store, so the fresh read is
      // the right one for all of them (`useDrawActions.finish` already did it
      // for the draft it hands over).
      const session = selectActiveSession(useGeometryEditStore.getState())
      if (!session || !geometry) return
      const layers = useSpatialStore.getState().layers
      const layer = findMatchingLayer(layers, session)
      const isDb = !!layer?.tileSource
      const curved = !!draftWkt && isCurvedWkt(draftWkt)

      const meta: PendingEditMeta = {
        source: isDb ? 'database' : 'memory',
        layerId: layer?.id,
        accessPath: session.accessPath,
        envName: session.envName,
        columnName: session.columnName,
        colLib: session.colLib
      }
      const key = pendingGroupKey(meta)

      // Resolve the row identity: db layers key by primary-key value, memory
      // objects by row index.
      let rowId = session.currentRow
      if (isDb && layer) {
        const currentFeature = layer.geojson.features[session.currentRow]
        const featureId = currentFeature?.id
        rowId = typeof featureId === 'number' ? featureId : Number(featureId)
        if (!Number.isFinite(rowId)) {
          addEntry('error', 'Cannot stage edit: feature has no stable row id (try refreshing the layer)')
          return
        }
      }

      // Densified (straight-segment) WKT — used for DB layers and geos
      // columns, neither of which can store curves.
      const straightWkt = geometryToWKT(geometry)
      if (isDb && !straightWkt) {
        addEntry('error', `Cannot stage edit: unsupported geometry for WKT (${geometry.type})`)
        return
      }

      // Memory sf columns keep the curve-preserving WKT directly. DB layers
      // store linearized geometry (DuckDB has no curve types) plus the exact
      // curved WKT in the _rgeo_wkt_true companion column — lossless. geos
      // columns can only hold linearized geometry.
      const preservesCurves = !isDb && session.colLib === 'sf'
      const wkt = preservesCurves ? (draftWkt ?? straightWkt) : straightWkt
      const wktTrue = isDb && curved && session.colLib === 'sf' ? draftWkt : undefined
      if (curved && !preservesCurves && !wktTrue) {
        addEntry('output', '[Rgeo] geos columns cannot store curves; arcs were densified.\n')
      }

      const spatialState = useSpatialStore.getState()
      const prevPending =
        spatialState.pendingGeometryEdits[key]?.find(
          (e) => e.rowId === rowId && (e.kind ?? 'geometry') === 'geometry'
        ) ?? null
      const currentFeature = layer?.geojson.features[session.currentRow]
      const prevGeometry = session.originalGeometry ?? currentFeature?.geometry ?? null

      const edit: PendingGeometryEdit = {
        rowId,
        kind: 'geometry',
        wkt: wkt ?? undefined,
        wktTrue,
        geometry,
        originalGeometry: prevGeometry
      }

      if (layer) {
        // Atomic: stage + replace the on-map feature in one store transition.
        commitGeometryEdit(meta, session.currentRow, edit)
      } else {
        addPendingGeometryEdit(meta, edit)
        // Not on map — record for DrawingLayer to keep visible until session ends.
        const geomType = geometry.type
        const kind =
          geomType === 'Point' || geomType === 'MultiPoint'
            ? 'committed-point'
            : geomType === 'LineString' || geomType === 'MultiLineString'
              ? 'committed-line'
              : 'committed-polygon'
        recordCommitted({ type: 'Feature', properties: { kind }, geometry })
      }

      logCommit({
        kind: 'geometry',
        groupKey: key,
        rowId,
        prevPending,
        prevGeometry,
        accessPath: session.accessPath,
        envName: session.envName
      })

      // Db-backed feature edits come from Select → edit; return to selection.
      // Row-driven (data viewer) sessions advance to the next row.
      if (isDb) {
        finishEditingAndExitToSelect()
        return
      }

      // If this row was appended during the session (a brand-new feature),
      // offer the attribute popup — unless it's disabled in Settings or
      // snoozed via "ignore until next save". When suppressed, nothing
      // steals focus from the map, so Enter keeps chaining new features.
      const isNewRow = (useSpatialStore.getState().pendingGeometryEdits[key] ?? []).some(
        (e) => e.kind === 'row-add' && e.rowId === rowId
      )
      if (isNewRow) {
        const geoState = useGeometryEditStore.getState()
        const enabled = useSpatialSettingsStore.getState().showAttributePopup
        if (enabled && !geoState.attributePromptSnoozed) {
          geoState.setAttributePrompt({
            accessPath: session.accessPath,
            envName: session.envName,
            row: rowId
          })
        }
      }

      if (session.currentRow + 1 >= session.totalRows) {
        requestRowAdd()
        // Drop any lingering rubber band / ghost previews with the draft.
        useDrawPreviewStore.getState().clear()
      } else {
        // Pass the next row's existing geometry so Cancel can restore it.
        const nextRow = session.currentRow + 1
        const nextOriginalGeometry = layer?.geojson.features[nextRow]?.geometry ?? null
        advanceRow(nextOriginalGeometry)
      }
    },
    [
      advanceRow, finishEditingAndExitToSelect, requestRowAdd, recordCommitted,
      logCommit, addEntry, addPendingGeometryEdit, commitGeometryEdit
    ]
  )

  const commitNewPoint = useCallback(
    async (lng: number, lat: number) => {
      const session = selectActiveSession(useGeometryEditStore.getState())
      if (!session) return
      // The row itself is appended immediately (the grid reads rows from R);
      // its geometry stages like any other edit until Save.
      const code = `${session.accessPath}[nrow(${session.accessPath}) + 1L, ] <- NA`
      addEntry('input', code)
      addHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success) {
          if (res.error) addEntry('error', res.error)
          return
        }
      } catch (e) {
        addEntry('error', String(e))
        return
      }

      const geometry: GeoJSON.Geometry = { type: 'Point', coordinates: [lng, lat] }
      const layers = useSpatialStore.getState().layers
      const layer = findMatchingLayer(layers, session)
      const rowIdx = session.totalRows
      const meta: PendingEditMeta = {
        source: layer?.tileSource ? 'database' : 'memory',
        layerId: layer?.id,
        accessPath: session.accessPath,
        envName: session.envName,
        columnName: session.columnName,
        colLib: session.colLib
      }
      const key = pendingGroupKey(meta)

      addPendingGeometryEdit(meta, { rowId: rowIdx, kind: 'row-add', geometry, originalGeometry: null })
      addPendingGeometryEdit(meta, {
        rowId: rowIdx,
        kind: 'geometry',
        wkt: `POINT(${lng} ${lat})`,
        geometry,
        originalGeometry: null
      })
      logCommit({
        kind: 'row-add',
        groupKey: key,
        rowId: rowIdx,
        prevPending: null,
        prevGeometry: null,
        accessPath: session.accessPath,
        envName: session.envName
      })

      if (layer) {
        // Point is on the map — append to the spatial layer so it renders with
        // the layer's full symbology and persists after the session ends.
        appendLayerFeature(layer.id, geometry)
      } else {
        // Not on map — record session-locally for DrawingLayer to display.
        recordCommitted({ type: 'Feature', properties: { kind: 'committed-point' }, geometry })
      }
      incrementTotalRows()
      triggerDataViewerRefresh(session.accessPath, session.envName)
    },
    [
      addEntry, addHistory, recordCommitted, incrementTotalRows, logCommit,
      appendLayerFeature, addPendingGeometryEdit
    ]
  )

  return { commitAndAdvance, commitNewPoint }
}
