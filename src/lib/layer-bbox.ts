// Bounding-box helpers for zooming the map to a spatial layer, a selection of
// its rows, or a single feature (used by the data viewer's zoom controls).

import type { SpatialLayer } from '@/store/spatial'
import type { Feature } from 'geojson'

export type Bbox = [number, number, number, number] // [west, south, east, north]

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

function walkGeometry(
  g: { type?: string; coordinates?: unknown; geometries?: unknown[] } | null | undefined,
  acc: Acc,
): void {
  if (!g) return
  if (g.type === 'GeometryCollection') {
    for (const child of g.geometries ?? []) walkGeometry(child as never, acc)
    return
  }
  walkCoords(g.coordinates, acc)
}

/**
 * Expand a bbox so each axis spans at least `minSpan` degrees — keeps a single
 * point (or a tiny cluster) from fitting to an extreme zoom. No-op for extents
 * already wider than `minSpan`.
 */
export function padBbox(bbox: Bbox, minSpan: number): Bbox {
  let [w, s, e, n] = bbox
  if (e - w < minSpan) {
    const cx = (w + e) / 2
    w = cx - minSpan / 2
    e = cx + minSpan / 2
  }
  if (n - s < minSpan) {
    const cy = (s + n) / 2
    s = cy - minSpan / 2
    n = cy + minSpan / 2
  }
  return [w, s, e, n]
}

/**
 * 4326 bbox enclosing the given features, or null when none carry coordinates.
 * `minSpan` (default ~0.005° ≈ 500 m) pads degenerate/point extents.
 */
export function featuresBbox(
  features: (Feature | null | undefined)[],
  minSpan = 0.005,
): Bbox | null {
  const acc: Acc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, any: false }
  for (const f of features) walkGeometry(f?.geometry as never, acc)
  if (!acc.any) return null
  return padBbox([acc.minX, acc.minY, acc.maxX, acc.maxY], minSpan)
}

/**
 * Full 4326 extent of a layer: raster/tile layers report an explicit bbox;
 * vector layers derive it from their features. Null when nothing is known yet.
 */
export function layerExtentBbox(layer: SpatialLayer, minSpan = 0.005): Bbox | null {
  if (layer.kind === 'raster' && layer.raster) return layer.raster.bounds
  const features = layer.geojson?.features ?? []
  if (features.length === 0 && layer.tileSource?.fullBbox) return layer.tileSource.fullBbox
  return featuresBbox(features, minSpan)
}
