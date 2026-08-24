import { describe, it, expect } from 'vitest'
import { SnapEngine } from './snap-engine'
import type { SpatialLayer } from '@/store/spatial'
import type { SnapSettings } from '@/store/spatialSettings'

// Synthetic flat projection: 100 px per degree, y axis flipped like screens.
const project = (ll: [number, number]) => ({ x: ll[0] * 100, y: -ll[1] * 100 })
const unproject = (p: [number, number]) => ({ lng: p[0] / 100, lat: -p[1] / 100 })

const allKinds: SnapSettings = {
  kinds: { vertex: true, edge: true, midpoint: true, intersection: true },
  tolerancePx: 15
}

function layerWith(features: GeoJSON.Feature[]): SpatialLayer {
  return {
    id: 'l1',
    name: 'test',
    envName: '.GlobalEnv',
    geometryType: 'LINESTRING',
    geojson: { type: 'FeatureCollection', features },
    visible: true,
    color: '#fff',
    opacity: 1,
    colLib: 'sf',
    columnName: 'geometry'
  }
}

const line = (coords: number[][]): GeoJSON.Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: coords }
})

function engineWith(features: GeoJSON.Feature[]): SnapEngine {
  const e = new SnapEngine()
  e.updateLayers([layerWith(features)])
  return e
}

const at = (lng: number, lat: number) => {
  const p = project([lng, lat])
  return { x: p.x, y: p.y }
}

describe('SnapEngine', () => {
  it('snaps to the nearest vertex with priority over edges', () => {
    const e = engineWith([line([[0, 0], [1, 0]])])
    // Cursor near (0,0) but also near the edge
    const hit = e.query(at(0.05, 0.02), project, unproject, allKinds, null)
    expect(hit).not.toBeNull()
    expect(hit!.type).toBe('vertex')
    expect(hit!.lng).toBeCloseTo(0)
    expect(hit!.lat).toBeCloseTo(0)
  })

  it('snaps to edges and midpoints along a segment', () => {
    const e = engineWith([line([[0, 0], [1, 0]])])
    const edgeHit = e.query(at(0.3, 0.05), project, unproject, allKinds, null)
    expect(edgeHit!.type).toBe('edge')
    expect(edgeHit!.lat).toBeCloseTo(0)

    const midHit = e.query(at(0.5, 0.05), project, unproject, allKinds, null)
    expect(midHit!.type).toBe('midpoint')
    expect(midHit!.lng).toBeCloseTo(0.5)
  })

  it('finds intersections between crossing segments', () => {
    const e = engineWith([
      line([[0, -1], [0, 1]]),
      line([[-1, 0.3], [1, 0.3]])
    ])
    const hit = e.query(at(0.03, 0.33), project, unproject, allKinds, null)
    expect(hit!.type).toBe('intersection')
    expect(hit!.lng).toBeCloseTo(0)
    expect(hit!.lat).toBeCloseTo(0.3)
  })

  it('respects per-kind toggles', () => {
    const e = engineWith([line([[0, 0], [1, 0]])])
    const noVertex: SnapSettings = {
      kinds: { vertex: false, edge: false, midpoint: false, intersection: false },
      tolerancePx: 15
    }
    expect(e.query(at(0, 0), project, unproject, noVertex, null)).toBeNull()

    const edgeOnly: SnapSettings = {
      kinds: { vertex: false, edge: true, midpoint: false, intersection: false },
      tolerancePx: 15
    }
    const hit = e.query(at(0.02, 0.05), project, unproject, edgeOnly, null)
    expect(hit!.type).toBe('edge')
  })

  it('returns null outside the tolerance radius', () => {
    const e = engineWith([line([[0, 0], [1, 0]])])
    expect(e.query(at(0.5, 1), project, unproject, allKinds, null)).toBeNull()
  })

  it('rebuilds lazily only when a layer FeatureCollection changes identity', () => {
    const l = layerWith([line([[0, 0], [1, 0]])])
    const e = new SnapEngine()
    e.updateLayers([l])
    expect(e.query(at(0, 0), project, unproject, allKinds, null)).not.toBeNull()
    // Same identity — nothing changes
    e.updateLayers([l])
    expect(e.query(at(0, 0), project, unproject, allKinds, null)).not.toBeNull()
    // Layer removed — candidates disappear
    e.updateLayers([])
    expect(e.query(at(0, 0), project, unproject, allKinds, null)).toBeNull()
  })
})
