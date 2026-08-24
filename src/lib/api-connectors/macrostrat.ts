// Macrostrat provider — the Macrostrat geology platform (macrostrat.org): a
// custom REST API over stratigraphic columns, geologic map units, and
// PBDB-matched fossil collections. Filtering is plain key=value params
// (comma-delimited for lists; age ranges via age_top/age_bottom), and every
// spatial route offers `format=geojson_bare` — a bare FeatureCollection that
// sf::st_read() reads straight off the URL, so imports need no R helper.
// Data is CC-BY 4.0.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, type Field, type FieldKind, type FilterOp, type Query } from './query-model'
import type { ApiProvider, ProviderContext } from './types'

interface RouteDef {
  path: string
  label: string
  fields: Field[]
  /** Data columns the rows actually carry (fields above are query params). */
  previewColumns: string[]
  /** Unfiltered = the whole database — demand a filter before fetching. */
  requiresFilter: boolean
  note: string
}

const F = (id: string, type: 'string' | 'number', label?: string): Field => ({ id, type, label })

// Curated routes + parameters (the API's docs are prose, not machine-readable).
// Id-like params are typed 'string': their ops are is/isAnyOf, which matches
// the API's equality/comma-list semantics; 'number' is reserved for fields
// where eq/between make sense (age maps to age_top/age_bottom).
const ROUTES: RouteDef[] = [
  {
    path: 'columns',
    label: 'Stratigraphic columns',
    previewColumns: ['col_id', 'col_name', 'col_group', 'col_area', 'lat', 'lng', 't_units'],
    requiresFilter: false,
    note: 'Regional stratigraphic column footprints (polygons) with unit/section counts. Data CC-BY 4.0.',
    fields: [
      F('interval_name', 'string', 'Geologic interval'),
      F('age', 'number', 'Age (Ma)'),
      F('lith', 'string', 'Lithology'),
      F('lith_type', 'string', 'Lithology type'),
      F('lith_class', 'string', 'Lithology class'),
      F('environ', 'string', 'Environment'),
      F('environ_type', 'string', 'Environment type'),
      F('strat_name', 'string', 'Stratigraphic name'),
      F('col_id', 'string', 'Column id'),
      F('project_id', 'string', 'Project id'),
      F('lat', 'number', 'Latitude (point query)'),
      F('lng', 'number', 'Longitude (point query)'),
    ],
  },
  {
    path: 'fossils',
    label: 'Fossil collections (PBDB)',
    previewColumns: ['cltn_id', 'cltn_name', 'col_id', 'unit_id', 't_age', 'b_age', 'pbdb_occs'],
    requiresFilter: true,
    note: 'Paleobiology Database collections matched to Macrostrat units (points). Add at least one filter — unfiltered is the entire database. Data CC-BY 4.0.',
    // lith_class is omitted: the fossils route 500s on it (verified 2026-07);
    // lith and lith_type cover the same ground.
    fields: [
      F('interval_name', 'string', 'Geologic interval'),
      F('age', 'number', 'Age (Ma)'),
      F('lith', 'string', 'Lithology'),
      F('lith_type', 'string', 'Lithology type'),
      F('environ', 'string', 'Environment'),
      F('environ_type', 'string', 'Environment type'),
      F('col_id', 'string', 'Column id'),
      F('unit_id', 'string', 'Unit id'),
      F('strat_name_id', 'string', 'Strat name id'),
    ],
  },
  {
    path: 'geologic_units/map',
    label: 'Geologic map units',
    previewColumns: ['map_id', 'source_id', 'name', 'strat_name', 'lith', 't_age', 'b_age'],
    requiresFilter: true,
    note: 'Mapped bedrock polygons. Query a point (lat + lng) or pull every polygon for a strat_name_id / unit_id / map_id; scale refines which resolution is searched. Data CC-BY 4.0.',
    fields: [
      F('lat', 'number', 'Latitude (point query)'),
      F('lng', 'number', 'Longitude (point query)'),
      F('scale', 'string', 'Map scale'),
      F('strat_name_id', 'string', 'Strat name id'),
      F('unit_id', 'string', 'Unit id'),
      F('map_id', 'string', 'Map polygon id'),
    ],
  },
  {
    path: 'paleogeography',
    label: 'Paleogeography',
    previewColumns: ['plate_id'],
    requiresFilter: true,
    note: 'Paleo-coastline reconstructions (polygons) for a point in time — filter by age (Ma) or interval name. Data CC-BY 4.0.',
    fields: [
      F('age', 'number', 'Age (Ma)'),
      F('interval_name', 'string', 'Geologic interval'),
    ],
  },
]

const routeFor = (sel: Record<string, string>): RouteDef => {
  const r = ROUTES.find((d) => d.path === sel.dataset)
  if (!r) throw new Error(`Unknown Macrostrat dataset "${sel.dataset}".`)
  return r
}

// ── param serialization ──────────────────────────────────────────────────────

/** Macrostrat query params from the shared query model. */
export function buildMacrostratParams(query: Query): URLSearchParams {
  const params = new URLSearchParams()
  for (const f of completeFilters(query)) {
    switch (f.op) {
      case 'is': case 'eq':
        params.set(f.field, f.value)
        break
      case 'isAnyOf': // the API takes comma-delimited lists
        params.set(f.field, (f.values ?? []).join(','))
        break
      case 'between':
        // Only age has range params (age_top = younger, age_bottom = older).
        if (f.field === 'age') {
          const [a, b] = [Number(f.value), Number(f.value2 ?? f.value)]
          params.set('age_top', String(Math.min(a, b)))
          params.set('age_bottom', String(Math.max(a, b)))
        }
        break
      default:
        break // other ops have no Macrostrat equivalent
    }
  }
  return params
}

