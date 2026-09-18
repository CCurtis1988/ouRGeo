// OGC API – Features provider. Cascade is a single collection level; queryables
// become fields. Core servers support exact property=value filters + a datetime
// range; imports as sf via sf::st_read on the GeoJSON items endpoint.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider } from './types'

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from OGC API`)
  return JSON.parse(text)
}

const jsonSchemaKind = (t: string): string =>
  t === 'number' || t === 'integer' ? 'number' : /date/.test(t) ? 'timestamp' : 'string'

/** property=value params + datetime range from the query. */
function itemsParams(query: Query): URLSearchParams {
  const params = new URLSearchParams()
  let start = '..'; let end = '..'; let hasTime = false
  for (const f of completeFilters(query)) {
    if (f.kind === 'timestamp') {
      hasTime = true
      if (f.op === 'on') { start = f.value; end = f.value }
      else if (f.op === 'after') start = f.value
      else if (f.op === 'before') end = f.value
      else if (f.op === 'dateBetween') { start = f.value; end = f.value2 ?? '..' }
    } else if (f.op === 'is' || f.op === 'eq') {
      params.set(f.field, f.value)
    }
  }
  if (hasTime) params.set('datetime', start === end ? start : `${start}/${end}`)
  return params
}

export const ogcapiProvider: ApiProvider = {
  id: 'ogcapi',
  label: 'OGC API – Features',
  category: 'Geospatial',
  description: 'OGC API – Features servers. Pick a collection; filter by property/time; imports as sf.',
  docsUrl: 'https://ogcapi.ogc.org/features/',
  builtinServers: [
    { id: 'pygeoapi', label: 'pygeoapi demo', baseUrl: 'https://demo.pygeoapi.io/master' },
    { id: 'ldproxy', label: 'ldproxy demo (vineyards)', baseUrl: 'https://demo.ldproxy.net/vineyards' },
  ],
  cascade: [{ key: 'collection', label: 'Collection', placeholder: 'Select a collection' }],

  async listLevel(_levelKey, _sel, ctx) {
    const data = await getJson(`${ctx.baseUrl}/collections?f=json`) as { collections?: { id: string; title?: string }[] }
    return (data.collections ?? []).map((c) => ({ value: c.id, label: c.title ?? c.id }))
  },

  async getMetadata(sel, ctx) {
    let fields: Field[] = []
    try {
      const q = await getJson(`${ctx.baseUrl}/collections/${sel.collection}/queryables?f=json`) as {
        properties?: Record<string, { type?: string; title?: string }>
      }
      fields = Object.entries(q.properties ?? {})
        .filter(([id]) => id !== 'geometry')
        .map(([id, def]) => ({ id, type: jsonSchemaKind(def.type ?? 'string'), label: def.title }))
    } catch { /* queryables optional — fall back to sampling a feature */ }
    if (fields.length === 0) {
      const sample = await getJson(`${ctx.baseUrl}/collections/${sel.collection}/items?limit=1&f=json`) as {
        features?: { properties?: Record<string, unknown> }[]
      }
      const props = sample.features?.[0]?.properties ?? {}
      fields = Object.entries(props).map(([id, v]) => ({ id, type: typeof v === 'number' ? 'number' : 'string' }))
    }
    let total: number | undefined
    try {
      const c = await getJson(`${ctx.baseUrl}/collections/${sel.collection}/items?limit=0&f=json`) as { numberMatched?: number }
      total = c.numberMatched
    } catch { /* best-effort */ }
    return { fields, total, spatial: true, queryable: true }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'timestamp') return ['on', 'before', 'after', 'dateBetween']
    if (kind === 'numeric') return ['eq']
    return ['is']
  },

  async preview(sel, query, ctx) {
    const params = itemsParams(query)
    params.set('limit', String(query.limit)); params.set('f', 'json')
    const data = await getJson(`${ctx.baseUrl}/collections/${sel.collection}/items?${params}`) as {
      features?: { id?: string | number; properties?: Record<string, unknown> }[]
    }
    return (data.features ?? []).map((ft) => ({ id: ft.id, ...(ft.properties ?? {}) }))
  },

  buildCode(sel, query, varName, ctx) {
    const params = itemsParams(query)
    params.set('limit', String(query.limit)); params.set('f', 'json')
    const url = `${ctx.baseUrl}/collections/${sel.collection}/items?${params}`
    return [
      'library(sf)',
      '',
      `# OGC API – Features — ${ctx.baseUrl}`,
      `${varName} <- sf::st_read(${`r"(${url})"`}, quiet = TRUE)`,
    ].join('\n')
  },
}
