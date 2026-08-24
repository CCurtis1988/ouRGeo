// Center of a spatial layer in EPSG:4326 — used to prefill lat/lng query
// params in the Data Connector from data already on the map.

import type { SpatialLayer } from '@/store/spatial'

interface Acc { minX: number; minY: number; maxX: number; maxY: number; any: boolean }

// GeoJSON coordinate arrays nest per geometry type; a [number, number, ...]
// prefix is a position, anything else is a container to recurse into.
function walkCoords(c: unknown, acc: Acc): void {
  if (!Array.isArray(c)) return
  if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    if (c[0] < acc.minX) acc.minX = c[0]
    if (c[0] > acc.maxX) acc.maxX = c[0]
    if (c[1] < acc.minY) acc.minY = c[1]
    if (c[1] > acc.maxY) acc.maxY = c[1]
    acc.any = true
    return
  }
  for (const child of c) walkCoords(child, acc)
}

function walkGeometry(g: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined, acc: Acc): void {
  if (!g) return
  if (g.type === 'GeometryCollection') {
    for (const child of g.geometries ?? []) walkGeometry(child as never, acc)
    return
  }
  walkCoords(g.coordinates, acc)
}

/** 4326 [lng, lat] center of a layer, or null when it has no extent yet. */
export function layerCenter(layer: SpatialLayer): [number, number] | null {
  // Rasters and not-yet-streamed DB layers carry an explicit 4326 bbox.
  const bbox = layer.kind === 'raster' && layer.raster
    ? layer.raster.bounds
    : layer.geojson?.features?.length
      ? null
      : layer.tileSource?.fullBbox ?? null
  if (bbox) return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]

  const acc: Acc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, any: false }
  for (const f of layer.geojson?.features ?? []) walkGeometry(f.geometry as never, acc)
  if (!acc.any) return null
  return [(acc.minX + acc.maxX) / 2, (acc.minY + acc.maxY) / 2]
}
