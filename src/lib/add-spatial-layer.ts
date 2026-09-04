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
import { inferGeometryType } from '@/lib/validators'
import { createRasterLayerInfo, rasterLayerDraft } from '@/lib/raster-layers'
import { useSpatialStore } from '@/store/spatial'
import { useGeometryEditStore } from '@/store/geometryEdit'
import {
  isTransientNetworkError, retryOnNetworkError, transportFailureMessage, TransportError,
} from '@/lib/transport-retry'

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

  // Reading the geometry is one HTTP round trip, and a severed connection
  // reports only "Network Error" — which says nothing about the object and
  // sent a local AI model off rebuilding perfectly good geometry. Retry it
  // (a fresh socket is usually all it takes), then say what actually happened.
  let res
  try {
    res = await retryOnNetworkError(() => rClient.getSpatialGeoJSON(obj.name, obj.envName))
  } catch (e) {
    if (isTransientNetworkError(e)) {
      throw new TransportError(transportFailureMessage(`reading the geometry of "${obj.name}"`))
    }
    throw e
  }
  if (!res.success || !res.geojson) {
    throw new Error(res.error ?? 'no geometry returned')
  }
  const geojson = typeof res.geojson === 'string' ? JSON.parse(res.geojson) : res.geojson

  const layerId = spatial.addLayer({
    name: obj.name,
    envName: obj.envName,
    // The Add Features dialog knows the geometry type already (it comes from
    // /spatial/list); the Environment panel and the data viewer do not, so it
    // is read back off the geometry rather than left as 'Unknown' — the legend
    // and the symbology editor both key off it.
    geometryType: obj.geometryType ?? inferGeometryType(geojson),
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

/**
 * A database-backed dataset, as the Environment panel and the data viewer see
 * it: the R variable plus the `rgeoProxy` that says which .Rgeo table it is a
 * lazy view onto.
 */
export interface DbSpatialRef {
  /** The R variable the user is looking at. */
  name: string
  handle: string
  /** The dataset's name inside the .Rgeo file, which need not match. */
  proxyName: string
  geometryType?: string | null
  geometryColumn?: string | null
  pkColumn?: string
  crs?: string | null
}

/**
 * Add one database-backed dataset to the map.
 *
 * Nothing is fetched here: the layer starts with an empty FeatureCollection and
 * fills in from `/dataset/tile` as the map moves (DbSpatialTileLoader). That is
 * also why the extent has to be asked for separately — `requestFitBounds` would
 * otherwise have no features to fit and leave the user staring at the whole
 * world while their data sat in one county.
 */
export async function addDbSpatialLayer(ref: DbSpatialRef): Promise<AddedLayer> {
  const spatial = useSpatialStore.getState()

  const layerId = spatial.addLayer({
    name: ref.name,
    // Deliberately empty: a database layer is not a view onto an object in an
    // R environment, and `envName` is what every "is this object on the map?"
    // check compares. See `layerShowsObject` in spatial-link.ts.
    envName: '',
    geometryType: ref.geometryType ?? 'GEOMETRY',
    geojson: { type: 'FeatureCollection', features: [] },
    colLib: 'sf',
    columnName: ref.geometryColumn ?? 'geometry',
    tileSource: {
      handle: ref.handle,
      name: ref.proxyName,
      geometryColumn: ref.geometryColumn ?? 'geometry',
      pkColumn: ref.pkColumn ?? 'rowid',
      crs: ref.crs ?? null,
    },
  })

  const edit = useGeometryEditStore.getState()
  if (!edit.activeSessionId) edit.createNamedSession('Default')
  useGeometryEditStore.getState().addLayerToActiveSession(layerId)

  const bboxRes = await rClient.datasetBbox({ handle: ref.handle, name: ref.proxyName })
  const bbox = bboxRes.success && bboxRes.bbox ? bboxRes.bbox : null
  if (bbox) spatial.setLayerFullBbox(layerId, bbox)

  return { layerId, name: ref.name, kind: 'vector', bbox }
}