const dataUrl = (ctx: ProviderContext, route: RouteDef, query: Query, format: string): string => {
  const params = buildMacrostratParams(query)
  params.set('format', format)
  return `${ctx.baseUrl}/${route.path}?${params}`
}

/** Query rules the server enforces with a bare HTTP 500 instead of a message.
 *  Shared by the provider's validateQuery hook and preview. */
export function macrostratQueryIssue(sel: Record<string, string>, query: Query): string | null {
  const route = ROUTES.find((d) => d.path === sel.dataset)
  if (!route) return null
  const filters = completeFilters(query)
  if (route.requiresFilter && filters.length === 0) {
    return `Add at least one filter — unfiltered ${route.label} is the entire database.`
  }
  if (route.path === 'geologic_units/map') {
    const p = buildMacrostratParams(query)
    const hasPoint = p.has('lat') && p.has('lng')
    const hasId = p.has('map_id') || p.has('strat_name_id') || p.has('unit_id')
    if (hasPoint || hasId) return null
    // Range ops on lat/lng serialize to nothing — say so instead of silently
    // producing a query the server will 500 on.
    if (filters.some((f) => (f.field === 'lat' || f.field === 'lng') && f.op === 'between')) {
      return "Use '=' for lat and lng — this route looks up the map units at a single point " +
        '(coordinate ranges are not supported). To pull an area of polygons, filter by ' +
        'strat_name_id, unit_id, or map_id instead.'
    }
    if (p.has('lat') || p.has('lng')) return 'A point query needs both lat and lng filters.'
    return 'Select map units by a point (add both lat and lng filters) or by id ' +
      '(strat_name_id, unit_id, or map_id). Scale alone only refines a query — ' +
      'the server rejects it by itself.'
  }
  return null
}

// ── API access (responses wrap payloads in success.data) ────────────────────

async function getData(url: string): Promise<unknown> {
  const res = await proxyFetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from Macrostrat`)
  const body = JSON.parse(text) as { success?: { data?: unknown }; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? 'Macrostrat API error')
  return body.success?.data
}

// Definition dictionaries backing the value dropdowns, cached per server.
const defsCache = new Map<string, string[]>()

async function defValues(ctx: ProviderContext, defRoute: string, pick: (row: Record<string, unknown>) => unknown): Promise<string[]> {
  const key = `${ctx.baseUrl}|${defRoute}|${pick.toString()}`
  const cached = defsCache.get(key)
  if (cached) return cached
  const data = await getData(`${ctx.baseUrl}/defs/${defRoute}?all`)
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  const values = Array.from(new Set(rows.map(pick).filter((v) => v != null && v !== '').map(String))).sort()
  defsCache.set(key, values)
  return values
}

export const macrostratProvider: ApiProvider = {
  id: 'macrostrat',
  label: 'Macrostrat',
  category: 'Geospatial',
  description: 'Macrostrat geology platform — stratigraphic columns, geologic map units, fossil collections, and paleogeography import as sf (CC-BY 4.0).',
  builtinServers: [
    { id: 'macrostrat', label: 'Macrostrat.org', baseUrl: 'https://macrostrat.org/api/v2' },
  ],
  cascade: [{ key: 'dataset', label: 'Dataset', placeholder: 'Select a dataset' }],

  async listLevel(_levelKey, _sel, _ctx) {
    return ROUTES.map((r) => ({ value: r.path, label: r.label }))
  },

  async getMetadata(sel, _ctx) {
    const route = routeFor(sel)
    return {
      fields: route.fields,
      previewColumns: route.previewColumns,
      spatial: true,
      queryable: true,
      note: route.note,
    }
  },

  opsFor(kind: FieldKind): FilterOp[] {
    // The API is equality-only: text takes one value or a comma list; numeric
    // adds between, which serializes to age_top/age_bottom (age only).
    if (kind === 'numeric') return ['eq', 'between']
    return ['is', 'isAnyOf']
  },

  async distinctValues(sel, field, ctx) {
    switch (field) {
      case 'interval_name': return defValues(ctx, 'intervals', (r) => r.name)
      case 'lith': return defValues(ctx, 'lithologies', (r) => r.name)
      case 'lith_type': return defValues(ctx, 'lithologies', (r) => r.type)
      case 'lith_class': return defValues(ctx, 'lithologies', (r) => r.class)
      case 'environ': return defValues(ctx, 'environments', (r) => r.name)
      case 'environ_type': return defValues(ctx, 'environments', (r) => r.type)
      case 'scale': return ['small', 'medium', 'large']
      default: return []
    }
  },

  validateQuery(sel, query) {
    return macrostratQueryIssue(sel, query)
  },

  async preview(sel, query, ctx) {
    const route = routeFor(sel)
    // Invalid/unfiltered queries would 500 or fetch the whole database — the
    // validateQuery banner explains; just show no rows.
    if (macrostratQueryIssue(sel, query)) return []
    const data = await getData(dataUrl(ctx, route, query, 'json'))
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
    return rows.slice(0, query.limit)
  },

  buildCode(sel, query, varName, ctx) {
    const route = routeFor(sel)
    const url = dataUrl(ctx, route, query, 'geojson_bare')
    return [
      'library(sf)',
      '',
      `# Macrostrat — ${route.label} (data CC-BY 4.0)`,
      `${varName} <- sf::st_read(${`r"(${url})"`}, quiet = TRUE)`,
    ].join('\n')
  },
}
