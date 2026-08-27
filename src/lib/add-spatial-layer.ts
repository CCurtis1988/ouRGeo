// Turning an R spatial object into a map layer.
//
// Extracted from AddFeaturesDialog, which was the only thing that knew how:
// vectors come over as GeoJSON from /spatial/geojson, rasters are registered
// with the tile engine instead, and only vectors join a geometry-edit session.
// The dialog still owns choosing WHICH objects; this owns adding one.
//
// Pulled out so the AI assistant can add a layer the same way the dialog does —
// same tile registration, same session binding, same bbox — rather than through
// a second, subtly different code path.

import { rClient } from '@/lib/r-client'
import { createRasterLayerInfo, rasterLayerDraft } from '@/lib/raster-layers'
import { useSpatialStore } from '@/store/spatial'
import { useGeometryEditStore } from '@/store/geometryEdit'

export type Bbox = [number, number, number, number]

/** Lon/lat extent of any GeoJSON, or null when it carries no coordinates. */
export function computeBbox(
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry
): Bbox | null {
  const coords: number[][] = []

  function extractCoords(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return
    const g = obj as Record<string, unknown>
    if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
      for (const f of g.features) extractCoords(f)
    } else if (g.type === 'Feature' && g.geometry) {
      extractCoords(g.geometry)
    } else if (g.coordinates) {
      flattenCoords(g.coordinates as unknown)
    } else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const gg of g.geometries) extractCoords(gg)
    }
  }

  function flattenCoords(c: unknown): void {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') coords.push(c as number[])
    else for (const item of c) flattenCoords(item)
  }

  extractCoords(geojson)
  if (coords.length === 0) return null

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** Merge two extents, either of which may be absent. */
export function unionBbox(a: Bbox | null, b: Bbox | null): Bbox | null {
  if (!a) return b ? [...b] : null
  if (!b) return [...a]
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export interface AddedLayer {
  layerId: string
  name: string
  kind: 'vector' | 'raster'
  bbox: Bbox | null
}

export interface SpatialObjectRef {
  name: string
  envName: string
  /** sf / sfc / sfg / SpatRaster / geos_geometry … */
  class: string
  geometryType?: string
  sfColumn?: string | null
}

/**
 * Add one R spatial object to the map.
 *
 * Throws on failure — callers report it their own way (the dialog collects
 * failures into one message, the AI action turns it into a tool result).
 */
export async function addSpatialLayer(obj: SpatialObjectRef): Promise<AddedLayer> {
  const spatial = useSpatialStore.getState()

  if (obj.class === 'SpatRaster') {
    // Rasters are served as tiles, not GeoJSON, and are not editable features,
    // so they never join a geometry-edit session.
    const info = await createRasterLayerInfo(obj.name, obj.envName)
    const layerId = spatial.addLayer(rasterLayerDraft(obj.name, obj.envName, info))
    return { layerId, name: obj.name, kind: 'raster', bbox: info.bounds }
  }

  const res = await rClient.getSpatialGeoJSON(obj.name, obj.envName)
  if (!res.success || !res.geojson) {
    throw new Error(res.error ?? 'no geometry returned')
  }
  const geojson = typeof res.geojson === 'string' ? JSON.parse(res.geojson) : res.geojson

  const layerId = spatial.addLayer({
    name: obj.name,
    envName: obj.envName,
    geometryType: obj.geometryType ?? 'Unknown',
    geojson,
    colLib: (obj.class === 'sf' || obj.class === 'sfc' || obj.class === 'sfg') ? 'sf' : 'geos',
    columnName: obj.sfColumn ?? 'geometry',
  })

  const edit = useGeometryEditStore.getState()
  if (!edit.activeSessionId) edit.createNamedSession('Default')
  useGeometryEditStore.getState().addLayerToActiveSession(layerId)

  return { layerId, name: obj.name, kind: 'vector', bbox: computeBbox(geojson) }
}

/** Add several objects, collecting per-object failures rather than aborting. */
export async function addSpatialLayers(objs: SpatialObjectRef[]): Promise<{
  added: AddedLayer[]
  failures: string[]
  bbox: Bbox | null
}> {
  const added: AddedLayer[] = []
  const failures: string[] = []
  let bbox: Bbox | null = null

  for (const obj of objs) {
    try {
      const layer = await addSpatialLayer(obj)
      added.push(layer)
      bbox = unionBbox(bbox, layer.bbox)
    } catch (e) {
      failures.push(`${obj.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { added, failures, bbox }
}
