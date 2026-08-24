import { useCallback } from 'react'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import type { ColLib, GeometryType } from '@/store/geometryEdit'
import { useSpatialStore, pendingGroupKey } from '@/store/spatial'
import type { PendingEditMeta } from '@/store/spatial'
import { triggerDataViewerRefresh } from '@/lib/data-viewer-refresh'

export interface AddFeatureParams {
  accessPath: string
  envName: string
  columnName: string
  colLib: ColLib
  geometryType: GeometryType
  /** Current row count — the new feature becomes row totalRows (0-based). */
  totalRows: number
}

/**
 * Row-append actions for the "add feature" workflow: the grid's ＋ Add
 * Feature button, and the ribbon's inline "add another?" prompt that
 * replaces the old modal dialog after the last row's geometry commits.
 *
 * Rows are appended in R immediately (the grid reads rows from R); each
 * append is tracked in the pending-edit group + commit log so Save Edits
 * reports it and Ctrl+Z can delete it again.
 */
export function useAddFeature() {
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addHistory = useSessionStore((s) => s.addInputHistory)

  const appendRow = useCallback(
    async (params: {
      accessPath: string
      envName: string
      columnName: string
      colLib: ColLib
      newRowIdx: number
    }): Promise<boolean> => {
      const { accessPath, envName } = params
      const code = `${accessPath}[nrow(${accessPath}) + 1L, ] <- NA`
      addEntry('input', code)
      addHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success) {
          if (res.error) addEntry('error', res.error)
          return false
        }
      } catch (e) {
        addEntry('error', String(e))
        return false
      }

      // Track the append for the Save Edits report and commit-level undo.
      const layers = useSpatialStore.getState().layers
      const baseName = accessPath.split(/[$[]/)[0]
      const layer = layers.find((l) => l.name === baseName && l.envName === envName) ?? null
      const meta: PendingEditMeta = {
        source: layer?.tileSource ? 'database' : 'memory',
        layerId: layer?.id,
        accessPath,
        envName,
        columnName: params.columnName,
        colLib: params.colLib
      }
      useSpatialStore.getState().addPendingGeometryEdit(meta, {
        rowId: params.newRowIdx,
        kind: 'row-add',
        originalGeometry: null
      })
      useGeometryEditStore.getState().logCommit({
        kind: 'row-add',
        groupKey: pendingGroupKey(meta),
        rowId: params.newRowIdx,
        prevPending: null,
        prevGeometry: null,
        accessPath,
        envName
      })

      triggerDataViewerRefresh(accessPath, envName)
      return true
    },
    [addEntry, addHistory]
  )

  /** Accept the pending "add another feature?" prompt: append a row, advance the session to it. */
  const confirmPendingRowAdd = useCallback(async () => {
    const store = useGeometryEditStore.getState()
    const session = selectActiveSession(store)
    if (!session || !store.pendingRowAdd) return
    const ok = await appendRow({
      accessPath: session.accessPath,
      envName: session.envName,
      columnName: session.columnName,
      colLib: session.colLib,
      newRowIdx: session.totalRows
    })
    if (ok) store.resolveRowAdd(true, session.totalRows + 1)
    else store.resolveRowAdd(false, 0)
  }, [appendRow])

  /** Dismiss the pending prompt and end the drawing session. */
  const declinePendingRowAdd = useCallback(() => {
    const store = useGeometryEditStore.getState()
    if (store.pendingRowAdd) store.resolveRowAdd(false, 0)
  }, [])

  /** Append a row and immediately open the spatial editor drawing its geometry. */
  const addFeatureAndDraw = useCallback(
    async (params: AddFeatureParams) => {
      const ok = await appendRow({
        accessPath: params.accessPath,
        envName: params.envName,
        columnName: params.columnName,
        colLib: params.colLib,
        newRowIdx: params.totalRows
      })
      if (!ok) return
      const store = useGeometryEditStore.getState()
      store.setEditMode(false)
      useSpatialStore.getState().ensureOpen()
      store.startEditing({
        accessPath: params.accessPath,
        envName: params.envName,
        columnName: params.columnName,
        colLib: params.colLib,
        geometryType: params.geometryType,
        currentRow: params.totalRows,
        totalRows: params.totalRows + 1,
        originalGeometry: null
      })
    },
    [appendRow]
  )

  return { confirmPendingRowAdd, declinePendingRowAdd, addFeatureAndDraw }
}
