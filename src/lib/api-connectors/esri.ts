// Esri ArcGIS REST provider — Feature/Map services (vector, queryable via an
// ArcGIS `where` clause → sf). ImageServer raster imagery lives in its own
// provider under Raster / Image Layers (esri-image.ts).

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type Filter, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, BuildCodeOptions, CapacityProbe, ProviderContext, Selection } from './types'

export async function getJson(url: string): Promise<Record<string, unknown>> {
  // Government ArcGIS servers (USGS et al.) fail transiently under load —
  // one quiet retry turns most "failed to fetch" flakes into successes.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await proxyFetch(url)
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status} from ArcGIS server`)
      return JSON.parse(text)
    } catch (e) {
      if (attempt >= 1) throw e
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

// Non-throwing query attempt: false when the server erred (HTTP or ArcGIS
// `{error}` body), so the capacity probe can halve and retry.
async function queryOk(url: string): Promise<boolean> {
  try {
    const res = await proxyFetch(url)
    if (!res.ok) return false
    const data = JSON.parse(await res.text()) as { error?: unknown }
    return !data.error
  } catch {
    return false
  }
}

// Row count for a where clause (returnCountOnly), or undefined if unavailable.
async function countRows(queryUrl: string, where: string): Promise<number | undefined> {
  try {
    const p = new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' })
    const d = await getJson(`${queryUrl}?${p}`) as { count?: number }
    return typeof d.count === 'number' ? d.count : undefined
  } catch {
    return undefined
  }
}

const IMPORT_PAGE_SIZE = 1000 // default rows/request (matches ourgeo_read_arcgis)
const PROBE_FLOOR = 50        // smallest page size worth attempting

const layerUrl = (ctx: ProviderContext, sel: Selection) => `${ctx.baseUrl}/${sel.service}/${sel.layer}`

// ── `where` serialization ────────────────────────────────────────────────────
const aNum = (v: string) => { const n = Number(v); return Number.isFinite(n) && v.trim() !== '' ? String(n) : aText(v) }
const aText = (v: string) => `'${v.replace(/'/g, "''")}'`
const aLit = (f: Filter, v = f.value) => (f.kind === 'numeric' ? aNum(v) : f.kind === 'timestamp' ? `DATE '${v}'` : aText(v))

export function buildEsriWhere(query: Query): string {
  const cl: string[] = []
  for (const f of completeFilters(query)) {
    const c = f.field
    switch (f.op) {
      case 'is': case 'eq': case 'on': cl.push(`${c} = ${aLit(f)}`); break
      case 'isAnyOf': cl.push(`${c} IN (${(f.values ?? []).map((v) => aLit(f, v)).join(', ')})`); break
      case 'contains': cl.push(`${c} LIKE '%${f.value.replace(/'/g, "''")}%'`); break
      case 'lt': case 'before': cl.push(`${c} < ${aLit(f)}`); break
      case 'lte': cl.push(`${c} <= ${aLit(f)}`); break
      case 'gt': case 'after': cl.push(`${c} > ${aLit(f)}`); break
      case 'gte': cl.push(`${c} >= ${aLit(f)}`); break
      case 'between': case 'dateBetween': cl.push(`${c} BETWEEN ${aLit(f, f.value)} AND ${aLit(f, f.value2 ?? '')}`); break
    }
  }
  return cl.join(' AND ') || '1=1'
}

