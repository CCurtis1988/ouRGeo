// OData v4 provider — queryable enterprise/statistical REST with $filter/$select/$top.
// Field types are inferred from a sample row (avoids parsing $metadata XML).

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type Filter, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, BuildCodeOptions, CapacityProbe } from './types'

const IMPORT_PAGE_SIZE = 1000 // default rows/request (matches ourgeo_read_odata)

async function getJson(url: string): Promise<unknown> {
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from OData service`)
  return JSON.parse(text)
}

// Total rows matching a $filter via OData $count, or undefined if unsupported.
async function countRows(entityUrl: string, filter: string): Promise<number | undefined> {
  try {
    const params = new URLSearchParams({ $count: 'true', $top: '0', $format: 'json' })
    if (filter) params.set('$filter', filter)
    const d = await getJson(`${entityUrl}?${params}`) as { '@odata.count'?: number }
    return typeof d['@odata.count'] === 'number' ? d['@odata.count'] : undefined
  } catch {
    return undefined
  }
}

const isOdataMeta = (k: string) => k.startsWith('@odata') || k.startsWith('@')

function inferFields(row: Record<string, unknown> | undefined): Field[] {
  if (!row) return []
  return Object.entries(row)
    .filter(([k, v]) => !isOdataMeta(k) && typeof v !== 'object')
    .map(([k, v]) => ({ id: k, type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string' }))
}

// ── $filter serialization ───────────────────────────────────────────────────
const oNum = (v: string) => { const n = Number(v); return Number.isFinite(n) && v.trim() !== '' ? String(n) : oStr(v) }
const oStr = (v: string) => `'${v.replace(/'/g, "''")}'`
const oLit = (f: Filter, v = f.value) => (f.kind === 'numeric' ? oNum(v) : f.kind === 'timestamp' ? v.trim() : oStr(v))

export function buildODataFilter(query: Query): string {
  const cl: string[] = []
  for (const f of completeFilters(query)) {
    const c = f.field
    switch (f.op) {
      case 'is': case 'eq': case 'on': cl.push(`${c} eq ${oLit(f)}`); break
      case 'isAnyOf': cl.push(`(${(f.values ?? []).map((v) => `${c} eq ${oLit(f, v)}`).join(' or ')})`); break
      case 'contains': cl.push(`contains(${c},${oStr(f.value)})`); break
      case 'lt': case 'before': cl.push(`${c} lt ${oLit(f)}`); break
      case 'lte': cl.push(`${c} le ${oLit(f)}`); break
      case 'gt': case 'after': cl.push(`${c} gt ${oLit(f)}`); break
      case 'gte': cl.push(`${c} ge ${oLit(f)}`); break
      case 'between': case 'dateBetween': cl.push(`(${c} ge ${oLit(f, f.value)} and ${c} le ${oLit(f, f.value2 ?? '')})`); break
    }
  }
  return cl.join(' and ')
}

export const odataProvider: ApiProvider = {
  id: 'odata',
  label: 'OData',
  category: 'Statistics',
  description: 'OData v4 services. Pick an entity set; query with $filter / $select / $top.',
  builtinServers: [
    { id: 'northwind', label: 'Northwind (demo)', baseUrl: 'https://services.odata.org/V4/Northwind/Northwind.svc' },
    { id: 'trippin', label: 'TripPin (demo)', baseUrl: 'https://services.odata.org/TripPinRESTierService' },
  ],
  cascade: [{ key: 'entitySet', label: 'Entity set', placeholder: 'Select an entity set' }],

  async listLevel(_levelKey, _sel, ctx) {
    const data = await getJson(`${ctx.baseUrl}/?$format=json`) as { value?: { name: string; kind?: string; url?: string }[] }
    return (data.value ?? [])
      .filter((e) => e.name && (e.kind === undefined || e.kind === 'EntitySet'))
      .map((e) => ({ value: e.url ?? e.name, label: e.name }))
  },

  async getMetadata(sel, ctx) {
    const data = await getJson(`${ctx.baseUrl}/${sel.entitySet}?$top=1&$format=json`) as { value?: Record<string, unknown>[] }
    const total = await countRows(`${ctx.baseUrl}/${sel.entitySet}`, '')
    return { fields: inferFields(data.value?.[0]), spatial: false, queryable: true, total }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'text') return ['is', 'isAnyOf', 'contains']
    if (kind === 'numeric') return ['eq', 'lt', 'lte', 'gt', 'gte', 'between']
    return ['on', 'before', 'after', 'dateBetween']
  },

  async distinctValues(sel, field, ctx) {
    const data = await getJson(`${ctx.baseUrl}/${sel.entitySet}?$select=${encodeURIComponent(field)}&$top=1000&$format=json`) as { value?: Record<string, unknown>[] }
    const seen = new Set<string>()
    for (const r of data.value ?? []) { const v = r[field]; if (v != null) seen.add(String(v)) }
    return [...seen].sort((a, b) => a.localeCompare(b))
  },

  async preview(sel, query, ctx) {
    const filter = buildODataFilter(query)
    const params = new URLSearchParams()
    params.set('$top', String(query.limit))
    params.set('$format', 'json')
    if (filter) params.set('$filter', filter)
    const data = await getJson(`${ctx.baseUrl}/${sel.entitySet}?${params}`) as { value?: Record<string, unknown>[] }
    return (data.value ?? []).map((r) => {
      const o: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) if (!isOdataMeta(k)) o[k] = v
      return o
    })
  },

  // Large entity sets prompt the row-based dialog (like STAC). No page-size
  // failure mode here, so `reduced` is always false.
  async probeCapacity(sel, query, ctx): Promise<CapacityProbe> {
    const filter = buildODataFilter(query)
    const total = await countRows(`${ctx.baseUrl}/${sel.entitySet}`, filter)
    return {
      requestedPageSize: IMPORT_PAGE_SIZE,
      workingPageSize: IMPORT_PAGE_SIZE,
      reduced: false,
      prompt: total != null && total > IMPORT_PAGE_SIZE,
      total,
    }
  },

  buildCode(sel, query, varName, ctx, opts?: BuildCodeOptions) {
    const filter = buildODataFilter(query)
    const pageSize = Math.max(1, Math.min(opts?.pageSize ?? IMPORT_PAGE_SIZE, query.limit))
    const rRaw = (s: string) => `r"(${s})"`
    // ourgeo_read_odata() (r/lib/util-odata.R) paginates $top/$skip with a
    // proper timeout + retry, so transient slowness from a shared service no
    // longer aborts the import at httr2's short default timeout.
    return [
      `# OData v4 — ${ctx.baseUrl}`,
      `${varName} <- ourgeo_read_odata(`,
      `  base_url    = "${ctx.baseUrl}/${sel.entitySet}",`,
      ...(filter ? [`  filter      = ${rRaw(filter)},`] : []),
      `  max_records = ${query.limit}L,`,
      `  page_size   = ${pageSize}L`,
      ')',
    ].join('\n')
  },
}
