import type { DrawTool, DrawPointerEvent, DrawToolContext } from '../types'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { geometryFamily, layerFamily } from '@/lib/geometry-family'
import { loadDraftForRow } from '../load-draft'
import { hitTestFeature } from '../hit-test'

/**
 * Feature-selection tool: click a rendered feature to load it into an
 * editing session and switch to the edit-vertices tool. Rows that may hold
 * curved geometry fetch their true WKT from R first, so arcs come back as
 * editable arc segments rather than the linearized vertex cloud.
 */
export const selectTool: DrawTool = {
  id: 'select',

  cursor: () => 'pointer',

  onClick(e: DrawPointerEvent, ctx: DrawToolContext) {
    const map = ctx.getMap()
    if (!map) return
    const hit = hitTestFeature(map, e.point)
    if (!hit?.feature.geometry) return
    const { layer, rowIdx, feature } = hit

    void (async () => {
      const loaded = await loadDraftForRow({
        name: layer.name,
        envName: layer.envName,
        column: layer.columnName || undefined,
        // db layers key rows by primary-key value (= feature.id); in-memory
        // layers by array index
        row: layer.tileSource ? Number(feature.id) : rowIdx,
        typeString: layer.geometryType,
        fallbackGeometry: feature.geometry as GeoJSON.Geometry,
        dbSource: layer.tileSource
          ? { handle: layer.tileSource.handle, name: layer.tileSource.name }
          : undefined
      })
      if (!loaded) return

      // Family preference: parsed WKT > clicked feature's (linearized)
      // GeoJSON type > layer type string.
      const geometryType =
        loaded.family ??
        geometryFamily(feature.geometry!.type) ??
        layerFamily(layer.geometryType)
      if (!geometryType) return

      const store = useGeometryEditStore.getState()
      store.startEditing({
        accessPath: layer.name,
        envName: layer.envName,
        columnName: layer.columnName,
        colLib: layer.colLib,
        geometryType,
        currentRow: rowIdx,
        totalRows: rowIdx + 1,
        draft: loaded.draft,
        activePath: { part: Math.max(0, loaded.draft.parts.length - 1), ring: 0 },
        originalGeometry: feature.geometry as GeoJSON.Geometry
      })
      store.setActiveTool('edit-vertices')
    })()
  }
}
