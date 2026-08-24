// SDMX provider — statistical time-series (OECD, ECB, Eurostat, …). A dataflow's
// dimensions become the queryable fields; is/isAnyOf on dimensions build the SDMX
// key, timestamp filters map to startPeriod/endPeriod. Metadata + preview use the
// SDMX-JSON `jsondata` format; the R import uses SDMX-CSV (read.csv).
//
// NOTE: SDMX structure messages vary across servers; this targets the common
// SDMX 2.1 REST + JSON shape and is flagged for in-app verification.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, BuildCodeOptions, CapacityProbe } from './types'

// query.limit sentinel meaning "all observations" (no lastNObservations cap).
const ALL_OBS = 10_000_000
// Above this many series, a full-history import is large/slow — prompt the user.
const PROMPT_SERIES = 1000

interface SdmxDim { id: string; name?: string; values?: { id: string; name?: string }[] }
interface SdmxJson {
  dataSets?: { series?: Record<string, { observations?: Record<string, unknown[]> }> }[]
  structure?: { dimensions?: { series?: SdmxDim[]; observation?: SdmxDim[] }; name?: string }
}
interface SdmxCaps { seriesDims: string[] }

const isTimeDim = (id: string) => /time|period/i.test(id)

// Most SDMX servers serve structure (dataflow lists) as SDMX-ML XML and only data
// as JSON. The agency is part of the structure path and varies by server.
const AGENCY_BY_HOST: Record<string, string> = {
  'data-api.ecb.europa.eu': 'ECB',
  'sdmx.oecd.org': 'OECD',
  'ec.europa.eu': 'ESTAT',
}
function agencyFor(baseUrl: string): string {
  const host = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  for (const k of Object.keys(AGENCY_BY_HOST)) if (host.includes(k)) return AGENCY_BY_HOST[k]
  return 'all'
}

