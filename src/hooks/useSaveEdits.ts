import { useCallback, useMemo } from 'react'
import { useSpatialStore } from '@/store/spatial'
import type { PendingEditMeta, PendingGeometryEdit } from '@/store/spatial'
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

export interface PendingEditGroupView {
  key: string
  meta: PendingEditMeta
  displayName: string
  geometryCount: number
  rowAddCount: number
}

/**
 * Summarize the staged edits per object, for the ribbon badge and the Save
 * Edits dialog.
 *
 * Subscribe to the two raw store records (stable references that only change
 * on an actual store write) and derive the group objects in useMemo. Deriving
 * them inside the zustand selector — even with useShallow — returns freshly
 * allocated objects on every getSnapshot call, which React treats as an
 * ever-changing snapshot and re-renders until "Maximum update depth exceeded".
 */
export function usePendingEditGroups(): PendingEditGroupView[] {
  const pendingGeometryEdits = useSpatialStore((s) => s.pendingGeometryEdits)
  const pendingEditMeta = useSpatialStore((s) => s.pendingEditMeta)
  return useMemo(() => {
    const groups: PendingEditGroupView[] = []
    for (const [key, edits] of Object.entries(pendingGeometryEdits)) {
      const meta = pendingEditMeta[key]
      if (!meta || edits.length === 0) continue
      groups.push({
        key,
        meta,
        displayName: meta.accessPath.split('$')[0] || meta.accessPath,
        geometryCount: edits.filter((e) => (e.kind ?? 'geometry') === 'geometry').length,
        rowAddCount: edits.filter((e) => e.kind === 'row-add').length
      })
    }
    return groups
  }, [pendingGeometryEdits, pendingEditMeta])
}

/**
 * Save / discard staged edits per object group. Memory groups write back as
 * one batched R statement echoed to the console; database groups flush via
 * /dataset/update-geometry. Saving or discarding a group is an undo barrier
 * (its commit-log entries are dropped).
 */
export function useSaveEdits() {
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addHistory = useSessionStore((s) => s.addInputHistory)

  const saveGroups = useCallback(
    async (keys: string[]) => {
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
    },
    [addEntry, addHistory]
  )

  const discardGroups = useCallback(
    async (keys: string[]) => {
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
    },
    [addEntry, addHistory]
  )

  return { saveGroups, discardGroups }
}
