// Writing staged geometry edits back to R.
//
// Lifted out of useSaveEdits so the same code path serves the Save Edits dialog,
// the ribbon, and the AI assistant. Nothing here was React-specific: both
// functions already read every store through getState(), and only reached
// through the hook for the console-entry helpers, which are store functions too.
//
// Memory groups write back as one batched R statement echoed to the console;
// database groups flush via /dataset/update-geometry. Saving or discarding a
// group is an undo barrier — its commit-log entries are dropped.

import { useSpatialStore, type PendingGeometryEdit } from '@/store/spatial'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import { buildBatchedGeometryRCode, buildDeleteRowsRCode } from '@/lib/geometry-rcode'
import { geometryToWKT } from '@/lib/geometry-geojson'
import { triggerDataViewerRefresh, triggerDataViewerCellUpdate } from '@/lib/data-viewer-refresh'

/** Render a stored WKT the way sf's as.character prints an sfc cell: a space
 *  after the geometry type keyword, e.g. "POINT(1 2)" -> "POINT (1 2)". */
function wktToCellDisplay(wkt: string): string {
  return wkt.replace(/^([A-Za-z]+)\s*\(/, '$1 (')
}

/** Commit the staged edits of each group to its R object. */
export async function saveEditGroups(keys: string[]): Promise<void> {
  const addEntry = useSessionStore.getState().addConsoleEntry
  const addHistory = useSessionStore.getState().addInputHistory
  const spatial = useSpatialStore.getState()
  const geo = useGeometryEditStore.getState()

  for (const key of keys) {
    const edits = spatial.pendingGeometryEdits[key]
    const meta = spatial.pendingEditMeta[key]
    if (!edits?.length || !meta) continue

    if (meta.source === 'database') {
      const layer = meta.layerId ? spatial.layers.find((l) => l.id === meta.layerId) : undefined
      if (!layer?.tileSource) continue
      const geomEdits = edits.filter(
        (e): e is PendingGeometryEdit & { wkt: string } =>
          (e.kind ?? 'geometry') === 'geometry' && typeof e.wkt === 'string'
      )
      if (geomEdits.length > 0) {
        const info = { handle: layer.tileSource.handle, name: layer.tileSource.name }
        const res = await rClient.datasetUpdateGeometry(
          info,
          // wktTrue: exact curved WKT stored in the _rgeo_wkt_true
          // companion column (lossless curves in the database).
          geomEdits.map((e) => ({ rowId: e.rowId, wkt: e.wkt, wktTrue: e.wktTrue }))
        )
        if (!res.success && res.error) {
          addEntry('error', res.error)
          continue // keep the group staged so the user can retry
        }
        addEntry(
          'output',
          `[Rgeo] Saved ${res.applied ?? geomEdits.length} geometry edit(s) to '${info.name}'.\n`
        )
      }
      spatial.clearPendingGeometryEdits(key)
      // Force the next viewport fetch to re-pull from the DB — the saved
      // edits are now authoritative there.
      spatial.bumpTileCacheVersion(layer.id)
    } else {
      // Staged edits carry WKT (curve-preserving for sf columns); fall
      // back to densifying the GeoJSON for legacy staged edits.
      const geomEdits = edits
        .filter((e) => (e.kind ?? 'geometry') === 'geometry')
        .map((e) => ({
          row: e.rowId,
          wkt: e.wkt ?? (e.geometry ? geometryToWKT(e.geometry) : null)
        }))
        .filter((e): e is { row: number; wkt: string } => typeof e.wkt === 'string')
      if (geomEdits.length > 0) {
        const code = buildBatchedGeometryRCode(
          { accessPath: meta.accessPath, columnName: meta.columnName, colLib: meta.colLib },
          geomEdits
        )
        if (!code) {
          addEntry('error', `Cannot generate save code for '${meta.accessPath}'.`)
          continue
        }
        addEntry('input', code)
        addHistory(code)
        try {
          const res = await rClient.execute(code)
          if (!res.success) {
            if (res.error) addEntry('error', res.error)
            continue // keep staged for retry
          }
        } catch (e) {
          addEntry('error', String(e))
          continue
        }
        // Patch the edited geometry cells directly in the open data viewer
        // (targeted, no re-fetch), then also fire the broad refresh as a
        // fallback for anything the targeted update can't reach.
        triggerDataViewerCellUpdate(
          meta.accessPath,
          meta.envName,
          geomEdits.map((e) => ({
            rowIdx: e.row,
            columnName: meta.columnName,
            value: wktToCellDisplay(e.wkt)
          }))
        )
        triggerDataViewerRefresh(meta.accessPath, meta.envName)
      }
      // Row-adds are already applied in R — clearing the group finalizes them.
      spatial.clearPendingGeometryEdits(key)
    }
    geo.clearCommitsForGroup(key)
  }

  // "Ignore until next save" has run its course — the attribute popup
  // returns for features drawn after this save.
  geo.setAttributePromptSnoozed(false)
}

/** Drop the staged edits of each group, restoring the pre-edit geometry. */
export async function discardEditGroups(keys: string[]): Promise<void> {
  const addEntry = useSessionStore.getState().addConsoleEntry
  const addHistory = useSessionStore.getState().addInputHistory
  const spatial = useSpatialStore.getState()
  const geo = useGeometryEditStore.getState()

  for (const key of keys) {
    const edits = spatial.pendingGeometryEdits[key]
    const meta = spatial.pendingEditMeta[key]
    if (!edits?.length || !meta) continue

    // End an active drawing session on this object before pulling rows
    // out from under it.
    const session = selectActiveSession(geo)
    if (session && session.accessPath === meta.accessPath && session.envName === meta.envName) {
      geo.stopEditing()
    }

    // Rejecting a memory group also deletes the rows that were appended
    // during the session (they only exist because of these edits).
    const rowAdds = edits.filter((e) => e.kind === 'row-add').map((e) => e.rowId)
    if (meta.source === 'memory' && rowAdds.length > 0) {
      const code = buildDeleteRowsRCode(meta.accessPath, rowAdds)
      addEntry('input', code)
      addHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) addEntry('error', res.error)
      } catch (e) {
        addEntry('error', String(e))
      }
      if (meta.layerId) spatial.removeLayerFeatures(meta.layerId, rowAdds)
      triggerDataViewerRefresh(meta.accessPath, meta.envName)
    }

    // Restore pre-edit geometry on the map and drop the queue.
    spatial.discardPendingGeometryEdits(key)
    geo.clearCommitsForGroup(key)
  }
}
