// STAC provider — SpatioTemporal Asset Catalogs (satellite/EO). Cascade is a
// collection; item properties become fields. Imports the item *footprints +
// metadata* as sf, or — when the collection exposes COG/GeoTIFF assets — the
// raster assets themselves as lazy /vsicurl/ SpatRasters. Uses POST /search.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, BuildCodeOptions, CapacityProbe } from './types'

const IMPORT_PAGE_SIZE = 500 // default rows/request (matches ourgeo_read_stac)
const PROBE_FLOOR = 25       // smallest page size worth attempting
const PROBE_CEIL = 1000      // most rows to try per page when probing capacity

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from STAC API`)
  return JSON.parse(text)
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await proxyFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from STAC search`)
  return JSON.parse(text)
}

/** STAC POST /search body from the query (datetime range + query-extension eq). */
function searchBody(collection: string, query: Query, limit: number): Record<string, unknown> {
  const body: Record<string, unknown> = { collections: [collection], limit }
  const eq: Record<string, { eq: string | number }> = {}
  let start = '..'; let end = '..'; let hasTime = false
  for (const f of completeFilters(query)) {
    if (f.kind === 'timestamp') {
      hasTime = true
      if (f.op === 'on') { start = f.value; end = f.value }
      else if (f.op === 'after') start = f.value
      else if (f.op === 'before') end = f.value
      else if (f.op === 'dateBetween') { start = f.value; end = f.value2 ?? '..' }
    } else if (f.op === 'is' || f.op === 'eq') {
      eq[f.field] = { eq: f.kind === 'numeric' ? Number(f.value) : f.value }
    }
  }
  if (hasTime) body.datetime = start === end ? start : `${start}/${end}`
  if (Object.keys(eq).length > 0) body.query = eq
  return body
}

