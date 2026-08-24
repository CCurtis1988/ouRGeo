import { describe, it, expect } from 'vitest'
import { layerCenter } from './layer-center'
import type { SpatialLayer } from '@/store/spatial'

const vectorLayer = (features: unknown[]): SpatialLayer => ({
  geojson: { type: 'FeatureCollection', features },
} as unknown as SpatialLayer)

describe('layerCenter', () => {
  it('centers a vector layer from its feature coordinates (any nesting)', () => {
    const layer = vectorLayer([
      { geometry: { type: 'Point', coordinates: [-90, 40] } },
      { geometry: { type: 'Polygon', coordinates: [[[-88, 42], [-88, 44], [-86, 44], [-88, 42]]] } },
    ])
    expect(layerCenter(layer)).toEqual([-88, 42])
  })

  it('uses the registered bounds for raster layers', () => {
    const layer = {
      kind: 'raster',
      raster: { bounds: [-100, 30, -90, 40] },
      geojson: { type: 'FeatureCollection', features: [] },
    } as unknown as SpatialLayer
    expect(layerCenter(layer)).toEqual([-95, 35])
  })

  it('returns null for layers with no extent', () => {
    expect(layerCenter(vectorLayer([]))).toBeNull()
  })
})
