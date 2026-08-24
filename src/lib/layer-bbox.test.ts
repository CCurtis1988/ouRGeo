import { describe, it, expect } from 'vitest'
import type { Feature } from 'geojson'
import { featuresBbox, padBbox, layerExtentBbox } from './layer-bbox'
import type { SpatialLayer } from '@/store/spatial'

const poly = (coords: number[][]): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [coords] },
})
const point = (x: number, y: number): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [x, y] },
})

describe('padBbox', () => {
  it('expands a degenerate box to the minimum span, centered', () => {
    expect(padBbox([5, 5, 5, 5], 0.01)).toEqual([4.995, 4.995, 5.005, 5.005])
  })
  it('leaves a box wider than minSpan untouched', () => {
    expect(padBbox([0, 0, 10, 10], 0.01)).toEqual([0, 0, 10, 10])
  })
})

describe('featuresBbox', () => {
  it('encloses a polygon', () => {
    const bb = featuresBbox([poly([[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]])])
    expect(bb).toEqual([0, 0, 2, 3])
  })
  it('encloses multiple features', () => {
    const bb = featuresBbox([point(-80, 35), point(-75, 36)])
    expect(bb).toEqual([-80, 35, -75, 36])
  })
  it('pads a single point to the min span', () => {
    const bb = featuresBbox([point(10, 20)], 0.01)
    expect(bb).toEqual([9.995, 19.995, 10.005, 20.005])
  })
  it('ignores null/geometryless features', () => {
    expect(featuresBbox([null, undefined, { type: 'Feature', properties: {}, geometry: null } as unknown as Feature])).toBeNull()
  })
  it('returns null for no features', () => {
    expect(featuresBbox([])).toBeNull()
  })
})

describe('layerExtentBbox', () => {
  it('uses raster bounds for a raster layer', () => {
    const layer = { kind: 'raster', raster: { bounds: [1, 2, 3, 4] } } as unknown as SpatialLayer
    expect(layerExtentBbox(layer)).toEqual([1, 2, 3, 4])
  })
  it('falls back to the tile fullBbox when no features are streamed', () => {
    const layer = { kind: 'vector', geojson: { features: [] }, tileSource: { fullBbox: [10, 20, 30, 40] } } as unknown as SpatialLayer
    expect(layerExtentBbox(layer)).toEqual([10, 20, 30, 40])
  })
  it('derives from features for a vector layer', () => {
    const layer = { kind: 'vector', geojson: { features: [poly([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])] } } as unknown as SpatialLayer
    expect(layerExtentBbox(layer)).toEqual([0, 0, 1, 1])
  })
})
