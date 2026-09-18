// Socrata (SODA) provider — open-data portals with a SoQL query API. The "server"
// is a Socrata domain (e.g. data.cityofnewyork.us); datasets are discovered via the
// shared catalog, queried with $where/$select/$limit.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { completeFilters, defaultOpsFor, type Field, type Filter, type Query } from './query-model'
import type { ApiProvider, ProviderContext } from './types'

const domainOf = (baseUrl: string) => baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
const appToken = (ctx: ProviderContext) => ctx.apiKeys.socrata?.trim() ?? ''

async function getJson(url: string, token: string): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (token) headers['X-App-Token'] = token
  const res = await proxyFetch(url, { headers })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from Socrata`)
  return JSON.parse(text)
}

// ── SoQL serialization (shared by preview + codegen) ────────────────────────
const sNum = (v: string) => { const n = Number(v); return Number.isFinite(n) && v.trim() !== '' ? String(n) : sText(v) }
const sText = (v: string) => `'${v.replace(/'/g, "''")}'`
const litOf = (f: Filter, v = f.value) => (f.kind === 'numeric' ? sNum(v) : sText(v))

export function buildSoqlWhere(query: Query): string {
  const cl: string[] = []
  for (const f of completeFilters(query)) {
    const c = f.field
    switch (f.op) {
      case 'is': case 'eq': case 'on': cl.push(`${c} = ${litOf(f)}`); break
      case 'isAnyOf': cl.push(`${c} IN (${(f.values ?? []).map((v) => litOf(f, v)).join(', ')})`); break
      case 'contains': cl.push(`upper(${c}) like upper(${sText(`%${f.value}%`)})`); break
      case 'lt': case 'before': cl.push(`${c} < ${litOf(f)}`); break
      case 'lte': cl.push(`${c} <= ${litOf(f)}`); break
      case 'gt': case 'after': cl.push(`${c} > ${litOf(f)}`); break
      case 'gte': cl.push(`${c} >= ${litOf(f)}`); break
      case 'between': case 'dateBetween': cl.push(`${c} between ${litOf(f, f.value)} and ${litOf(f, f.value2 ?? '')}`); break
    }
  }
  return cl.join(' AND ')
}

export const socrataProvider: ApiProvider = {
  id: 'socrata',
  label: 'Socrata',
  category: 'Open Data',
  description: 'Socrata (SODA) open-data portals. Pick a domain, then a dataset; query with SoQL.',
  docsUrl: 'https://dev.socrata.com/docs/endpoints.html',
  builtinServers: [
    { id: 'nyc', label: 'NYC Open Data', baseUrl: 'https://data.cityofnewyork.us', docsUrl: 'https://opendata.cityofnewyork.us/' },
    { id: 'chicago', label: 'Chicago Data Portal', baseUrl: 'https://data.cityofchicago.org', docsUrl: 'https://data.cityofchicago.org/' },
    { id: 'wa', label: 'Washington State', baseUrl: 'https://data.wa.gov', docsUrl: 'https://data.wa.gov/' },
    { id: 'cdc', label: 'CDC Data', baseUrl: 'https://data.cdc.gov', docsUrl: 'https://data.cdc.gov/' },
  ],
  cascade: [{ key: 'dataset', label: 'Dataset', placeholder: 'Select a dataset' }],

  async listLevel(_levelKey, _sel, ctx) {
    const domain = domainOf(ctx.baseUrl)
    const data = await getJson(
      `https://api.us.socrata.com/api/catalog/v1?domains=${domain}&only=datasets&limit=250`,
      appToken(ctx),
    ) as { results?: { resource?: { id: string; name: string; description?: string } }[] }
    return (data.results ?? [])
      .map((r) => r.resource)
      .filter((r): r is { id: string; name: string } => !!r?.id)
      .map((r) => ({ value: r.id, label: r.name }))
  },

  async getMetadata(sel, ctx) {
    const token = appToken(ctx)
    const view = await getJson(`${ctx.baseUrl}/api/views/${sel.dataset}.json`, token) as {
      columns?: { fieldName: string; dataTypeName: string; name?: string }[]
    }
    const fields: Field[] = (view.columns ?? [])
      .filter((c) => c.fieldName && !c.fieldName.startsWith(':'))
      .map((c) => ({ id: c.fieldName, type: c.dataTypeName, label: c.name }))
    let total: number | undefined
    try {
      const cnt = await getJson(`${ctx.baseUrl}/resource/${sel.dataset}.json?$select=count(*)`, token) as Record<string, string>[]
      const n = Number(cnt[0]?.count ?? cnt[0]?.['count_1'])
      if (Number.isFinite(n)) total = n
    } catch { /* total is best-effort */ }
    return { fields, total, spatial: false, queryable: true }
  },

  opsFor: (kind) => defaultOpsFor(kind),

  async distinctValues(sel, field, ctx) {
    const rows = await getJson(
      `${ctx.baseUrl}/resource/${sel.dataset}.json?$select=${encodeURIComponent(field)}&$group=${encodeURIComponent(field)}&$order=${encodeURIComponent(field)}&$limit=1000`,
      appToken(ctx),
    ) as Record<string, unknown>[]
    return rows.map((r) => r[field]).filter((v) => v != null).map(String)
  },

  async preview(sel, query, ctx) {
    const where = buildSoqlWhere(query)
    const params = new URLSearchParams()
    params.set('$limit', String(query.limit))
    if (where) params.set('$where', where)
    if (query.q.trim()) params.set('$q', query.q.trim())
    const rows = await getJson(`${ctx.baseUrl}/resource/${sel.dataset}.json?${params}`, appToken(ctx)) as Record<string, unknown>[]
    return rows
  },

  buildCode(sel, query, varName, ctx) {
    const where = buildSoqlWhere(query)
    const q = query.q.trim()
    const token = appToken(ctx)
    const rRaw = (s: string) => `r"(${s})"`
    const args = [
      '      `$limit` = min(.page, .max - .offset)',
      '      `$offset` = .offset',
      where ? '      `$where` = .where' : null,
      q ? '      `$q` = .q' : null,
      '      `$order` = ":id"',
    ].filter(Boolean).join(',\n')
    return [
      'library(httr2)',
      '',
      `# Socrata (SoQL) — ${domainOf(ctx.baseUrl)}`,
      `.base <- "${ctx.baseUrl}/resource/${sel.dataset}.json"`,
      where ? `.where <- ${rRaw(where)}` : null,
      q ? `.q <- ${rRaw(q)}` : null,
      '.page <- 50000L',
      `.max <- ${query.limit}L`,
      '.pages <- list(); .offset <- 0L',
      'repeat {',
      '  .req <- request(.base) |>',
      token ? `    req_headers(\`X-App-Token\` = "${token}") |>` : null,
      '    req_url_query(',
      args,
      '    )',
      '  .recs <- .req |> req_perform() |> resp_body_json(simplifyVector = TRUE)',
      '  if (is.null(.recs) || NROW(.recs) == 0) break',
      '  .pages[[length(.pages) + 1L]] <- as.data.frame(.recs, stringsAsFactors = FALSE)',
      '  .offset <- .offset + NROW(.recs)',
      '  if (.offset >= .max) break',
      '}',
      `${varName} <- if (length(.pages)) do.call(rbind, .pages) else data.frame()`,
    ].filter((l) => l !== null).join('\n')
  },
}
