// WFS provider — legacy OGC vector services. Cascade is a single feature-type
// level (from GetCapabilities); fields come from DescribeFeatureType. Filtering
// uses CQL_FILTER (GeoServer/MapServer ext, ignored gracefully if unsupported);
// import is sf::st_read on a GeoJSON GetFeature URL.
//
// XML is parsed in the renderer via DOMParser; flagged for in-app verification.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type Filter, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, ProviderContext } from './types'

async function getText(url: string): Promise<string> {
  const res = await proxyFetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from WFS server`)
  return text
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  return JSON.parse(await getText(url))
}

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml')
const tag = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS('*', name))
const localType = (t: string) => t.replace(/^.*:/, '')
const isGeometryType = (t: string) => /gml|geometry|point|line|polygon|surface|curve|multi/i.test(t)

// ── CQL (ECQL) filter serialization ─────────────────────────────────────────
const cNum = (v: string) => { const n = Number(v); return Number.isFinite(n) && v.trim() !== '' ? String(n) : cText(v) }
const cText = (v: string) => `'${v.replace(/'/g, "''")}'`
const cLit = (f: Filter, v = f.value) => (f.kind === 'numeric' ? cNum(v) : cText(v))

export function buildCqlFilter(query: Query): string {
  const cl: string[] = []
  for (const f of completeFilters(query)) {
    const c = f.field
    switch (f.op) {
      case 'is': case 'eq': case 'on': cl.push(`${c} = ${cLit(f)}`); break
      case 'isAnyOf': cl.push(`${c} IN (${(f.values ?? []).map((v) => cLit(f, v)).join(', ')})`); break
      case 'contains': cl.push(`${c} LIKE '%${f.value.replace(/'/g, "''")}%'`); break
      case 'lt': case 'before': cl.push(`${c} < ${cLit(f)}`); break
      case 'lte': cl.push(`${c} <= ${cLit(f)}`); break
      case 'gt': case 'after': cl.push(`${c} > ${cLit(f)}`); break
      case 'gte': cl.push(`${c} >= ${cLit(f)}`); break
      case 'between': case 'dateBetween': cl.push(`${c} BETWEEN ${cLit(f, f.value)} AND ${cLit(f, f.value2 ?? '')}`); break
    }
  }
  return cl.join(' AND ')
}

// WFS servers disagree on version (typeNames+count vs typeName+maxFeatures) and on
// the GeoJSON output-format name (MapServer wants `geojson`, GeoServer
// `application/json`). Probe once per server and cache the working combination.
interface WfsAccess { version: string; outputFormat: string; typeParam: string; countParam: string }
const wfsAccess = new Map<string, WfsAccess>()
const WFS_FALLBACK: WfsAccess = { version: '2.0.0', outputFormat: 'application/json', typeParam: 'typeNames', countParam: 'count' }

async function detectAccess(baseUrl: string, typeName: string): Promise<WfsAccess> {
  const cached = wfsAccess.get(baseUrl)
  if (cached) return cached
  const combos: Omit<WfsAccess, 'outputFormat'>[] = [
    { version: '2.0.0', typeParam: 'typeNames', countParam: 'count' },
    { version: '1.1.0', typeParam: 'typeName', countParam: 'maxFeatures' },
    { version: '1.0.0', typeParam: 'typeName', countParam: 'maxFeatures' },
  ]
  for (const c of combos) {
    for (const outputFormat of ['geojson', 'application/json', 'json']) {
      const params = new URLSearchParams({ service: 'WFS', version: c.version, request: 'GetFeature', [c.typeParam]: typeName, [c.countParam]: '1', outputFormat })
      try {
        const res = await proxyFetch(`${baseUrl}?${params}`)
        const text = await res.text()
        if (res.ok && text.trim().startsWith('{') && text.includes('FeatureCollection')) {
          const access = { ...c, outputFormat }
          wfsAccess.set(baseUrl, access)
          return access
        }
      } catch { /* try next combo */ }
    }
  }
  wfsAccess.set(baseUrl, WFS_FALLBACK)
  return WFS_FALLBACK
}

function getFeatureUrl(ctx: ProviderContext, typeName: string, query: Query): string {
  const a = wfsAccess.get(ctx.baseUrl) ?? WFS_FALLBACK
  const params = new URLSearchParams({
    service: 'WFS', version: a.version, request: 'GetFeature',
    [a.typeParam]: typeName, [a.countParam]: String(query.limit), outputFormat: a.outputFormat,
  })
  const cql = buildCqlFilter(query)
  if (cql) params.set('CQL_FILTER', cql)
  return `${ctx.baseUrl}?${params}`
}

export const wfsProvider: ApiProvider = {
  id: 'wfs',
  label: 'WFS',
  category: 'Geospatial',
  description: 'OGC Web Feature Service (WFS). Pick a feature type; filter via CQL; imports as sf.',
  builtinServers: [
    { id: 'mapserver', label: 'MapServer demo', baseUrl: 'https://demo.mapserver.org/cgi-bin/wfs' },
  ],
  cascade: [{ key: 'featureType', label: 'Feature type', placeholder: 'Select a feature type' }],

  async listLevel(_levelKey, _sel, ctx) {
    const doc = parseXml(await getText(`${ctx.baseUrl}?service=WFS&request=GetCapabilities`))
    return tag(doc, 'FeatureType')
      .map((ft) => {
        const name = tag(ft, 'Name')[0]?.textContent ?? ''
        const title = tag(ft, 'Title')[0]?.textContent ?? name
        return { value: name, label: title || name }
      })
      .filter((o) => o.value)
  },

  async getMetadata(sel, ctx) {
    // Probe the working version/output-format for this server (used by preview + import).
    await detectAccess(ctx.baseUrl, sel.featureType)
    const doc = parseXml(await getText(`${ctx.baseUrl}?service=WFS&version=2.0.0&request=DescribeFeatureType&typeName=${encodeURIComponent(sel.featureType)}`))
    const fields: Field[] = tag(doc, 'element')
      .map((e) => ({ id: e.getAttribute('name') ?? '', type: localType(e.getAttribute('type') ?? 'string') }))
      .filter((f) => f.id && !isGeometryType(f.type))
    return { fields, spatial: true, queryable: true }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'text') return ['is', 'isAnyOf', 'contains']
    if (kind === 'numeric') return ['eq', 'lt', 'lte', 'gt', 'gte', 'between']
    return ['on', 'before', 'after', 'dateBetween']
  },

  async preview(sel, query, ctx) {
    const data = await getJson(getFeatureUrl(ctx, sel.featureType, query)) as {
      features?: { id?: string | number; properties?: Record<string, unknown> }[]
    }
    return (data.features ?? []).map((ft) => ({ ...(ft.properties ?? {}) }))
  },

  buildCode(sel, query, varName, ctx) {
    const url = getFeatureUrl(ctx, sel.featureType, query)
    return [
      'library(sf)',
      '',
      `# WFS GetFeature (GeoJSON) — ${ctx.baseUrl}`,
      `${varName} <- sf::st_read(${`r"(${url})"`}, quiet = TRUE)`,
    ].join('\n')
  },
}
