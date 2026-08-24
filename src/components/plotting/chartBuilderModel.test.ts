import { describe, it, expect } from 'vitest'
import {
  getVarType,
  isNumericType,
  isCatType,
  isCompatible,
  newLayer,
  makeDefaultState,
  getConflictingLayerIds,
  geomParamsForLayer,
  buildGgplotCode,
  DEFAULT_AES,
  DEFAULT_CUSTOMIZE,
  DEFAULT_LABELS,
  DEFAULT_THEME,
  type ChartBuilderState,
  type GeomLayer,
} from './chartBuilderModel'

describe('getVarType', () => {
  it('maps R classes to compact variable types', () => {
    expect(getVarType('numeric')).toBe('num')
    expect(getVarType('double')).toBe('num')
    expect(getVarType('integer')).toBe('int')
    expect(getVarType('character')).toBe('chr')
    expect(getVarType('factor')).toBe('fct')
    expect(getVarType('ordered')).toBe('fct')
    expect(getVarType('Date')).toBe('date')
    expect(getVarType('POSIXct')).toBe('date')
    expect(getVarType('logical')).toBe('lgl')
    expect(getVarType('list')).toBe('oth')
  })
})

describe('isNumericType / isCatType', () => {
  it('classifies numeric-like types', () => {
    expect(isNumericType('num')).toBe(true)
    expect(isNumericType('int')).toBe(true)
    expect(isNumericType('date')).toBe(true)
    expect(isNumericType('chr')).toBe(false)
    expect(isNumericType(null)).toBe(false)
  })
  it('classifies categorical types', () => {
    expect(isCatType('chr')).toBe(true)
    expect(isCatType('fct')).toBe(true)
    expect(isCatType('lgl')).toBe(true)
    expect(isCatType('num')).toBe(false)
  })
})

describe('isCompatible', () => {
  it('accepts any type for free-form aesthetics', () => {
    expect(isCompatible('x', 'chr')).toBe(true)
    expect(isCompatible('colour', 'num')).toBe(true)
  })
  it('restricts y and size to numeric types', () => {
    expect(isCompatible('y', 'num')).toBe(true)
    expect(isCompatible('y', 'chr')).toBe(false)
    expect(isCompatible('size', 'int')).toBe(true)
    expect(isCompatible('size', 'fct')).toBe(false)
  })
  it('restricts shape to categorical types', () => {
    expect(isCompatible('shape', 'fct')).toBe(true)
    expect(isCompatible('shape', 'num')).toBe(false)
  })
})

describe('newLayer / makeDefaultState', () => {
  it('creates a visible point layer with a generated id', () => {
    const layer = newLayer()
    expect(layer.geomType).toBe('point')
    expect(layer.visible).toBe(true)
    expect(layer.id).toMatch(/^layer_/)
    expect(layer.customize).toEqual(DEFAULT_CUSTOMIZE)
  })
  it('seeds a default chart state with one layer', () => {
    const state = makeDefaultState()
    expect(state.dataset).toBe('')
    expect(state.layers).toHaveLength(1)
    expect(state.aes).toEqual(DEFAULT_AES)
    expect(state.theme).toEqual(DEFAULT_THEME)
  })
})

describe('getConflictingLayerIds', () => {
  const layer = (id: string, geomType: string, visible = true): GeomLayer => ({
    id, geomType, visible, customize: DEFAULT_CUSTOMIZE,
  })

  it('flags count-stat geoms when y is globally mapped', () => {
    const ids = getConflictingLayerIds([layer('l1', 'bar')], 'count')
    expect(ids.has('l1')).toBe(true)
  })
  it('flags count-stat geoms mixed with identity-stat layers', () => {
    const ids = getConflictingLayerIds([layer('l1', 'bar'), layer('l2', 'point')], '')
    expect(ids.has('l1')).toBe(true)
    expect(ids.has('l2')).toBe(false)
  })
  it('leaves a lone count-stat geom unflagged', () => {
    expect(getConflictingLayerIds([layer('l1', 'histogram')], '').size).toBe(0)
  })
})

describe('geomParamsForLayer', () => {
  it('returns no params for a default point layer', () => {
    expect(geomParamsForLayer('point', DEFAULT_CUSTOMIZE, DEFAULT_AES)).toEqual([])
  })
  it('emits a non-default point size', () => {
    expect(geomParamsForLayer('point', { ...DEFAULT_CUSTOMIZE, pointSize: 3 }, DEFAULT_AES))
      .toContain('size = 3')
  })
  it('prepends the count stat for bars and bins for histograms', () => {
    expect(geomParamsForLayer('bar', DEFAULT_CUSTOMIZE, DEFAULT_AES)[0]).toBe('stat = "count"')
    expect(geomParamsForLayer('histogram', DEFAULT_CUSTOMIZE, DEFAULT_AES)[0]).toBe('bins = 30')
  })
  it('passes smooth method and se through', () => {
    const params = geomParamsForLayer('smooth', { ...DEFAULT_CUSTOMIZE, smoothMethod: 'lm', smoothSe: false }, DEFAULT_AES)
    expect(params).toEqual(['method = "lm"', 'se = FALSE'])
  })
  it('adds a fixed colour only when colour is not aesthetically mapped', () => {
    const c = { ...DEFAULT_CUSTOMIZE, colorFixed: 'red' }
    expect(geomParamsForLayer('point', c, DEFAULT_AES)).toContain('colour = "red"')
    expect(geomParamsForLayer('point', c, { ...DEFAULT_AES, colour: 'species' })).not.toContain('colour = "red"')
  })
})

describe('buildGgplotCode', () => {
  it('returns empty string with no dataset or visible layers', () => {
    expect(buildGgplotCode(makeDefaultState())).toBe('')
    const noVisible: ChartBuilderState = { ...makeDefaultState(), dataset: 'df', layers: [] }
    expect(buildGgplotCode(noVisible)).toBe('')
  })
  it('builds a ggplot chain with aes, geom, and base theme', () => {
    const state: ChartBuilderState = {
      dataset: 'df',
      layers: [{ id: 'l1', geomType: 'point', visible: true, customize: DEFAULT_CUSTOMIZE }],
      aes: { ...DEFAULT_AES, x: 'a', y: 'b' },
      labels: DEFAULT_LABELS,
      theme: DEFAULT_THEME,
    }
    expect(buildGgplotCode(state)).toBe(
      'ggplot2::ggplot(df, ggplot2::aes(x = a, y = b)) +\n' +
      '  ggplot2::geom_point() +\n' +
      '  ggplot2::theme_minimal()',
    )
  })
  it('adds a labs() call when labels are set', () => {
    const state: ChartBuilderState = {
      ...makeDefaultState(),
      dataset: 'df',
      aes: { ...DEFAULT_AES, x: 'a' },
      labels: { ...DEFAULT_LABELS, title: 'My Plot' },
    }
    expect(buildGgplotCode(state)).toContain('ggplot2::labs(title = "My Plot")')
  })
})
