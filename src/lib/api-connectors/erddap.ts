// ERDDAP provider — environmental tabledap datasets. Cascade is a single dataset
// level; variables become the queryable fields; constraints map to ERDDAP's query
// grammar. Import uses ERDDAP's CSV-with-units-in-header (.csvp) → read.csv.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type Filter, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider } from './types'

interface ErddapTable { table?: { columnNames: string[]; columnTypes?: string[]; rows: unknown[][] } }

export type ErddapTableData = NonNullable<ErddapTable['table']>

export async function getTable(url: string): Promise<ErddapTable['table']> {
  const res = await proxyFetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from ERDDAP`)
  return (JSON.parse(text) as ErddapTable).table
}

export const col = (t: ErddapTableData, name: string) => t.columnNames.indexOf(name)

// ── Constraint serialization (shared by preview + codegen) ──────────────────
const eStr = (v: string) => `"${v.replace(/"/g, '\\"')}"`
const eVal = (f: Filter, v = f.value) => (f.kind === 'text' ? eStr(v) : v.trim())

export function buildErddapConstraints(query: Query): string[] {
  const out: string[] = []
  for (const f of completeFilters(query)) {
    const c = f.field
    switch (f.op) {
      case 'is': case 'eq': case 'on': out.push(`${c}=${eVal(f)}`); break
      case 'isAnyOf': out.push(`${c}=~${eStr(`^(${(f.values ?? []).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`)}`); break
      case 'contains': out.push(`${c}=~${eStr(`.*${f.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`)}`); break
      case 'lt': case 'before': out.push(`${c}<${eVal(f)}`); break
      case 'lte': out.push(`${c}<=${eVal(f)}`); break
      case 'gt': case 'after': out.push(`${c}>${eVal(f)}`); break
      case 'gte': out.push(`${c}>=${eVal(f)}`); break
      case 'between': case 'dateBetween': out.push(`${c}>=${eVal(f, f.value)}`); out.push(`${c}<=${eVal(f, f.value2 ?? '')}`); break
    }
  }
  return out
}

/** ERDDAP query string with all variables + constraints (leading & = all vars). */
function erddapQuery(query: Query, limit?: number): string {
  const parts = buildErddapConstraints(query)
  if (limit) parts.push(`orderByLimit(${encodeURIComponent(`"${limit}"`)})`)
  return parts.map((p) => `&${p}`).join('')
}

export const erddapProvider: ApiProvider = {
  id: 'erddap',
  label: 'ERDDAP',
  category: 'Scientific',
  description: 'ERDDAP environmental data servers (tabledap). Pick a dataset; constrain by variable.',
  docsUrl: 'https://www.ncei.noaa.gov/erddap/tabledap/documentation.html',
  builtinServers: [
    { id: 'ncei', label: 'NOAA NCEI', baseUrl: 'https://www.ncei.noaa.gov/erddap' },
    { id: 'ioos', label: 'IOOS Sensors', baseUrl: 'https://erddap.sensors.ioos.us/erddap' },
    { id: 'coastwatch', label: 'NOAA CoastWatch West Coast', baseUrl: 'https://coastwatch.pfeg.noaa.gov/erddap' },
  ],
  cascade: [{ key: 'dataset', label: 'Dataset', placeholder: 'Select a dataset' }],

  async listLevel(_levelKey, _sel, ctx) {
    const t = await getTable(`${ctx.baseUrl}/tabledap/allDatasets.json?datasetID,title,dataStructure&dataStructure=${encodeURIComponent('"table"')}`)
    if (!t) return []
    const idI = col(t, 'datasetID'); const titleI = col(t, 'title')
    return t.rows
      .map((r) => ({ id: String(r[idI]), title: String(r[titleI] ?? r[idI]) }))
      .filter((d) => d.id && d.id !== 'allDatasets')
      .map((d) => ({ value: d.id, label: d.title }))
  },

  async getMetadata(sel, ctx) {
    const t = await getTable(`${ctx.baseUrl}/info/${sel.dataset}/index.json`)
    if (!t) return { fields: [], spatial: false, queryable: false, note: 'Could not read dataset info.' }
    const rowTypeI = col(t, 'Row Type'); const nameI = col(t, 'Variable Name'); const typeI = col(t, 'Data Type')
    const fields: Field[] = t.rows
      .filter((r) => r[rowTypeI] === 'variable')
      .map((r) => ({ id: String(r[nameI]), type: String(r[typeI] ?? 'String') }))
    return { fields, spatial: false, queryable: true }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    if (kind === 'text') return ['is', 'isAnyOf', 'contains']
    if (kind === 'numeric') return ['eq', 'lt', 'lte', 'gt', 'gte', 'between']
    return ['on', 'before', 'after', 'dateBetween']
  },

  async distinctValues(sel, field, ctx) {
    const t = await getTable(`${ctx.baseUrl}/tabledap/${sel.dataset}.json?${encodeURIComponent(field)}&distinct()`)
    return (t?.rows ?? []).map((r) => r[0]).filter((v) => v != null).map(String)
  },

  async preview(sel, query, ctx) {
    const t = await getTable(`${ctx.baseUrl}/tabledap/${sel.dataset}.json?${erddapQuery(query, query.limit)}`)
    if (!t) return []
    return t.rows.map((r) => {
      const o: Record<string, unknown> = {}
      t.columnNames.forEach((name, i) => { o[name] = r[i] })
      return o
    })
  },

  buildCode(sel, query, varName, ctx) {
    const q = erddapQuery(query, query.limit)
    const url = `${ctx.baseUrl}/tabledap/${sel.dataset}.csvp?${q}`
    return [
      `# ERDDAP tabledap — ${ctx.baseUrl}`,
      `# .csvp puts units in the header so read.csv gets clean column names.`,
      `${varName} <- read.csv(${`r"(${url})"`})`,
    ].join('\n')
  },
}
