// Shared, provider-agnostic query model for the Data Connector's Web-API tabs.
// Every connector (CKAN, Socrata, Esri, OGC, WFS, ERDDAP, SDMX, STAC, OData)
// expresses user filters with this same Field/Filter/Query shape; each provider
// serializes it to its own query dialect (SoQL, ArcGIS `where`, OData `$filter`,
// CQL2, SDMX keys, …) and to reproducible R import code.

/** UI classification of a field, used to pick operators and value editors. */
export type FieldKind = 'text' | 'numeric' | 'timestamp'

/** A discoverable field/column/property/dimension on the selected resource. */
export interface Field {
  id: string
  /** Provider-native type string (e.g. CKAN `text`, esri `esriFieldTypeDouble`). */
  type: string
  /** Optional friendlier label (falls back to id). */
  label?: string
}

export type FilterOp =
  | 'is' | 'isAnyOf' | 'contains'                  // text
  | 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between'  // numeric
  | 'on' | 'before' | 'after' | 'dateBetween'       // timestamp

export interface Filter {
  id: string
  field: string
  kind: FieldKind
  op: FilterOp
  /** Single value (is/contains/comparisons) or the lower bound of a range. */
  value: string
  /** Upper bound for between / dateBetween. */
  value2?: string
  /** Selected values for isAnyOf (IN). */
  values?: string[]
}

export interface Query {
  filters: Filter[]
  /** Global full-text search across all fields (providers map or ignore it). */
  q: string
  /** Max rows to import. */
  limit: number
}

export const DEFAULT_QUERY: Query = { filters: [], q: '', limit: 5000 }

export const OP_LABELS: Record<FilterOp, string> = {
  is: 'is', isAnyOf: 'is any of', contains: 'contains',
  eq: '=', lt: '<', lte: '≤', gt: '>', gte: '≥', between: 'between',
  on: 'on', before: 'before', after: 'after', dateBetween: 'between',
}

/** Map a raw provider/SQL field type to a UI kind. */
export function fieldKind(type: string): FieldKind {
  const t = (type ?? '').toLowerCase()
  if (t.includes('timestamp') || t.includes('date') || t === 'time') return 'timestamp'
  if (t.includes('esrifieldtypedate')) return 'timestamp'
  if (
    t.startsWith('int') || t.startsWith('float') || t.startsWith('numeric') ||
    t.startsWith('double') || t.startsWith('real') || t === 'bigint' ||
    t === 'smallint' || t.includes('serial') ||
    // Socrata / OData / Esri numeric type strings
    t.includes('number') || t.includes('money') || t.includes('decimal') ||
    t.includes('double') || t.includes('single') ||
    t === 'esrifieldtypeinteger' || t === 'esrifieldtypeoid' ||
    t === 'esrifieldtypesmallinteger' || t === 'esrifieldtypedouble'
  ) return 'numeric'
  return 'text'
}

/** Default operator for a freshly-added filter on a field of this kind. */
export function defaultOp(kind: FieldKind): FilterOp {
  return kind === 'numeric' ? 'eq' : kind === 'timestamp' ? 'on' : 'is'
}

/** A filter is only applied once the user has supplied its value(s). Half-entered
 *  rows (a column chosen but no value yet) are ignored rather than sent. */
export function isCompleteFilter(f: Filter): boolean {
  if (f.op === 'isAnyOf') return (f.values?.length ?? 0) > 0
  if (f.op === 'between' || f.op === 'dateBetween') return f.value.trim() !== '' && (f.value2 ?? '').trim() !== ''
  return f.value.trim() !== ''
}

export function completeFilters(query: Query): Filter[] {
  return query.filters.filter(isCompleteFilter)
}

/** Full operator set a field kind can use when the backend supports everything.
 *  Providers narrow this via their own `opsFor` (e.g. SDMX dims = is/isAnyOf). */
export function defaultOpsFor(kind: FieldKind): FilterOp[] {
  if (kind === 'text') return ['is', 'isAnyOf', 'contains']
  if (kind === 'numeric') return ['eq', 'lt', 'lte', 'gt', 'gte', 'between']
  return ['on', 'before', 'after', 'dateBetween']
}