export const stacProvider: ApiProvider = {
  id: 'stac',
  label: 'STAC',
  category: 'Raster / Image Layers',
  description: 'STAC catalogs (satellite/EO imagery). Pick a collection; search items by time/property; import COG assets as rasters, or item footprints as sf.',
  builtinServers: [
    { id: 'earthsearch', label: 'Earth Search (Element 84)', baseUrl: 'https://earth-search.aws.element84.com/v1' },
    { id: 'planetary', label: 'Microsoft Planetary Computer', baseUrl: 'https://planetarycomputer.microsoft.com/api/stac/v1' },
  ],
  cascade: [{ key: 'collection', label: 'Collection', placeholder: 'Select a collection' }],

  async listLevel(_levelKey, _sel, ctx) {
    const data = await getJson(`${ctx.baseUrl}/collections`) as { collections?: { id: string; title?: string }[] }
    return (data.collections ?? []).map((c) => ({ value: c.id, label: c.title ?? c.id }))
  },

  async getMetadata(sel, ctx) {
    let fields: Field[] = []
    try {
      const q = await getJson(`${ctx.baseUrl}/collections/${sel.collection}/queryables`) as {
        properties?: Record<string, { type?: string; title?: string }>
      }
      fields = Object.entries(q.properties ?? {})
        .filter(([id]) => id !== 'geometry')
        .map(([id, def]) => ({ id, type: def.type === 'number' || def.type === 'integer' ? 'number' : /date/.test(def.type ?? '') ? 'timestamp' : 'string', label: def.title }))
    } catch { /* queryables optional */ }

    // One sample item gives fallback fields AND the raster assets on offer.
    let sampleItem: { properties?: Record<string, unknown>; assets?: Record<string, { title?: string; type?: string }> } | undefined
    let total: number | undefined
    try {
      const sample = await postJson(`${ctx.baseUrl}/search`, { collections: [sel.collection], limit: 1 }) as {
        features?: { properties?: Record<string, unknown>; assets?: Record<string, { title?: string; type?: string }> }[]
        numberMatched?: number
      }
      sampleItem = sample.features?.[0]
      if (typeof sample.numberMatched === 'number') total = sample.numberMatched
    } catch { /* sample optional */ }

    if (fields.length === 0) {
      const props = sampleItem?.properties ?? {}
      fields = Object.entries(props).map(([id, v]) => ({ id, type: /datetime|date/.test(id) ? 'timestamp' : typeof v === 'number' ? 'number' : 'string' }))
    }

    // COG/GeoTIFF assets — offered as an "import as raster" alternative to
    // the sf footprint import.
    const rasterAssets = Object.entries(sampleItem?.assets ?? {})
      .filter(([, a]) => /tiff|geotiff|cog|jp2/i.test(a.type ?? ''))
      .map(([key, a]) => ({ key, title: a.title, type: a.type }))

    return {
      fields,
      spatial: true,
      queryable: true,
      total,
      rasterAssets: rasterAssets.length > 0 ? rasterAssets : undefined,
    }
  },

  // How many items the server returns per request, and whether the collection
  // is large enough to prompt. A STAC search response carries `numberMatched`,
  // so one successful probe gives both the working page size and the total.
  async probeCapacity(sel, query, ctx): Promise<CapacityProbe> {
    const requested = Math.min(query.limit, PROBE_CEIL)
    const base = searchBody(sel.collection, query, requested)
    let size = requested
    let working = 0
    let total: number | undefined
    while (size >= PROBE_FLOOR) {
      try {
        const data = await postJson(`${ctx.baseUrl}/search`, { ...base, limit: size }) as { numberMatched?: number }
        working = size
        if (typeof data.numberMatched === 'number') total = data.numberMatched
        break
      } catch {
        size = Math.floor(size / 2) // server rejected this page size — halve
      }
    }
    if (working === 0) working = PROBE_FLOOR // give up gracefully; R still backs off
    const reduced = working < requested
    // Prompt when the server capped us, or the collection far exceeds one page.
    const prompt = reduced || (total != null && total > working)
    return { requestedPageSize: requested, workingPageSize: working, reduced, prompt, total }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'timestamp') return ['on', 'before', 'after', 'dateBetween']
    if (kind === 'numeric') return ['eq']
    return ['is']
  },

  async preview(sel, query, ctx) {
    const data = await postJson(`${ctx.baseUrl}/search`, searchBody(sel.collection, query, query.limit)) as {
      features?: { id?: string; properties?: Record<string, unknown> }[]
    }
    return (data.features ?? []).map((ft) => ({ id: ft.id, ...(ft.properties ?? {}) }))
  },

  buildCode(sel, query, varName, ctx, opts?: BuildCodeOptions) {
    // Build the search body WITHOUT `limit` — ourgeo_read_stac() owns paging and
    // sets a safe per-page limit, following rel:"next" tokens up to max_items.
    // (STAC `limit` is a per-page cap the server enforces — Earth Search 502s on
    // limit>1000 — not a total, so passing the total directly fails.)
    const b = searchBody(sel.collection, query, query.limit)
    delete b.limit
    const body = JSON.stringify(b)

    // Raster asset mode: read the chosen asset of the first N matched items as
    // lazy /vsicurl/ SpatRasters (single item → SpatRaster, several → list).
    if (opts?.rasterAsset) {
      const maxItems = Math.max(1, opts.rasterMaxItems ?? 1)
      return [
        'library(httr2); library(terra)',
        '',
        `# STAC raster assets ("${opts.rasterAsset}") — ${ctx.baseUrl}`,
        `${varName} <- ourgeo_read_stac_rasters(`,
        `  search_url = "${ctx.baseUrl}/search",`,
        `  body       = r"(${body})",`,
        `  asset      = "${opts.rasterAsset}",`,
        `  max_items  = ${maxItems}L`,
        ')',
      ].join('\n')
    }

    const pageSize = Math.max(1, Math.min(opts?.pageSize ?? IMPORT_PAGE_SIZE, query.limit))
    return [
      'library(httr2); library(sf)',
      '',
      `# STAC item search (paginated footprints + metadata) — ${ctx.baseUrl}`,
      `${varName} <- ourgeo_read_stac(`,
      `  search_url = "${ctx.baseUrl}/search",`,
      `  body       = r"(${body})",`,
      `  max_items  = ${query.limit}L,`,
      `  page_size  = ${pageSize}L`,
      ')',
    ].join('\n')
  },
}
