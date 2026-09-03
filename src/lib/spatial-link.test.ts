import { describe, it, expect } from 'vitest'
import {
  layerShowsObject, layersForObject, layersInView, viewerTargetForLayer, dbSpatialRefFor,
} from './spatial-link'
import type { SpatialLayer } from '@/store/spatial'
import type { REnvironmentInfo, RObjectInfo } from '@/lib/r-client'

function layer(patch: Partial<SpatialLayer> & { id: string; name: string }): SpatialLayer {
  return {
    envName: '.GlobalEnv',
    geometryType: 'POLYGON',
    geojson: { type: 'FeatureCollection', features: [] },
    visible: true,
    color: '#4493f8',
    opacity: 1,
    colLib: 'sf',
    columnName: 'geometry',
    ...patch,
  }
}

function object(patch: Partial<RObjectInfo> & { name: string; class: string }): RObjectInfo {
  return {
    type: 'list', size: 0, dimensions: '', isEnvironment: false, isList: false,
    ...patch,
  } as RObjectInfo
}

function env(name: string, objects: RObjectInfo[]): REnvironmentInfo {
  return { name, isSearchPath: false, objects }
}

describe('is the object already on the map', () => {
  const roads = { name: 'roads', envName: '.GlobalEnv' }

  it('matches on name and environment', () => {
    expect(layerShowsObject(layer({ id: '1', name: 'roads' }), roads)).toBe(true)
    expect(layerShowsObject(layer({ id: '1', name: 'rivers' }), roads)).toBe(false)
    expect(layerShowsObject(layer({ id: '1', name: 'roads', envName: 'pkg:sf' }), roads)).toBe(false)
  })

  it('matches a database layer, which carries no environment', () => {
    // Otherwise a .Rgeo dataset sent to the map would never be recognised as
    // being there, and the user would be offered a duplicate every time.
    expect(layerShowsObject(layer({ id: '1', name: 'roads', envName: '' }), roads)).toBe(true)
    expect(layerShowsObject(layer({ id: '1', name: 'roads' }), { name: 'roads', envName: '' })).toBe(true)
  })

  it('finds every layer drawn from one object', () => {
    const layers = [
      layer({ id: '1', name: 'roads' }),
      layer({ id: '2', name: 'rivers' }),
      layer({ id: '3', name: 'roads' }),
    ]
    expect(layersForObject(layers, roads).map((l) => l.id)).toEqual(['1', '3'])
  })

  it('asks only about the layers on show', () => {
    const layers = [layer({ id: '1', name: 'roads' }), layer({ id: '2', name: 'roads' })]
    expect(layersInView(layers, null)).toHaveLength(2)
    expect(layersInView(layers, ['2']).map((l) => l.id)).toEqual(['2'])
    expect(layersForObject(layersInView(layers, ['2']), roads).map((l) => l.id)).toEqual(['2'])
  })
})

describe('opening a layer in the data viewer', () => {
  const environments = [
    env('.GlobalEnv', [object({ name: 'roads', class: 'sf' }), object({ name: 'f', class: 'function' })]),
    env('other', [object({ name: 'roads', class: 'data.frame' })]),
  ]

  it('resolves the object, preferring the layer’s own environment', () => {
    const t = viewerTargetForLayer(layer({ id: '1', name: 'roads', envName: 'other' }), environments)
    expect(t).toMatchObject({ ok: true, envName: 'other', objectClass: 'data.frame', accessPath: 'roads' })
  })

  it('refuses a raster, and says what to open instead', () => {
    const t = viewerTargetForLayer(
      layer({ id: '1', name: 'dem', kind: 'raster' }), environments,
    )
    expect(t.ok).toBe(false)
    if (!t.ok) {
      expect(t.short).toMatch(/attribute table/)
      expect(t.reason).toMatch(/symbology/)
    }
  })

  it('refuses a class the data viewer cannot show', () => {
    const t = viewerTargetForLayer(layer({ id: '1', name: 'f' }), environments)
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.short).toMatch(/function/)
  })

  it('still opens an object the environment listing has not caught up with', () => {
    // A layer added seconds ago, or one reached through an expression: the
    // data viewer reports a genuinely missing object itself, with a Retry, so
    // refusing here would only block the case that works.
    const t = viewerTargetForLayer(layer({ id: '1', name: 'just_made' }), environments)
    expect(t).toMatchObject({ ok: true, envName: '.GlobalEnv', objectClass: 'sf' })
  })

  it('refuses a database layer whose proxy is gone', () => {
    const t = viewerTargetForLayer(layer({ id: '1', name: 'gone', envName: '' }), environments)
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.reason).toMatch(/Reconnect/)
  })
})

describe('database-backed sends', () => {
  const environments = [
    env('.GlobalEnv', [
      object({ name: 'plain', class: 'sf' }),
      object({
        name: 'parcels', class: 'tbl_dbi',
        rgeoProxy: {
          handle: 'h1', name: 'parcels_2024', kind: 'sf',
          geometryType: 'POLYGON', geometryColumn: 'geom', pkColumn: 'fid', crs: 'EPSG:4326',
        },
      }),
      object({
        name: 'tabular', class: 'tbl_dbi',
        rgeoProxy: { handle: 'h1', name: 'tabular', kind: 'data.frame' },
      }),
    ]),
  ]

  it('carries the whole proxy, not just its handle', () => {
    expect(dbSpatialRefFor(environments, 'parcels', '.GlobalEnv')).toEqual({
      name: 'parcels', handle: 'h1', proxyName: 'parcels_2024',
      geometryType: 'POLYGON', geometryColumn: 'geom', pkColumn: 'fid', crs: 'EPSG:4326',
    })
  })

  it('is null for in-memory and non-spatial datasets', () => {
    expect(dbSpatialRefFor(environments, 'plain', '.GlobalEnv')).toBeNull()
    expect(dbSpatialRefFor(environments, 'tabular', '.GlobalEnv')).toBeNull()
    expect(dbSpatialRefFor(environments, 'missing', '.GlobalEnv')).toBeNull()
  })
})
