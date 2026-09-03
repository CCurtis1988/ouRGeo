import { describe, it, expect } from 'vitest'
import { compileProvider, serializeFilters, fillTemplate, fillUrl, pick, DIALECTS } from './declarative'
import { buildODataFilter } from './odata'
import { odataProvider } from './odata'
import { DEFAULT_QUERY, type Filter, type Query } from './query-model'
import type { ProviderContext, Selection } from './types'

// The question this file answers is not "does the compiler run" but "is the
// spec expressive enough to be worth offering". So the central test compiles a
// spec for a provider ouRGeo already ships and compares the generated R with
// the hand-written one, clause for clause.

const ctx: ProviderContext = { baseUrl: 'https://services.odata.org/V4/Northwind/Northwind.svc', apiKeys: {} }
const sel: Selection = { entitySet: 'Orders' }

const filter = (over: Partial<Filter>): Filter => ({
  id: '1', field: 'Country', kind: 'text', op: 'is', value: 'Germany', ...over,
})

const query = (filters: Filter[], limit = 5000): Query => ({ ...DEFAULT_QUERY, filters, limit })

describe('the filter dialects', () => {
  it('produce byte-identical OData to the hand-written provider', () => {
    // buildODataFilter is the shipped implementation; the dialect table is a
    // description of it. If they ever disagree, one of them is wrong.
    const cases: Filter[][] = [
      [filter({})],
      [filter({ op: 'contains', value: "O'Brien" })],
      [filter({ op: 'isAnyOf', values: ['Germany', 'France', 'Spain'] })],
      [filter({ field: 'Freight', kind: 'numeric', op: 'gte', value: '100' })],
      [filter({ field: 'Freight', kind: 'numeric', op: 'between', value: '10', value2: '99' })],
      [filter({ field: 'OrderDate', kind: 'timestamp', op: 'before', value: '1997-01-01' })],
      [filter({}), filter({ id: '2', field: 'City', value: 'Berlin' })],
    ]
    for (const filters of cases) {
      expect(serializeFilters(query(filters), DIALECTS.odata)).toBe(buildODataFilter(query(filters)))
    }
  })

  it('escapes a quote in a text value, in every quoting dialect', () => {
    // This is the one place a value the user typed becomes part of the
    // server's query language.
    const q = query([filter({ value: "O'Brien" })])
    for (const name of ['odata', 'cql', 'esri', 'soql']) {
      expect(serializeFilters(q, DIALECTS[name]), name).toContain("O''Brien")
    }
  })

  it('writes an "is any of" as an IN list where the dialect has one', () => {
    const q = query([filter({ op: 'isAnyOf', values: ['a', 'b'] })])
    expect(serializeFilters(q, DIALECTS.esri)).toBe("Country IN ('a', 'b')")
    expect(serializeFilters(q, DIALECTS.odata)).toBe("(Country eq 'a' or Country eq 'b')")
    expect(serializeFilters(q, DIALECTS.params)).toBe('Country=a,b')
  })

  it('leaves numbers and timestamps unquoted', () => {
    expect(serializeFilters(query([filter({ field: 'n', kind: 'numeric', op: 'eq', value: '4' })]), DIALECTS.cql))
      .toBe('n = 4')
    expect(serializeFilters(query([filter({ field: 't', kind: 'timestamp', op: 'on', value: '2020-01-01' })]), DIALECTS.cql))
      .toBe('t = 2020-01-01')
  })

  it('skips an incomplete filter rather than emitting a broken clause', () => {
    expect(serializeFilters(query([filter({ value: '' })]), DIALECTS.odata)).toBe('')
  })
})

