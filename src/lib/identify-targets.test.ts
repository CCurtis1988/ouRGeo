import { describe, it, expect } from 'vitest'
import { rasterBoundsHit, buildIdentifyTargets } from './identify-targets'

describe('rasterBoundsHit', () => {
  const bounds: [number, number, number, number] = [-84, 33, -75, 37]
  it('is true inside the bounds', () => {
    expect(rasterBoundsHit(-79, 35, bounds)).toBe(true)
  })
  it('is true on the edge', () => {
    expect(rasterBoundsHit(-84, 33, bounds)).toBe(true)
  })
  it('is false outside the bounds', () => {
    expect(rasterBoundsHit(-90, 35, bounds)).toBe(false)
    expect(rasterBoundsHit(-79, 40, bounds)).toBe(false)
  })
})

describe('buildIdentifyTargets', () => {
  const v = (layerId: string, layerName: string, indices: number[]) => ({
    layerId, layerName, envName: '.GlobalEnv', indices,
  })
  const r = (layerId: string, layerName: string) => ({
    layerId, layerName, envName: '.GlobalEnv',
  })

  it('returns empty for no hits', () => {
    expect(buildIdentifyTargets([], [])).toEqual([])
  })

  it('expands vector hits to one target per feature, in order', () => {
    const t = buildIdentifyTargets([v('l1', 'pts', [3, 7])], [])
    expect(t).toEqual([
      { kind: 'vector', layerId: 'l1', layerName: 'pts', envName: '.GlobalEnv', featureIndex: 3 },
      { kind: 'vector', layerId: 'l1', layerName: 'pts', envName: '.GlobalEnv', featureIndex: 7 },
    ])
  })

  it('places rasters after vectors', () => {
    const t = buildIdentifyTargets([v('l1', 'nc', [0])], [r('l2', 'elev')])
    expect(t.map((x) => x.kind)).toEqual(['vector', 'raster'])
    expect(t[1]).toEqual({ kind: 'raster', layerId: 'l2', layerName: 'elev', envName: '.GlobalEnv' })
  })

  it('handles raster-only hits', () => {
    const t = buildIdentifyTargets([], [r('l2', 'elev')])
    expect(t).toEqual([
      { kind: 'raster', layerId: 'l2', layerName: 'elev', envName: '.GlobalEnv' },
    ])
  })
})
