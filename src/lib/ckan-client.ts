// Portal-agnostic CKAN Action API client. Every function takes the portal's
// base URL (e.g. "https://data.cnra.ca.gov") and goes through `proxyFetch` so the
// renderer can reach any portal with Electron's webSecurity enabled.
//
// Used by the Data Connector's CKAN browser to drive the Organization → Dataset →
// Resource cascade and the metadata-aware query builder. The final data import is
// generated R code (see buildCkanDatastoreCode); this client only powers the UI.

import { proxyFetch } from '@/lib/ai-proxy-fetch'

// ── Types ───────────────────────────────────────────────────────────────────
export interface CkanOrganization {
  id: string
  name: string
  title: string
  packageCount: number
}

export interface CkanResource {
  id: string
  name: string
  format: string
  datastoreActive: boolean
  url: string
}

export interface CkanDataset {
  id: string
  name: string
  title: string
  notes: string
  resources: CkanResource[]
}

/** A datastore field's id and CKAN type (e.g. text, numeric, int4, timestamp). */
export interface CkanField {
  id: string
  type: string
}

export type CkanFieldKind = 'text' | 'numeric' | 'timestamp'

export type CkanFilterOp =
  | 'is' | 'isAnyOf' | 'contains'                 // text
  | 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' // numeric
  | 'on' | 'before' | 'after' | 'dateBetween'      // timestamp

export interface CkanFilter {
  id: string
  field: string
  kind: CkanFieldKind
  op: CkanFilterOp
  /** Single value (is/contains/comparisons) or the lower bound of a range. */
  value: string
  /** Upper bound for between / dateBetween. */
  value2?: string
  /** Selected values for isAnyOf (IN). */
  values?: string[]
}

export interface CkanQuery {
  filters: CkanFilter[]
  /** Global full-text search across all fields. */
  q: string
  /** Max rows to import. */
  limit: number
}

// ── Field-type classification ───────────────────────────────────────────────
/** Map a raw CKAN/PostgreSQL field type to a UI kind. */
export function fieldKind(type: string): CkanFieldKind {
  const t = type.toLowerCase()
  if (t.includes('timestamp') || t.includes('date') || t === 'time') return 'timestamp'
  if (
    t.startsWith('int') || t.startsWith('float') || t.startsWith('numeric') ||
    t.startsWith('double') || t.startsWith('real') || t === 'bigint' ||
    t === 'smallint' || t.includes('serial')
  ) return 'numeric'
  return 'text'
}

// ── Low-level action caller ─────────────────────────────────────────────────
interface CkanEnvelope<T> {
  success: boolean
  result?: T
  error?: unknown
}

function ckanErrorMessage(error: unknown, status: number): string {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (typeof e.message === 'string') return e.message
    // datastore_search_sql errors arrive as { info: { orig: [...] }, __type }
    const info = e.info as Record<string, unknown> | undefined
    if (info && Array.isArray(info.orig) && typeof info.orig[0] === 'string') return info.orig[0]
    if (typeof e.__type === 'string') return e.__type
  }
  return `Request failed (HTTP ${status})`
}

function actionUrl(baseUrl: string, action: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  }
  const base = baseUrl.replace(/\/+$/, '')
  const query = qs.toString()
  return `${base}/api/3/action/${action}${query ? `?${query}` : ''}`
}

async function ckanAction<T>(
  baseUrl: string, action: string, params: Record<string, string | number | undefined>,
): Promise<T> {
  const res = await proxyFetch(actionUrl(baseUrl, action, params))
  const text = await res.text()
  let data: CkanEnvelope<T>
  try {
    data = JSON.parse(text) as CkanEnvelope<T>
  } catch {
    throw new Error(`Invalid response from portal (HTTP ${res.status})`)
  }
  if (!data.success || !res.ok) throw new Error(ckanErrorMessage(data.error, res.status))
  return data.result as T
}