describe('a spec that reproduces a shipped provider', () => {
  const spec = {
    name: 'odata-clone',
    label: 'OData (declarative)',
    category: 'Statistics' as const,
    description: 'The shipped OData provider, described rather than written.',
    servers: [{ id: 'northwind', label: 'Northwind', baseUrl: ctx.baseUrl }],
    cascade: [{
      key: 'entitySet', label: 'Entity set',
      url: '{{baseUrl}}/?$format=json',
      itemsPath: 'value', valuePath: 'url', labelPath: 'name',
    }],
    metadata: {
      url: '{{baseUrl}}/{sel.entitySet}?$top=1&$format=json',
      fieldsFrom: 'sampleRow' as const,
      rowsPath: 'value',
      spatial: false,
      queryable: true,
    },
    filterDialect: 'odata' as const,
    import: {
      template:
        '# OData v4 — {{baseUrl}}\n' +
        '{{var}} <- ourgeo_read_odata(\n' +
        '  base_url    = "{{baseUrl}}/{{sel.entitySet}}",\n' +
        '  filter      = r"({{filter}})",\n' +
        '  max_records = {{limit}}L,\n' +
        '  page_size   = 1000L\n' +
        ')',
    },
  }

  const compiled = compileProvider(spec)

  it('compiles', () => {
    expect(compiled.error).toBeUndefined()
    expect(compiled.ok).toBe(true)
  })

  it('emits the same R as the hand-written provider', () => {
    const q = query([filter({ op: 'contains', value: 'Ger' })])
    const mine = compiled.provider!.buildCode(sel, q, 'orders', ctx)
    const theirs = odataProvider.buildCode(sel, q, 'orders', ctx)
    expect(mine).toBe(theirs)
  })

  it('offers only the operators the dialect can write', () => {
    // An operator with no template produces a filter the server ignores, which
    // the user reads as ouRGeo losing their query.
    const ops = compiled.provider!.opsFor('text')
    expect(ops).toContain('contains')
    expect(compiled.provider!.opsFor('numeric')).toContain('between')
    expect(compileProvider({ ...spec, filterDialect: 'params' }).provider!.opsFor('numeric'))
      .not.toContain('between')
  })

  it('derives a usable R variable name from the selection', () => {
    expect(compiled.provider!.defaultVarName!({ entitySet: 'Order Details' })).toBe('order_details')
    expect(compiled.provider!.defaultVarName!({ entitySet: '2020 Sales' })).toBe('d_2020_sales')
  })
})

describe('refusals name what is wrong', () => {
  const base = {
    name: 'x', label: 'X', category: 'Open Data' as const, description: '',
    servers: [{ id: 's', label: 'S', baseUrl: 'https://example.org' }],
    cascade: [{ key: 'a', label: 'A', options: [] }],
    metadata: {},
    import: { template: '{var} <- 1' },
  }
  const err = (over: Record<string, unknown>): string | undefined =>
    compileProvider({ ...base, ...over } as never).error

  it('insists on a server, a cascade and an import', () => {
    expect(err({ servers: [] })).toContain('"servers"')
    expect(err({ cascade: [] })).toContain('"cascade"')
    expect(err({ import: undefined })).toContain('"import.template"')
  })

  it('insists the import assigns to something', () => {
    // Without {var} the Load button runs code that leaves no object behind,
    // and the failure is invisible until the user looks for it.
    expect(err({ import: { template: 'sf::st_read("x")' } })).toContain('{var}')
  })

  it('makes a cascade level say where its options come from', () => {
    expect(err({ cascade: [{ key: 'a', label: 'A' }] })).toContain('"options"')
    expect(err({ cascade: [{ key: 'a', label: 'A' }] })).toContain('"url"')
  })

  it('names the dialects it knows', () => {
    const e = err({ filterDialect: 'graphql' })
    expect(e).toContain('graphql')
    expect(e).toContain('odata')
  })
})

describe('templating', () => {
  const c = { spec: {} as never, sel: { id: 'a b/c' }, ctx: { baseUrl: 'https://x', apiKeys: { noaa: 'k1' } } }

  it('encodes {x} and leaves {{x}} raw', () => {
    expect(fillTemplate('{sel.id}', c)).toBe('a%20b%2Fc')
    expect(fillTemplate('{{sel.id}}', c)).toBe('a b/c')
  })

  it('reaches api keys without them ever being an action parameter', () => {
    expect(fillTemplate('{{apiKey.noaa}}', c)).toBe('k1')
  })

  it('drops a query parameter whose value came out empty', () => {
    // `&$filter=` is not the same request as no filter: servers either reject
    // it or ignore it, and the second looks like ouRGeo losing the query.
    expect(fillUrl('https://x/y?$top=10&$filter={filter}', c)).toBe('https://x/y?$top=10')
    expect(fillUrl('https://x/y?$filter={filter}', c)).toBe('https://x/y')
  })

  it('keeps a parameter that has a value', () => {
    expect(fillUrl('https://x/y?id={sel.id}', c)).toBe('https://x/y?id=a%20b%2Fc')
  })
})

describe('reading a response', () => {
  const body = { result: { items: [{ id: 1, name: 'a' }, { id: 2 }] }, total: 2 }

  it('walks a dotted path with indexes', () => {
    expect(pick(body, 'result.items[1].id')).toBe(2)
    expect(pick(body, 'total')).toBe(2)
    expect(pick(body, 'result.items[9].id')).toBeUndefined()
    expect(pick(body, undefined)).toBe(body)
  })
})
