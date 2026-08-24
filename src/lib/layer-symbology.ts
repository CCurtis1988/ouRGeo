import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import type { SpatialLayer, LayerSymbology } from '@/store/spatial'

/**
 * Returns the data columns available in a layer's GeoJSON properties,
 * with their inferred types (numeric or categorical).
 */
export function getLayerDataColumns(
  layer: SpatialLayer
): { name: string; type: 'numeric' | 'categorical' }[] {
  const first = layer.geojson.features[0]
  if (!first?.properties) return []
  return Object.keys(first.properties).map((name) => ({
    name,
    type: inferColType(layer.geojson.features, name),
  }))
}

function inferColType(
  features: GeoJSON.Feature[],
  col: string
): 'numeric' | 'categorical' {
  for (const f of features) {
    const v = f.properties?.[col]
    if (v !== null && v !== undefined) return typeof v === 'number' ? 'numeric' : 'categorical'
  }
  return 'categorical'
}

/**
 * Returns a fully-resolved LayerSymbology for a layer, filling in any
 * missing fields with sensible defaults based on geometry type.
 */
export function getEffectiveSym(layer: SpatialLayer): LayerSymbology {
  const gt = layer.geometryType.toUpperCase()
  const isPoly = familyIsPolygon(gt)
  const isLine = familyIsLine(gt) && !isPoly
  return {
    fillColor:         layer.symbology?.fillColor         ?? layer.color,
    fillOpacity:       layer.symbology?.fillOpacity       ?? (isPoly ? 0.3 : layer.opacity),
    borderColor:       layer.symbology?.borderColor       ?? (isLine || isPoly ? layer.color : '#ffffff'),
    borderWidth:       layer.symbology?.borderWidth       ?? (isPoly ? 1.5 : isLine ? 0 : 1),
    haloColor:         layer.symbology?.haloColor         ?? layer.color,
    haloStrength:      layer.symbology?.haloStrength      ?? 0,
    pointSize:         layer.symbology?.pointSize         ?? 4,
    pointShape:        layer.symbology?.pointShape        ?? 'circle',
    lineWidth:         layer.symbology?.lineWidth         ?? 2,
    lineDash:          layer.symbology?.lineDash          ?? 'solid',
    fillColorBinding:   layer.symbology?.fillColorBinding,
    borderColorBinding: layer.symbology?.borderColorBinding,
    haloColorBinding:   layer.symbology?.haloColorBinding,
  }
}
