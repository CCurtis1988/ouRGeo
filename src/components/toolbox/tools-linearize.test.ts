import { describe, it, expect, beforeEach } from 'vitest'
import { categoryList, toolList, maybeLinearize, LINEARIZE_FIELD } from './tools'
import { SELECTION_CATEGORIES } from './selection-tools'
import { useSpatialSettingsStore } from '@/store/spatialSettings'

const spatialSf = categoryList().find((c) => c.id === 'spatial-sf')!
const spatialGeos = categoryList().find((c) => c.id === 'spatial-geos')!
const spatialSel = SELECTION_CATEGORIES.find((c) => c.id === 'spatial')!

describe('linearize checkbox coverage', () => {
  it('every spatial tool offers the checkbox (tabular-input tools excluded)', () => {
    for (const tool of [...spatialSf.tools, ...spatialGeos.tools, ...spatialSel.tools]) {
      const has = tool.fields.some((f) => f.id === 'linearize' && f.type === 'checkbox')
      if (tool.id === 'sf-points-from-cols') {
        expect(has).toBe(false) // tabular input — nothing to linearize
      } else {
        expect(has, `${tool.id} should have the linearize checkbox`).toBe(true)
      }
    }
  })

  it('non-spatial tools do not get the checkbox', () => {
    const table = categoryList().find((c) => c.id === 'table')!
    for (const tool of table.tools) {
      expect(tool.fields.some((f) => f.id === 'linearize')).toBe(false)
    }
  })
})

describe('linearize codegen', () => {
  const buffer = toolList().find((t) => t.id === 'sf-buffer')!
  const filter = spatialSel.tools.find((t) => t.id === 'sel-st-intersects')!
  const geosBuf = toolList().find((t) => t.id === 'geos-buffer')!

  it('checked → dataset refs wrapped in ourgeo_linearize()', () => {
    // calccrs 'native' isolates the linearize wrapping from the CRS wrapper
    expect(buffer.buildCode({ ds: 'roads', dist: '100', out: 'r2', linearize: 'true', calccrs: 'native' }))
      .toContain('sf::st_buffer(ourgeo_linearize(roads)')
    expect(geosBuf.buildCode({ ds: 'roads', dist: '100', out: 'r2', linearize: 'true' }))
      .toContain('ourgeo_linearize(roads)')
    const sel = filter.buildCode({ ds: 'a', filter: 'b', linearize: 'true' })
    expect(sel).toContain('ourgeo_linearize(a)')
    expect(sel).toContain('ourgeo_linearize(b)')
  })

  it('unchecked → bare refs (sfarc S3 dispatch handles curves)', () => {
    expect(buffer.buildCode({ ds: 'roads', dist: '100', out: 'r2', calccrs: 'native' }))
      .toContain('sf::st_buffer(roads')
    expect(filter.buildCode({ ds: 'a', filter: 'b' })).not.toContain('ourgeo_linearize')
  })

  it('length tool emits unqualified st_length (sfarc masks sf::st_length)', () => {
    const len = toolList().find((t) => t.id === 'sf-add-length')!
    const code = len.buildCode({ ds: 'roads', colname: 'len', out: 'roads' })
    expect(code).toContain('as.numeric(st_length(geometry))')
    expect(code).not.toContain('sf::st_length')
  })

  it('maybeLinearize helper', () => {
    expect(maybeLinearize('x', { linearize: 'true' })).toBe('ourgeo_linearize(x)')
    expect(maybeLinearize('x', {})).toBe('x')
    expect(LINEARIZE_FIELD.id).toBe('linearize')
  })
})

describe('buffer nQuadSegs is linearize-only', () => {
  const buffer = spatialSf.tools.find((t) => t.id === 'sf-buffer')!

  it('the field is hidden unless linearize is checked', () => {
    const f = buffer.fields.find((x) => x.id === 'nquadsegs')!
    expect(f.visibleWhen).toBeDefined()
    expect(f.visibleWhen!({ linearize: 'true' })).toBe(true)
    expect(f.visibleWhen!({})).toBe(false)
  })

  it('nQuadSegs only appears in code when linearizing', () => {
    const exact = buffer.buildCode({ ds: 'roads', dist: '100', nquadsegs: '30', out: 'b' })
    expect(exact).not.toContain('nQuadSegs')
    const lin = buffer.buildCode({
      ds: 'roads', dist: '100', nquadsegs: '30', out: 'b', linearize: 'true'
    })
    expect(lin).toContain('nQuadSegs = 30')
    expect(lin).toContain('ourgeo_linearize(roads)')
  })
})