async function getJson(url: string, accept: string): Promise<unknown> {
  const res = await proxyFetch(url, { headers: { Accept: accept } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from SDMX service`)
  return JSON.parse(text)
}

function dimsOf(data: SdmxJson): { series: SdmxDim[]; observation: SdmxDim[] } {
  return { series: data.structure?.dimensions?.series ?? [], observation: data.structure?.dimensions?.observation ?? [] }
}

/** Flatten an SDMX-JSON data message into flat rows. */
function flatten(data: SdmxJson): Record<string, unknown>[] {
  const { series: sdim, observation: odim } = dimsOf(data)
  const series = data.dataSets?.[0]?.series ?? {}
  const rows: Record<string, unknown>[] = []
  for (const [skey, sval] of Object.entries(series)) {
    const sidx = skey.split(':').map(Number)
    const base: Record<string, unknown> = {}
    sdim.forEach((d, i) => { base[d.id] = d.values?.[sidx[i]]?.id })
    for (const [okey, oval] of Object.entries(sval.observations ?? {})) {
      const oidx = okey.split(':').map(Number)
      const row = { ...base }
      odim.forEach((d, i) => { row[d.id] = d.values?.[oidx[i]]?.id })
      row.OBS_VALUE = Array.isArray(oval) ? oval[0] : oval
      rows.push(row)
    }
  }
  return rows
}

/** SDMX key (positional dims joined by '.') + time bounds from the query. */
function buildKey(query: Query, seriesDims: string[]): { key: string; start?: string; end?: string } {
  const parts = seriesDims.map((dimId) => {
    const codes: string[] = []
    for (const f of completeFilters(query)) {
      if (f.field !== dimId) continue
      if (f.op === 'is') codes.push(f.value)
      else if (f.op === 'isAnyOf') codes.push(...(f.values ?? []))
    }
    return codes.join('+')
  })
  let start: string | undefined; let end: string | undefined
  for (const f of completeFilters(query)) {
    if (f.kind !== 'timestamp') continue
    if (f.op === 'after' || f.op === 'on') start = f.value
    else if (f.op === 'before') end = f.value
    else if (f.op === 'dateBetween') { start = f.value; end = f.value2 }
  }
  const key = parts.join('.')
  return { key: key.replace(/\.+$/, '') || 'all', start, end }
}

export const sdmxProvider: ApiProvider = {
  id: 'sdmx',
  label: 'SDMX',
  category: 'Statistics',
  description: 'SDMX statistical data (ECB, OECD, Eurostat). Pick a dataflow; filter by dimension.',
  builtinServers: [
    { id: 'ecb', label: 'European Central Bank', baseUrl: 'https://data-api.ecb.europa.eu/service' },
    { id: 'oecd', label: 'OECD', baseUrl: 'https://sdmx.oecd.org/public/rest' },
    { id: 'estat', label: 'Eurostat', baseUrl: 'https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1' },
  ],
  cascade: [{ key: 'dataflow', label: 'Dataflow', placeholder: 'Select a dataflow' }],

  async listLevel(_levelKey, _sel, ctx) {
    // Fetch the agency's dataflows as raw text — handle both SDMX-ML (XML, the
    // common default) and SDMX-JSON.
    const res = await proxyFetch(`${ctx.baseUrl}/dataflow/${agencyFor(ctx.baseUrl)}`)
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} from SDMX service`)
    if (text.trim().startsWith('<')) {
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      return Array.from(doc.getElementsByTagNameNS('*', 'Dataflow'))
        .map((df) => ({
          value: df.getAttribute('id') ?? '',
          label: df.getElementsByTagNameNS('*', 'Name')[0]?.textContent ?? df.getAttribute('id') ?? '',
        }))
        .filter((o) => o.value)
    }
    const d = JSON.parse(text) as Record<string, unknown>
    const root = (d.data ?? d.structure ?? d) as Record<string, unknown>
    const flows = (root.dataflows ?? []) as { id: string; name?: string; names?: { en?: string } }[]
    return flows.map((f) => ({ value: f.id, label: f.name ?? f.names?.en ?? f.id })).filter((o) => o.value)
  },

  async getMetadata(sel, ctx) {
    const data = await getJson(`${ctx.baseUrl}/data/${sel.dataflow}/all?format=jsondata&lastNObservations=1`, 'application/vnd.sdmx.data+json') as SdmxJson
    const { series, observation } = dimsOf(data)
    const fields: Field[] = [...series, ...observation].map((d) => ({
      id: d.id, type: isTimeDim(d.id) ? 'timestamp' : 'text', label: d.name,
    }))
    // Stash codelist values for the value dropdowns + the dimension order for keys.
    const cacheKey = `${ctx.baseUrl}::${sel.dataflow}`
    distinctCache.set(cacheKey, Object.fromEntries(
      [...series, ...observation].map((d) => [d.id, (d.values ?? []).map((v) => v.id)]),
    ))
    capsCache.set(cacheKey, { seriesDims: series.map((d) => d.id) })
    return { fields, spatial: false, queryable: true, caps: { seriesDims: series.map((d) => d.id) } as SdmxCaps }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'timestamp') return ['on', 'before', 'after', 'dateBetween']
    return ['is', 'isAnyOf'] // dimensions select codes for the SDMX key
  },

  async distinctValues(sel, field, ctx) {
    return distinctCache.get(`${ctx.baseUrl}::${sel.dataflow}`)?.[field] ?? []
  },

  async preview(sel, query, ctx) {
    const caps = (capsCache.get(`${ctx.baseUrl}::${sel.dataflow}`)) ?? { seriesDims: [] }
    const { key, start, end } = buildKey(query, caps.seriesDims)
    const params = new URLSearchParams({ format: 'jsondata' })
    if (start) params.set('startPeriod', start)
    if (end) params.set('endPeriod', end)
    params.set('lastNObservations', String(Math.min(query.limit, 50)))
    const data = await getJson(`${ctx.baseUrl}/data/${sel.dataflow}/${key}?${params}`, 'application/vnd.sdmx.data+json') as SdmxJson
    return flatten(data).slice(0, query.limit)
  },

  buildCode(sel, query, varName, ctx, opts?: BuildCodeOptions) {
    void opts // SDMX isn't paginated; the size choice comes through query.limit
    const caps = (capsCache.get(`${ctx.baseUrl}::${sel.dataflow}`)) ?? { seriesDims: [] }
    const { key, start, end } = buildKey(query, caps.seriesDims)
    const params = new URLSearchParams({ format: 'csvdata' })
    if (start) params.set('startPeriod', start)
    if (end) params.set('endPeriod', end)
    const url = `${ctx.baseUrl}/data/${sel.dataflow}/${key}?${params}`
    // query.limit is interpreted as observations-per-series (lastNObservations);
    // the ALL_OBS sentinel means "no cap". ourgeo_read_sdmx() fetches over httr2
    // (robust TLS + long timeout) instead of read.csv()'s url() connection.
    const lastN = query.limit > 0 && query.limit < ALL_OBS ? query.limit : null
    return [
      `# SDMX (SDMX-CSV) — ${ctx.baseUrl}`,
      `${varName} <- ourgeo_read_sdmx(`,
      `  url        = r"(${url})"${lastN != null ? ',' : ''}`,
      ...(lastN != null ? [`  last_n_obs = ${lastN}L`] : []),
      ')',
    ].join('\n')
  },

  // SDMX isn't row-paginated; the meaningful size axis is observations per
  // series. Probe the (cheap) series-keys-only endpoint to gauge how many series
  // the query spans, and offer observation-count choices for large dataflows.
  async probeCapacity(sel, query, ctx): Promise<CapacityProbe> {
    const caps = (capsCache.get(`${ctx.baseUrl}::${sel.dataflow}`)) ?? { seriesDims: [] }
    const { key, start, end } = buildKey(query, caps.seriesDims)
    const params = new URLSearchParams({ format: 'jsondata', detail: 'serieskeysonly', lastNObservations: '1' })
    if (start) params.set('startPeriod', start)
    if (end) params.set('endPeriod', end)

    let seriesCount = 0
    try {
      const data = await getJson(`${ctx.baseUrl}/data/${sel.dataflow}/${key}?${params}`, 'application/vnd.sdmx.data+json') as SdmxJson
      seriesCount = Object.keys(data.dataSets?.[0]?.series ?? {}).length
    } catch { /* fall through — no prompt if we can't gauge it */ }

    const prompt = seriesCount > PROMPT_SERIES
    const approx = seriesCount > 0 ? `≈${seriesCount.toLocaleString()} rows` : undefined
    return {
      requestedPageSize: seriesCount,
      workingPageSize: seriesCount,
      reduced: false,
      prompt,
      unit: 'obs/series',
      description:
        `This dataflow spans ${seriesCount.toLocaleString()} series, so a full-history import is very large ` +
        `(the “all” query can time out). Choose how many recent observations per series to import.`,
      choices: [
        { label: 'Latest value only', limit: 1, note: approx },
        { label: 'Last 4 per series', limit: 4 },
        { label: 'Last 12 per series', limit: 12 },
        { label: 'All history', limit: ALL_OBS, note: 'every observation — may be very slow' },
      ],
    }
  },
}

// Per-(server,dataflow) caches populated in getMetadata.
const distinctCache = new Map<string, Record<string, string[]>>()
const capsCache = new Map<string, SdmxCaps>()
