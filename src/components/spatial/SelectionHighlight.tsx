import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { useSpatialStore } from '@/store/spatial'
import { useSelectionStore } from '@/store/selection'
import { useIdentifyStore } from '@/store/identify'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

interface SelectionHighlightProps {
  lassoPoints: [number, number][]
}

export function SelectionHighlight({ lassoPoints }: SelectionHighlightProps): React.ReactElement | null {
  const layers = useSpatialStore((s) => s.layers).filter((l) => l.visible)
  const selections = useSelectionStore((s) => s.selections)
  const pending = useSelectionStore((s) => s.pending)
  const identify = useIdentifyStore((s) => s.identify)

  const features: Feature[] = []

  // ── Active identify target (info popup open) ──────────────────────────────
  if (identify) {
    const t = identify.targets[identify.index]
    if (t && t.kind === 'vector' && t.featureIndex !== undefined) {
      const layer = layers.find((l) => l.id === t.layerId)
      const feature = layer?.geojson.features[t.featureIndex]
      if (layer && feature?.geometry) {
        const gt = layer.geometryType.toUpperCase()
        const isPoint = !familyIsPolygon(gt) && !familyIsLine(gt)
        features.push({
          type: 'Feature',
          properties: { kind: isPoint ? 'identify-point' : 'identify-shape' },
          geometry: feature.geometry,
        })
      }
    }
  }

  // ── Pending candidates (popup open, checked items only) ──────────────────
  if (pending) {
    pending.candidates.forEach((c, i) => {
      if (!pending.checked[i]) return
      const layer = layers.find((l) => l.id === c.layerId)
      const feature = layer?.geojson.features[c.featureIndex]
      if (!layer || !feature?.geometry) return
      const gt = layer.geometryType.toUpperCase()
      const isPoint = !familyIsPolygon(gt) && !familyIsLine(gt)
      features.push({
        type: 'Feature',
        properties: { kind: isPoint ? 'pending-point' : 'pending-shape' },
        geometry: feature.geometry,
      })
    })
  }

  // ── Lasso polygon (while drawing) ────────────────────────────────────────
  if (lassoPoints.length >= 2) {
    const closed = [...lassoPoints, lassoPoints[0]]
    features.push({
      type: 'Feature',
      properties: { kind: 'lasso' },
      geometry: {
        type: lassoPoints.length >= 3 ? 'Polygon' : 'LineString',
        coordinates: lassoPoints.length >= 3 ? [closed] : lassoPoints,
      } as Geometry,
    })
  }

  // ── Selected feature highlights ───────────────────────────────────────────
  for (const layer of layers) {
    const indices = selections[`${layer.name}::${layer.envName}`] ?? []
    if (indices.length === 0) continue

    const gt = layer.geometryType.toUpperCase()
    const isPoint = !familyIsPolygon(gt) && !familyIsLine(gt)

    for (const idx of indices) {
      const feature = layer.geojson.features[idx]
      if (!feature?.geometry) continue
      features.push({
        type: 'Feature',
        properties: { kind: isPoint ? 'sel-point' : 'sel-shape' },
        geometry: feature.geometry,
      })
    }
  }

  if (features.length === 0) return null

  const geojson: FeatureCollection = { type: 'FeatureCollection', features }

  return (
    <Source id="selection-highlight" type="geojson" data={geojson} tolerance={0}>
      {/* Lasso fill */}
      <Layer
        id="sel-lasso-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'lasso']}
        paint={{ 'fill-color': '#22d3ee', 'fill-opacity': 0.12 }}
      />
      {/* Lasso outline (dashed cyan) */}
      <Layer
        id="sel-lasso-line"
        type="line"
        filter={['==', ['get', 'kind'], 'lasso']}
        paint={{
          'line-color': '#22d3ee',
          'line-width': 1.5,
          'line-dasharray': [4, 2],
        }}
      />
      {/* Selected polygon / line highlight */}
      <Layer
        id="sel-shape-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'sel-shape']}
        paint={{ 'fill-color': '#4493f8', 'fill-opacity': 0.25 }}
      />
      <Layer
        id="sel-shape-line"
        type="line"
        filter={['==', ['get', 'kind'], 'sel-shape']}
        paint={{ 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.9 }}
      />
      {/* Selected point highlight */}
      <Layer
        id="sel-point-circle"
        type="circle"
        filter={['==', ['get', 'kind'], 'sel-point']}
        paint={{
          'circle-radius': 8,
          'circle-color': 'transparent',
          'circle-stroke-color': '#4493f8',
          'circle-stroke-width': 2.5,
        }}
      />
      {/* Pending (unconfirmed) candidate highlights — dashed cyan */}
      <Layer
        id="sel-pending-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'pending-shape']}
        paint={{ 'fill-color': '#22d3ee', 'fill-opacity': 0.15 }}
      />
      <Layer
        id="sel-pending-line"
        type="line"
        filter={['==', ['get', 'kind'], 'pending-shape']}
        paint={{
          'line-color': '#22d3ee',
          'line-width': 1.5,
          'line-dasharray': [4, 2],
        }}
      />
      <Layer
        id="sel-pending-circle"
        type="circle"
        filter={['==', ['get', 'kind'], 'pending-point']}
        paint={{
          'circle-radius': 8,
          'circle-color': 'transparent',
          'circle-stroke-color': '#22d3ee',
          'circle-stroke-width': 2,
        }}
      />
      {/* Active identify target — amber */}
      <Layer
        id="sel-identify-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'identify-shape']}
        paint={{ 'fill-color': '#d29922', 'fill-opacity': 0.18 }}
      />
      <Layer
        id="sel-identify-line"
        type="line"
        filter={['==', ['get', 'kind'], 'identify-shape']}
        paint={{ 'line-color': '#d29922', 'line-width': 2.5, 'line-opacity': 0.95 }}
      />
      <Layer
        id="sel-identify-circle"
        type="circle"
        filter={['==', ['get', 'kind'], 'identify-point']}
        paint={{
          'circle-radius': 9,
          'circle-color': 'transparent',
          'circle-stroke-color': '#d29922',
          'circle-stroke-width': 2.5,
        }}
      />
    </Source>
  )
}