describe('Calculation CRS (exact curved results need projected data)', () => {
  const buffer = spatialSf.tools.find((t) => t.id === 'sf-buffer')!
  const intersection = spatialSf.tools.find((t) => t.id === 'sf-intersection')!

  beforeEach(() => {
    useSpatialSettingsStore.setState({ calcCrs: 'auto' })
  })

  it('planar-math tools get the calccrs fields; measure tools do not', () => {
    for (const id of [
      'sf-buffer', 'sf-intersection', 'sf-union-dissolve', 'sf-union-merge',
      'sf-difference', 'sf-erase', 'sf-clip', 'sf-centroid', 'sf-simplify'
    ]) {
      const tool = spatialSf.tools.find((t) => t.id === id)!
      expect(
        tool.fields.some((f) => f.id === 'calccrs'),
        `${id} should offer Calculation CRS`
      ).toBe(true)
      expect(tool.fields.some((f) => f.id === 'calccrs_custom')).toBe(true)
    }
    const area = spatialSf.tools.find((t) => t.id === 'sf-add-area')!
    expect(area.fields.some((f) => f.id === 'calccrs')).toBe(false)
  })

  it('blank defers to Settings default (auto → ourgeo_calc_crs at run time)', () => {
    const code = buffer.buildCode({ ds: 'roads', dist: '100', out: 'b' })
    expect(code).toContain('.crs <- ourgeo_calc_crs(.src)')
    expect(code).toContain('sf::st_buffer(sf::st_transform(.src, .crs), dist = 100)')
    expect(code).toContain('sf::st_crs(.src)')
  })

  it('blank + Settings set to a concrete CRS uses that CRS', () => {
    useSpatialSettingsStore.setState({ calcCrs: '5070' })
    const code = buffer.buildCode({ ds: 'roads', dist: '100', out: 'b' })
    expect(code).toContain('sf::st_transform(.src, 5070)')
    expect(code).not.toContain('ourgeo_calc_crs')
  })

  it("'Layer CRS' override disables the transform wrapper", () => {
    const code = buffer.buildCode({ ds: 'roads', dist: '100', out: 'b', calccrs: 'native' })
    expect(code).toBe('b <- sf::st_buffer(roads, dist = 100)')
  })

  it('explicit per-tool CRS wins over Settings', () => {
    useSpatialSettingsStore.setState({ calcCrs: '5070' })
    const code = buffer.buildCode({ ds: 'roads', dist: '100', out: 'b', calccrs: '3857' })
    expect(code).toContain('sf::st_buffer(sf::st_transform(.src, 3857), dist = 100)')
  })

  it('custom EPSG entry flows through', () => {
    const code = buffer.buildCode({
      ds: 'roads', dist: '100', out: 'b', calccrs: 'custom', calccrs_custom: '32610'
    })
    expect(code).toContain('sf::st_transform(.src, 32610)')
  })

  it('two-input tools transform both sides (auto shares one detected CRS)', () => {
    const code = intersection.buildCode({ ds1: 'a', ds2: 'b', out: 'x' })
    expect(code).toContain('.crs <- ourgeo_calc_crs(.a)')
    expect(code).toContain(
      'sf::st_intersection(sf::st_transform(.a, .crs), sf::st_transform(.b, .crs))'
    )
    expect(code).toContain('sf::st_crs(.a)')

    const fixed = intersection.buildCode({ ds1: 'a', ds2: 'b', out: 'x', calccrs: '32610' })
    expect(fixed).toContain(
      'sf::st_intersection(sf::st_transform(.a, 32610), sf::st_transform(.b, 32610))'
    )
  })
})
