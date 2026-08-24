import { describe, it, expect } from 'vitest'
import {
  geometryFamily,
  layerFamily,
  familyIsPolygon,
  familyIsLine
} from './geometry-family'

describe('geometryFamily', () => {
  it('passes straight families through', () => {
    expect(geometryFamily('LINESTRING')).toBe('LINESTRING')
    expect(geometryFamily('MultiPolygon')).toBe('MULTIPOLYGON')
    expect(geometryFamily('Point')).toBe('POINT')
  })

  it('normalizes curve classes to their straight family', () => {
    expect(geometryFamily('CIRCULARSTRING')).toBe('LINESTRING')
    expect(geometryFamily('COMPOUNDCURVE')).toBe('LINESTRING')
    expect(geometryFamily('MULTICURVE')).toBe('MULTILINESTRING')
    expect(geometryFamily('CURVEPOLYGON')).toBe('POLYGON')
    expect(geometryFamily('MULTISURFACE')).toBe('MULTIPOLYGON')
  })

  it('strips the sfc_ prefix (column classes)', () => {
    expect(geometryFamily('sfc_COMPOUNDCURVE')).toBe('LINESTRING')
    expect(geometryFamily('sfc_POINT')).toBe('POINT')
  })

  it('returns null for ambiguous containers and unknowns', () => {
    expect(geometryFamily('GEOMETRY')).toBeNull()
    expect(geometryFamily('sfc_GEOMETRY')).toBeNull()
    expect(geometryFamily('GEOMETRYCOLLECTION')).toBeNull()
    expect(geometryFamily('banana')).toBeNull()
  })
})

describe('layer type-list helpers', () => {
  it('layerFamily picks the first concrete family', () => {
    expect(layerFamily('COMPOUNDCURVE, LINESTRING')).toBe('LINESTRING')
    expect(layerFamily('GEOMETRYCOLLECTION')).toBeNull()
  })

  it('familyIsPolygon matches curve polygons and mixed lists', () => {
    expect(familyIsPolygon('CURVEPOLYGON')).toBe(true)
    expect(familyIsPolygon('MULTISURFACE, POLYGON')).toBe(true)
    expect(familyIsPolygon('CIRCULARSTRING')).toBe(false)
  })

  it('familyIsLine gives polygons precedence on mixed layers', () => {
    expect(familyIsLine('COMPOUNDCURVE')).toBe(true)
    expect(familyIsLine('MULTICURVE, LINESTRING')).toBe(true)
    expect(familyIsLine('COMPOUNDCURVE, CURVEPOLYGON')).toBe(false)
    expect(familyIsLine('POINT')).toBe(false)
  })
})
