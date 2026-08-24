// Macrostrat connector: param serialization, registry placement, preview
// guard for whole-database routes, and generated-R checks.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fixtures = new Map<string, string>()
vi.mock('@/lib/ai-proxy-fetch', () => ({
  proxyFetch: vi.fn(async (url: string) => {
    for (const [needle, body] of fixtures) {
      if (url.includes(needle)) return { ok: true, status: 200, text: async () => body }
    }
    throw new Error(`No fixture for ${url}`)
  }),
}))

import type { Filter, Query } from './query-model'
import { buildMacrostratParams, macrostratProvider } from './macrostrat'
import { providersByCategory } from './registry'

const q = (filters: Filter[], extra: Partial<Query> = {}): Query => ({ filters, q: '', limit: 20, ...extra })
const f = (p: Partial<Filter>): Filter => ({ id: '1', field: 'f', kind: 'text', op: 'is', value: '', ...p })
const ctx = { baseUrl: 'https://macrostrat.test/api/v2', apiKeys: {} }

beforeEach(() => fixtures.clear())

describe('Macrostrat param serialization', () => {
  it('equality, comma lists, and age between → age_top/age_bottom', () => {
    expect(String(buildMacrostratParams(q([f({ field: 'interval_name', op: 'is', value: 'Permian' })]))))
      .toBe('interval_name=Permian')
    expect(String(buildMacrostratParams(q([f({ field: 'lith', op: 'isAnyOf', values: ['sandstone', 'shale'] })]))))
      .toBe('lith=sandstone%2Cshale')
    expect(String(buildMacrostratParams(q([f({ field: 'age', kind: 'numeric', op: 'between', value: '200', value2: '100' })]))))
      .toBe('age_top=100&age_bottom=200') // top = younger regardless of input order
  })
  it('skips incomplete filters and unsupported between fields', () => {
    expect(String(buildMacrostratParams(q([f({ field: 'lith', op: 'is', value: '' })])))).toBe('')
    expect(String(buildMacrostratParams(q([f({ field: 'col_id', kind: 'numeric', op: 'between', value: '1', value2: '9' })])))).toBe('')
  })
})

describe('Macrostrat provider', () => {
  it('sits under Geospatial with the other sf connectors', () => {
    const geo = providersByCategory().find((g) => g.category === 'Geospatial')
    expect(geo?.providers.map((p) => p.id)).toContain('macrostrat')
  })

  it('lists curated datasets without a network call', async () => {
    const opts = await macrostratProvider.listLevel('dataset', {}, ctx)
    expect(opts.map((o) => o.value)).toEqual(['columns', 'fossils', 'geologic_units/map', 'paleogeography'])
  })

  it('preview waits for a filter on whole-database routes', async () => {
    // No fixture registered: a network call here would throw.
    const rows = await macrostratProvider.preview({ dataset: 'fossils' }, q([]), ctx)
    expect(rows).toEqual([])
  })

  it('preview unwraps the success.data envelope and respects the limit', async () => {
    fixtures.set('/columns?', JSON.stringify({
      success: { data: [{ col_id: 1 }, { col_id: 2 }, { col_id: 3 }] },
    }))
    const rows = await macrostratProvider.preview({ dataset: 'columns' }, q([], { limit: 2 }), ctx)
    expect(rows).toEqual([{ col_id: 1 }, { col_id: 2 }])
  })

  it('distinct values come from the defs dictionaries', async () => {
    fixtures.set('/defs/lithologies', JSON.stringify({
      success: { data: [{ name: 'shale', type: 'siliciclastic', class: 'sedimentary' }, { name: 'basalt', type: 'volcanic', class: 'igneous' }] },
    }))
    expect(await macrostratProvider.distinctValues!({ dataset: 'columns' }, 'lith', ctx)).toEqual(['basalt', 'shale'])
    expect(await macrostratProvider.distinctValues!({ dataset: 'columns' }, 'lith_type', ctx)).toEqual(['siliciclastic', 'volcanic'])
    expect(await macrostratProvider.distinctValues!({ dataset: 'geologic_units/map' }, 'scale', ctx)).toEqual(['small', 'medium', 'large'])
  })

  it('separates preview columns (data keys) from fields (query params)', async () => {
    const meta = await macrostratProvider.getMetadata({ dataset: 'fossils' }, ctx)
    expect(meta.previewColumns).toContain('cltn_name')
    expect(meta.previewColumns).not.toContain('interval_name') // param, not a data column
  })

  it('flags map-unit queries the server would 500 on (scale alone, lat without lng, ranges)', async () => {
    const issue = (filters: Filter[]) =>
      macrostratProvider.validateQuery!({ dataset: 'geologic_units/map' }, q(filters))

    expect(issue([f({ field: 'scale', op: 'is', value: 'large' })])).toMatch(/point.*lat and lng.*|by id/i)
    expect(issue([f({ field: 'lat', kind: 'numeric', op: 'eq', value: '43.07' })])).toMatch(/both lat and lng/)
    // between on lat/lng serializes to nothing — the message says to use '='
    expect(issue([
      f({ id: '1', field: 'lat', kind: 'numeric', op: 'between', value: '43', value2: '44' }),
      f({ id: '2', field: 'lng', kind: 'numeric', op: 'between', value: '-90', value2: '-89' }),
    ])).toMatch(/Use '=' for lat and lng/)

    const point = [
      f({ id: '1', field: 'lat', kind: 'numeric', op: 'eq', value: '43.07' }),
      f({ id: '2', field: 'lng', kind: 'numeric', op: 'eq', value: '-89.4' }),
      f({ id: '3', field: 'scale', op: 'is', value: 'large' }),
    ]
    expect(issue(point)).toBeNull()
    const code = macrostratProvider.buildCode({ dataset: 'geologic_units/map' }, q(point), 'units', ctx)
    expect(code).toContain('lat=43.07')
    expect(code).toContain('scale=large')

    // Invalid queries preview as empty (the banner explains) instead of 500ing.
    await expect(macrostratProvider.preview(
      { dataset: 'geologic_units/map' }, q([f({ field: 'scale', op: 'is', value: 'large' })]), ctx,
    )).resolves.toEqual([])
  })

  it('flags unfiltered whole-database routes via validateQuery', () => {
    expect(macrostratProvider.validateQuery!({ dataset: 'fossils' }, q([]))).toMatch(/at least one filter/)
    expect(macrostratProvider.validateQuery!({ dataset: 'columns' }, q([]))).toBeNull()
  })

  it('generates a bare-GeoJSON st_read import', async () => {
    const meta = await macrostratProvider.getMetadata({ dataset: 'columns' }, ctx)
    expect(meta.spatial).toBe(true)
    const code = macrostratProvider.buildCode(
      { dataset: 'columns' }, q([f({ field: 'interval_name', op: 'is', value: 'Permian' })]), 'cols', ctx,
    )
    expect(code).toContain('library(sf)')
    expect(code).toContain('interval_name=Permian')
    expect(code).toContain('format=geojson_bare')
    expect(code).toContain('sf::st_read(')
  })
})
