import { describe, it, expect } from 'vitest'
import type { Filter, Query } from './query-model'
import { buildSoqlWhere } from './socrata'
import { buildODataFilter } from './odata'
import { buildErddapConstraints } from './erddap'
import { buildEsriWhere } from './esri'
import { buildCqlFilter } from './wfs'

const q = (filters: Filter[], extra: Partial<Query> = {}): Query => ({ filters, q: '', limit: 100, ...extra })
const f = (p: Partial<Filter>): Filter => ({ id: '1', field: 'f', kind: 'text', op: 'is', value: '', ...p })

describe('SoQL ($where) serialization', () => {
  it('equality, IN, contains, numeric comparison', () => {
    expect(buildSoqlWhere(q([f({ field: 'borough', op: 'is', value: 'BROOKLYN' })]))).toBe("borough = 'BROOKLYN'")
    expect(buildSoqlWhere(q([f({ field: 'borough', op: 'isAnyOf', values: ['A', 'B'] })]))).toBe("borough IN ('A', 'B')")
    expect(buildSoqlWhere(q([f({ field: 'type', op: 'contains', value: 'noise' })]))).toBe("upper(type) like upper('%noise%')")
    expect(buildSoqlWhere(q([f({ field: 'n', kind: 'numeric', op: 'gt', value: '5' })]))).toBe('n > 5')
  })
  it('ignores incomplete filters and escapes quotes', () => {
    expect(buildSoqlWhere(q([f({ field: 'b', op: 'is', value: '' })]))).toBe('')
    expect(buildSoqlWhere(q([f({ field: 'b', op: 'is', value: "O'Brien" })]))).toBe("b = 'O''Brien'")
  })
})

describe('OData ($filter) serialization', () => {
  it('eq, IN→or, contains, numeric between', () => {
    expect(buildODataFilter(q([f({ field: 'City', op: 'is', value: 'Berlin' })]))).toBe("City eq 'Berlin'")
    expect(buildODataFilter(q([f({ field: 'City', op: 'isAnyOf', values: ['A', 'B'] })]))).toBe("(City eq 'A' or City eq 'B')")
    expect(buildODataFilter(q([f({ field: 'Name', op: 'contains', value: 'ch' })]))).toBe("contains(Name,'ch')")
    expect(buildODataFilter(q([f({ field: 'Price', kind: 'numeric', op: 'between', value: '1', value2: '9' })]))).toBe('(Price ge 1 and Price le 9)')
  })
})

describe('ERDDAP constraint serialization', () => {
  it('string quoting, numeric comparison, range → two constraints', () => {
    expect(buildErddapConstraints(q([f({ field: 'station', op: 'is', value: 'ABC' })]))).toEqual(['station="ABC"'])
    expect(buildErddapConstraints(q([f({ field: 'temp', kind: 'numeric', op: 'gte', value: '10' })]))).toEqual(['temp>=10'])
    expect(buildErddapConstraints(q([f({ field: 'depth', kind: 'numeric', op: 'between', value: '0', value2: '50' })]))).toEqual(['depth>=0', 'depth<=50'])
  })
})

describe('Esri where serialization', () => {
  it('defaults to 1=1, builds equality/IN/LIKE and date literals', () => {
    expect(buildEsriWhere(q([]))).toBe('1=1')
    expect(buildEsriWhere(q([f({ field: 'st', op: 'is', value: 'CA' })]))).toBe("st = 'CA'")
    expect(buildEsriWhere(q([f({ field: 'st', op: 'isAnyOf', values: ['CA', 'NV'] })]))).toBe("st IN ('CA', 'NV')")
    expect(buildEsriWhere(q([f({ field: 'name', op: 'contains', value: 'San' })]))).toBe("name LIKE '%San%'")
    expect(buildEsriWhere(q([f({ field: 'd', kind: 'timestamp', op: 'after', value: '2020-01-01' })]))).toBe("d > DATE '2020-01-01'")
  })
})

describe('CQL (WFS) serialization', () => {
  it('equality, range, contains', () => {
    expect(buildCqlFilter(q([f({ field: 'type', op: 'is', value: 'park' })]))).toBe("type = 'park'")
    expect(buildCqlFilter(q([f({ field: 'pop', kind: 'numeric', op: 'between', value: '1', value2: '9' })]))).toBe('pop BETWEEN 1 AND 9')
  })
})