// ── Organizations ───────────────────────────────────────────────────────────
export async function listOrganizations(baseUrl: string): Promise<CkanOrganization[]> {
  type Raw = { id: string; name: string; title?: string; display_name?: string; package_count?: number }
  const result = await ckanAction<Raw[]>(baseUrl, 'organization_list', { all_fields: 'true' })
  return result
    .map((o) => ({
      id: o.id,
      name: o.name,
      title: o.title || o.display_name || o.name,
      packageCount: o.package_count ?? 0,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

// ── Datasets for an organization ────────────────────────────────────────────
interface PackageSearchResult {
  count: number
  results: {
    id: string
    name: string
    title?: string
    notes?: string
    resources?: { id: string; name?: string; format?: string; datastore_active?: boolean; url?: string }[]
  }[]
}

function mapDataset(pkg: PackageSearchResult['results'][number]): CkanDataset {
  return {
    id: pkg.id,
    name: pkg.name,
    title: pkg.title || pkg.name,
    notes: pkg.notes ?? '',
    resources: (pkg.resources ?? []).map((r) => ({
      id: r.id,
      name: r.name || r.id,
      format: (r.format ?? '').toUpperCase(),
      datastoreActive: r.datastore_active === true,
      url: r.url ?? '',
    })),
  }
}

/** List datasets (with their resources) for an organization. Pages up to `max`. */
export async function listDatasets(
  baseUrl: string, orgId: string, max = 1000,
): Promise<CkanDataset[]> {
  const pageSize = 100
  const datasets: CkanDataset[] = []
  let start = 0
  for (;;) {
    const result = await ckanAction<PackageSearchResult>(baseUrl, 'package_search', {
      fq: `owner_org:${orgId}`,
      rows: pageSize,
      start,
    })
    datasets.push(...result.results.map(mapDataset))
    start += result.results.length
    if (result.results.length === 0 || start >= Math.min(result.count, max)) break
  }
  return datasets.sort((a, b) => a.title.localeCompare(b.title))
}

// ── Datastore field metadata ────────────────────────────────────────────────
interface DatastoreSearchResult {
  fields: CkanField[]
  total: number
  records: Record<string, unknown>[]
}

/** Field list + total row count for a datastore resource (limit=0 returns no rows). */
export async function getFields(
  baseUrl: string, resourceId: string,
): Promise<{ fields: CkanField[]; total: number }> {
  const result = await ckanAction<DatastoreSearchResult>(baseUrl, 'datastore_search', {
    resource_id: resourceId,
    limit: 0,
  })
  // Drop CKAN's internal _id / rank columns from the user-facing field list.
  const fields = (result.fields ?? []).filter((f) => f.id !== '_id' && !f.id.startsWith('_'))
  return { fields, total: result.total ?? 0 }
}

// ── Record search (preview) ─────────────────────────────────────────────────
export async function searchRecords(
  baseUrl: string, resourceId: string,
  opts: { filters?: string; q?: string; limit: number; offset?: number },
): Promise<{ records: Record<string, unknown>[]; total: number }> {
  const result = await ckanAction<DatastoreSearchResult>(baseUrl, 'datastore_search', {
    resource_id: resourceId,
    limit: opts.limit,
    offset: opts.offset,
    filters: opts.filters,
    q: opts.q,
  })
  return { records: result.records ?? [], total: result.total ?? 0 }
}

// ── SQL availability (cached per resource) ──────────────────────────────────
const sqlAvailableCache = new Map<string, boolean>()

export async function sqlAvailable(baseUrl: string, resourceId: string): Promise<boolean> {
  const key = `${baseUrl}::${resourceId}`
  const cached = sqlAvailableCache.get(key)
  if (cached !== undefined) return cached
  let ok = false
  try {
    await ckanAction<DatastoreSearchResult>(baseUrl, 'datastore_search_sql', {
      sql: `SELECT * FROM "${resourceId.replace(/"/g, '""')}" LIMIT 1`,
    })
    ok = true
  } catch {
    ok = false
  }
  sqlAvailableCache.set(key, ok)
  return ok
}

// ── Distinct values for a field (powers value dropdowns) ────────────────────
/** Distinct, non-null values for a field. Uses SQL DISTINCT when available,
 *  otherwise samples records and derives uniques client-side. */
export async function distinctValues(
  baseUrl: string, resourceId: string, field: string, max = 1000,
): Promise<string[]> {
  const safeRes = resourceId.replace(/"/g, '""')
  const safeField = field.replace(/"/g, '""')
  if (await sqlAvailable(baseUrl, resourceId)) {
    try {
      const result = await ckanAction<DatastoreSearchResult>(baseUrl, 'datastore_search_sql', {
        sql: `SELECT DISTINCT "${safeField}" FROM "${safeRes}" WHERE "${safeField}" IS NOT NULL ORDER BY 1 LIMIT ${max}`,
      })
      return result.records
        .map((r) => r[field])
        .filter((v): v is string | number => v != null)
        .map(String)
    } catch {
      /* fall through to sampling */
    }
  }
  // Fallback: sample rows and dedupe locally
  const { records } = await searchRecords(baseUrl, resourceId, { limit: 5000 })
  const seen = new Set<string>()
  for (const r of records) {
    const v = r[field]
    if (v != null) seen.add(String(v))
    if (seen.size >= max) break
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

export async function searchSql(
  baseUrl: string, sql: string,
): Promise<{ records: Record<string, unknown>[] }> {
  const result = await ckanAction<DatastoreSearchResult>(baseUrl, 'datastore_search_sql', { sql })
  return { records: result.records ?? [] }
}

// ── Query → CKAN parameters (single source of truth for preview + code-gen) ──
// Operators datastore_search `filters` can express directly; everything else
// requires the SQL endpoint.
const FILTER_CAPABLE_OPS = new Set<CkanFilterOp>(['is', 'eq', 'isAnyOf'])

/** A filter is only applied once the user has supplied its value(s). Half-entered
 *  rows (a column chosen but no value yet) are ignored rather than sent — which
 *  would otherwise match nothing (e.g. `{"county_name":""}`). */
export function isCompleteFilter(f: CkanFilter): boolean {
  if (f.op === 'isAnyOf') return (f.values?.length ?? 0) > 0
  if (f.op === 'between' || f.op === 'dateBetween') return f.value.trim() !== '' && (f.value2 ?? '').trim() !== ''
  return f.value.trim() !== ''
}

function completeFilters(query: CkanQuery): CkanFilter[] {
  return query.filters.filter(isCompleteFilter)
}

export function queryNeedsSql(query: CkanQuery): boolean {
  return completeFilters(query).some((f) => !FILTER_CAPABLE_OPS.has(f.op))
}

/** datastore_search `filters` JSON for the equality/IN subset, or null if none. */
export function buildFiltersJson(query: CkanQuery): string | null {
  const obj: Record<string, string | string[]> = {}
  for (const f of completeFilters(query)) {
    if (f.op === 'is' || f.op === 'eq') obj[f.field] = f.value
    else if (f.op === 'isAnyOf') obj[f.field] = f.values!
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null
}

const sqlIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`
const sqlText = (v: string): string => `'${v.replace(/'/g, "''")}'`
const sqlNum = (v: string): string => {
  const n = Number(v)
  return Number.isFinite(n) && v.trim() !== '' ? String(n) : sqlText(v)
}

/** Build the WHERE body (without the WHERE keyword) for a SQL query. */
export function buildSqlWhere(query: CkanQuery): string {
  const clauses: string[] = []
  for (const f of completeFilters(query)) {
    const col = sqlIdent(f.field)
    switch (f.op) {
      case 'is': clauses.push(`${col} = ${sqlText(f.value)}`); break
      case 'eq': clauses.push(`${col} = ${sqlNum(f.value)}`); break
      case 'isAnyOf': {
        const vals = (f.values ?? []).map(sqlText).join(', ')
        if (vals) clauses.push(`${col} IN (${vals})`)
        break
      }
      case 'contains': clauses.push(`${col} ILIKE ${sqlText(`%${f.value}%`)}`); break
      case 'lt': clauses.push(`${col} < ${sqlNum(f.value)}`); break
      case 'lte': clauses.push(`${col} <= ${sqlNum(f.value)}`); break
      case 'gt': clauses.push(`${col} > ${sqlNum(f.value)}`); break
      case 'gte': clauses.push(`${col} >= ${sqlNum(f.value)}`); break
      case 'between': clauses.push(`${col} BETWEEN ${sqlNum(f.value)} AND ${sqlNum(f.value2 ?? '')}`); break
      case 'on': clauses.push(`${col} = ${sqlText(f.value)}`); break
      case 'before': clauses.push(`${col} < ${sqlText(f.value)}`); break
      case 'after': clauses.push(`${col} > ${sqlText(f.value)}`); break
      case 'dateBetween': clauses.push(`${col} BETWEEN ${sqlText(f.value)} AND ${sqlText(f.value2 ?? '')}`); break
    }
  }
  if (query.q.trim()) clauses.push(`_full_text @@ plainto_tsquery(${sqlText(query.q.trim())})`)
  return clauses.join(' AND ')
}

/** Full `SELECT * FROM "resource" [WHERE …] LIMIT n` for the SQL endpoint. */
export function buildSelectSql(resourceId: string, query: CkanQuery): string {
  const where = buildSqlWhere(query)
  return `SELECT * FROM ${sqlIdent(resourceId)}${where ? ` WHERE ${where}` : ''} LIMIT ${query.limit}`
}
