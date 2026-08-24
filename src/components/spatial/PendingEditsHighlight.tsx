import React from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { useSpatialStore } from '@/store/spatial'
import { useThemeStore } from '@/store/theme'
import { THEMES } from '@/lib/themes'
import type { FeatureCollection, Feature } from 'geojson'

/**
 * Dashed outline over every feature with unsaved (staged) geometry — shows
 * exactly which edits Save Edits will write.
 */
export function PendingEditsHighlight(): React.ReactElement | null {
  const pendingGeometryEdits = useSpatialStore((s) => s.pendingGeometryEdits)
  const pendingEditMeta = useSpatialStore((s) => s.pendingEditMeta)
  const currentTheme = useThemeStore((s) => s.current)
  const { success } = THEMES[currentTheme]?.palette ?? THEMES.dark.palette

  const features: Feature[] = []
  for (const [key, edits] of Object.entries(pendingGeometryEdits)) {
    const meta = pendingEditMeta[key]
    if (!meta?.layerId) continue // off-map objects are shown via DrawingLayer
    for (const e of edits) {
      if (!e.geometry) continue
      features.push({ type: 'Feature', properties: {}, geometry: e.geometry })
    }
  }

  if (features.length === 0) return null
  const geojson: FeatureCollection = { type: 'FeatureCollection', features }

  return (
    <Source id="pending-edits-highlight" type="geojson" data={geojson}>
      <Layer
        id="pending-edits-outline"
        type="line"
        paint={{
          'line-color': success,
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9
        }}
      />
      <Layer
        id="pending-edits-points"
        type="circle"
        filter={['==', ['geometry-type'], 'Point']}
        paint={{
          'circle-radius': 9,
          'circle-color': 'transparent',
          'circle-stroke-color': success,
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.9
        }}
      />
    </Source>
  )
}
