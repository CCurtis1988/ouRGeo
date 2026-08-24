import { describe, it, expect } from 'vitest'
import type { SpatialLayer, LayerSymbology } from '@/store/spatial'
import { getLayerDataColumns, getEffectiveSym } from './layer-symbology'

const fullSym = (over: Partial<LayerSymbology>): LayerSymbology => ({
  fillColor: '#111111', fillOpacity: 1, borderColor: '#222222', borderWidth: 1,
  haloColor: '#333333', haloStrength: 0, pointSize: 4, pointShape: 'circle',
  lineWidth: 2, lineDash: 'solid', ...over,
})

const feat = (properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties,
})

const makeLayer = (over: Partial<SpatialLayer>): SpatialLayer => ({
  id: 'l', name: 'lyr', envName: '.GlobalEnv', geometryType: 'POINT',
  geojson: { type: 'FeatureCollection', features: [] },
  visible: true, color: '#abcdef', opacity: 0.8, colLib: 'sf', columnName: 'geometry',
  ...over,
})

describe('getLayerDataColumns', () => {
  it('returns [] when there are no features or properties', () => {
    expect(getLayerDataColumns(makeLayer({}))).toEqual([])
  })
  it('infers numeric vs categorical from the first non-null value', () => {
    const layer = makeLayer({
      geojson: { type: 'FeatureCollection', features: [feat({ pop: 100, name: 'A' })] },
    })
    expect(getLayerDataColumns(layer)).toEqual([
      { name: 'pop', type: 'numeric' },
      { name: 'name', type: 'categorical' },
    ])
  })
  it('skips leading null values when inferring type', () => {
    const layer = makeLayer({
      geojson: {
        type: 'FeatureCollection',
        features: [feat({ pop: null }), feat({ pop: 42 })],
      },
    })
    expect(getLayerDataColumns(layer)).toEqual([{ name: 'pop', type: 'numeric' }])
  })
})

describe('getEffectiveSym', () => {
  it('applies point defaults', () => {
    const sym = getEffectiveSym(makeLayer({ geometryType: 'POINT', color: '#abcdef', opacity: 0.8 }))
    expect(sym.fillColor).toBe('#abcdef')
    expect(sym.fillOpacity).toBe(0.8)
    expect(sym.borderColor).toBe('#ffffff')
    expect(sym.borderWidth).toBe(1)
    expect(sym.pointSize).toBe(4)
    expect(sym.pointShape).toBe('circle')
  })
  it('applies polygon defaults', () => {
    const sym = getEffectiveSym(makeLayer({ geometryType: 'MULTIPOLYGON', color: '#112233' }))
    expect(sym.fillOpacity).toBe(0.3)
    expect(sym.borderColor).toBe('#112233')
    expect(sym.borderWidth).toBe(1.5)
  })
  it('applies line defaults', () => {
    const sym = getEffectiveSym(makeLayer({ geometryType: 'LINESTRING', color: '#445566' }))
    expect(sym.borderColor).toBe('#445566')
    expect(sym.borderWidth).toBe(0)
  })
  it('honours explicit symbology overrides', () => {
    const sym = getEffectiveSym(makeLayer({
      geometryType: 'POLYGON',
      symbology: fullSym({ fillColor: '#000000', fillOpacity: 0.5 }),
    }))
    expect(sym.fillColor).toBe('#000000')
    expect(sym.fillOpacity).toBe(0.5)
  })
})