export const esriProvider: ApiProvider = {
  id: 'esri',
  label: 'Esri ArcGIS REST',
  category: 'Geospatial',
  description: 'ArcGIS REST Feature/Map services — vector layers import as sf via where-clause queries. Raster ImageServers live under Raster / Image Layers.',
  builtinServers: [
    { id: 'sample6', label: 'ArcGIS Sample Server 6', baseUrl: 'https://sampleserver6.arcgisonline.com/arcgis/rest/services' },
    { id: 'livingatlas', label: 'Esri Living Atlas (sampleserver5)', baseUrl: 'https://sampleserver5.arcgisonline.com/arcgis/rest/services' },
  ],
  cascade: [
    { key: 'service', label: 'Service', placeholder: 'Select a service' },
    { key: 'layer', label: 'Layer', placeholder: 'Select a layer' },
  ],

  async listLevel(levelKey, sel, ctx) {
    if (levelKey === 'service') {
      const root = await getJson(`${ctx.baseUrl}?f=json`) as { services?: { name: string; type: string }[]; folders?: string[] }
      const services = [...(root.services ?? [])]
      for (const folder of root.folders ?? []) {
        try {
          const fr = await getJson(`${ctx.baseUrl}/${folder}?f=json`) as { services?: { name: string; type: string }[] }
          services.push(...(fr.services ?? []))
        } catch { /* skip unreadable folder */ }
      }
      return services
        .filter((s) => s.type === 'FeatureServer' || s.type === 'MapServer')
        .map((s) => ({ value: `${s.name}/${s.type}`, label: `${s.name} (${s.type})` }))
    }
    const svc = await getJson(`${ctx.baseUrl}/${sel.service}?f=json`) as { layers?: { id: number; name: string }[]; tables?: { id: number; name: string }[] }
    return [...(svc.layers ?? []), ...(svc.tables ?? [])].map((l) => ({ value: String(l.id), label: l.name }))
  },

  async getMetadata(sel, ctx) {
    const info = await getJson(`${layerUrl(ctx, sel)}?f=json`) as {
      fields?: { name: string; type: string; alias?: string }[]
      geometryType?: string
      maxRecordCount?: number
      objectIdField?: string
    }
    const fields: Field[] = (info.fields ?? [])
      .filter((f) => f.type !== 'esriFieldTypeGeometry')
      .map((f) => ({ id: f.name, type: f.type, label: f.alias }))
    const total = await countRows(`${layerUrl(ctx, sel)}/query`, '1=1')
    return {
      fields,
      spatial: !!info.geometryType,
      queryable: true,
      total,
      caps: { maxRecordCount: info.maxRecordCount ?? IMPORT_PAGE_SIZE, objectIdField: info.objectIdField ?? 'objectid' },
    }
  },

  // Determine the largest page the server can actually return for this query by
  // halving from the requested size until a request succeeds. Requesting real
  // geometry is essential — the server only errors on large *geometry* payloads.
  async probeCapacity(sel, query, ctx): Promise<CapacityProbe> {
    const q = `${layerUrl(ctx, sel)}/query`
    const info = await getJson(`${layerUrl(ctx, sel)}?f=json`) as { maxRecordCount?: number; objectIdField?: string }
    const oid = info.objectIdField || 'objectid'
    const requested = Math.min(IMPORT_PAGE_SIZE, info.maxRecordCount || IMPORT_PAGE_SIZE)
    const where = buildEsriWhere(query)

    let size = requested
    let working = 0
    while (size >= PROBE_FLOOR) {
      const params = new URLSearchParams({
        where, outFields: oid, returnGeometry: 'true', returnTrueCurves: 'true',
        resultRecordCount: String(size), resultOffset: '0', f: 'json',
      })
      if (await queryOk(`${q}?${params}`)) { working = size; break }
      size = Math.floor(size / 2)
    }
    if (working === 0) working = PROBE_FLOOR // give up gracefully; R still backs off
    const total = await countRows(q, where)
    const reduced = working < requested
    return { requestedPageSize: requested, workingPageSize: working, reduced, prompt: reduced, total }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'text') return ['is', 'isAnyOf', 'contains']
    if (kind === 'numeric') return ['eq', 'lt', 'lte', 'gt', 'gte', 'between']
    return ['on', 'before', 'after', 'dateBetween']
  },

  async distinctValues(sel, field, ctx) {
    const params = new URLSearchParams({ where: '1=1', outFields: field, returnDistinctValues: 'true', orderByFields: field, f: 'json' })
    const data = await getJson(`${layerUrl(ctx, sel)}/query?${params}`) as { features?: { attributes: Record<string, unknown> }[] }
    return (data.features ?? []).map((ft) => ft.attributes[field]).filter((v) => v != null).map(String)
  },

  async preview(sel, query, ctx) {
    const params = new URLSearchParams({ where: buildEsriWhere(query), outFields: '*', resultRecordCount: String(query.limit), f: 'json' })
    const data = await getJson(`${layerUrl(ctx, sel)}/query?${params}`) as { features?: { attributes: Record<string, unknown> }[] }
    return (data.features ?? []).map((ft) => ft.attributes)
  },

  buildCode(sel, query, varName, ctx, opts?: BuildCodeOptions) {
    const where = buildEsriWhere(query)
    const base = `${layerUrl(ctx, sel)}/query`
    const pageSize = Math.max(1, Math.min(opts?.pageSize ?? IMPORT_PAGE_SIZE, query.limit))
    // ourgeo_read_arcgis() (r/lib/util-arcgis.R) fetches paginated EsriJSON with
    // true curves requested, reads attributes via GDAL, and rebuilds geometry as
    // curved WKT (CIRCULARSTRING/CURVEPOLYGON) when the layer is curved — so arcs
    // import exactly for sfarc instead of being dropped or linearized. Reading the
    // query URL through sf::st_read() directly returns empty geometry, which is
    // why we don't.
    return [
      'library(sf)',
      '',
      `# Esri ArcGIS Feature query — ${ctx.baseUrl}`,
      `${varName} <- ourgeo_read_arcgis(`,
      `  base_url    = "${base}",`,
      `  where       = r"(${where})",`,
      '  out_fields  = "*",',
      `  max_records = ${query.limit}L,`,
      `  page_size   = ${pageSize}L`,
      ')',
    ].join('\n')
  },
}
