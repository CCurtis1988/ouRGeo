import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import type maplibregl from 'maplibre-gl'
import { useGeometryEditStore } from '@/store/geometryEdit'
import { useSpatialStore } from '@/store/spatial'
import type { SpatialLayer } from '@/store/spatial'
import { getEffectiveSym } from '@/lib/layer-symbology'

/** Layers visible in the current session context (mirrors MapView's filtering). */
export function candidateLayers(): SpatialLayer[] {
  const geo = useGeometryEditStore.getState()
  const all = useSpatialStore.getState().layers
  const ns = geo.namedSessions.find((n) => n.id === geo.activeSessionId)
  if (!ns || ns.session === null) return all
  return all.filter((l) => ns.layerIds.includes(l.id))
}

/** The maplibre style-layer ids that can be hit-tested for a spatial layer. */
export function hitLayerIds(layers: SpatialLayer[]): string[] {
  return layers.flatMap((l) => {
    const gt = l.geometryType.toUpperCase()
    if (familyIsPolygon(gt)) return [`${l.id}-fill`, `${l.id}-border-line`]
    if (familyIsLine(gt)) return [`${l.id}-fill-line`]
    const shape = getEffectiveSym(l).pointShape
    return [shape === 'circle' ? `${l.id}-circle` : `${l.id}-symbol`]
  })
}

export interface FeatureHit {
  layer: SpatialLayer
  rowIdx: number
  feature: GeoJSON.Feature
}

/** Hit-test rendered features around a screen point (small bbox for line/point tolerance). */
export function hitTestFeature(
  map: maplibregl.Map,
  point: { x: number; y: number },
  pad = 6
): FeatureHit | null {
  const layers = candidateLayers()
  const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad]
  ]
  const hits = map.queryRenderedFeatures(bbox, { layers: hitLayerIds(layers) })
  if (!hits.length) return null
  const hit = hits[0]
  const layer = layers.find((l) => l.id === hit.source)
  if (!layer) return null

  // For in-memory layers, feature.id is the array index. For db-backed
  // layers it is the underlying primary key — locate the feature by id
  // either way.
  const rawId = hit.id
  const featureId = typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : NaN
  if (!Number.isFinite(featureId)) return null
  const rowIdx = layer.geojson.features.findIndex((f) => f.id === featureId)
  if (rowIdx < 0) return null
  const feature = layer.geojson.features[rowIdx]
  if (!feature?.geometry) return null
  return { layer, rowIdx, feature }
}
