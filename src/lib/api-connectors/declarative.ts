// A Web-API connector written as data.
//
// Fourteen providers ship as hand-written TypeScript, and comparing them was
// the argument for this file: outside the OGC XML trio, they are the same
// program. Walk a cascade by fetching JSON and reading a path out of it; read
// field metadata the same way; serialise the shared `Query` into one of about
// five dialects; emit an R one-liner. The differences are URLs and paths.
//
// So `compileProvider(spec)` turns that description into a real `ApiProvider`,
// and a plugin can add a connector without shipping a line of JavaScript —
// which matters most for the case this exists for: a user asking the assistant
// for a connector to an API nobody has written one for.
//
// ── What this deliberately cannot express ─────────────────────────────────
//
// * **XML capabilities documents.** WFS, WMS and WCS negotiate versions and
//   parameter names by probing, and parse namespace-agnostic DOM trees. That is
//   a program, not a description, and pretending otherwise would produce specs
//   that half-work.
// * **Adaptive probing.** Esri's halving `probeCapacity`, WCS's bbox bisection.
// * **Cross-request derivation.** Reprojecting an extent, discovering raster
//   assets, estimating download size.
//
// A plugin that needs those writes a provider in code and registers it through
// `ctx.register.connector`. The documentation says which is which, so a model
// does not spend three turns trying to describe a WFS in JSON.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import type { SearchableOption } from '@/components/ui/SearchableSelect'
import {
  completeFilters, defaultOpsFor, fieldKind,
  type Field, type FieldKind, type Filter, type FilterOp, type Query,
} from './query-model'
import type {
  ApiCategory, ApiProvider, ApiServer, CascadeLevel, ProviderContext,
  ResourceMetadata, Selection,
} from './types'

// ── The spec ───────────────────────────────────────────────────────────────

export interface DeclarativeCascadeLevel extends CascadeLevel {
  /** A fixed list — for a level that is a menu of routes, not a lookup. */
  options?: { value: string; label: string; hint?: string }[]
  /** Or a URL to fetch. Templated; see `fillUrl`. */
  url?: string
  /** Path to the array of items in the response, e.g. "value" or "result.items".
   *  Omit when the response IS the array. */
  itemsPath?: string
  /**
   * Paths WITHIN one item. Named `*Path` rather than `value`/`label` because
   * the level already has a `label` — the heading above the dropdown — and one
   * field meaning two things is a spec-author trap as much as a type error.
   * Default to "id" and "name".
   */
  valuePath?: string
  labelPath?: string
  hintPath?: string
}

export interface DeclarativeMetadata {
  url?: string
  /** Literal field list — for an API whose schema is known and fixed. */
  fields?: Field[]
  /** Or the path to a field list in the response. */
  fieldsPath?: string
  /** Within each field object: where the id and the type live. */
  fieldId?: string
  fieldType?: string
  fieldLabel?: string
  /** Or: infer the fields from the first row of `rowsPath`. */
  fieldsFrom?: 'sampleRow'
  rowsPath?: string
  totalPath?: string
  spatial?: boolean
  queryable?: boolean
  note?: string
  previewColumns?: string[]
}

/** How a `Query` becomes whatever the server accepts. */
export interface FilterDialect {
  /** Joins complete filters. */
  join: string
  /** How a text literal is written; `…` is the value slot. */
  quote?: { wrap: string; escape: string }
  /** Per-operator templates. `{f}` field, `{v}` value, `{v1}`/`{v2}` for ranges. */
  ops: Partial<Record<FilterOp, string | { template: string; join: string; wrap?: string }>>
}

export interface DeclarativeProviderSpec {
  name: string
  label: string
  category: ApiCategory
  description: string
  servers: ApiServer[]
  cascade: DeclarativeCascadeLevel[]
  metadata: DeclarativeMetadata
  ops?: Partial<Record<FieldKind, FilterOp[]>>
  /** A shipped dialect name, or a table of your own. */
  filterDialect?: keyof typeof DIALECTS | FilterDialect
  preview?: { url: string; rowsPath?: string }
  distinctValues?: { url: string; path?: string }
  /** The R the Load button runs. `{var}` is the variable name. */
  import: { template: string }
  defaultVarName?: string
}

// ── Shipped dialects ───────────────────────────────────────────────────────
//
// One table each for the five serialisations the shipped providers use between
// them. A spec usually names one; the escape is a table of its own.

export const DIALECTS: Record<string, FilterDialect> = {
  /** OData v4 `$filter`. */
  odata: {
    join: ' and ',
    quote: { wrap: "'…'", escape: "''" },
    ops: {
      is: '{f} eq {v}', eq: '{f} eq {v}', on: '{f} eq {v}',
      isAnyOf: { template: '{f} eq {v}', join: ' or ', wrap: '(…)' },
      contains: 'contains({f},{v})',
      lt: '{f} lt {v}', before: '{f} lt {v}', lte: '{f} le {v}',
      gt: '{f} gt {v}', after: '{f} gt {v}', gte: '{f} ge {v}',
      between: '({f} ge {v1} and {f} le {v2})',
      dateBetween: '({f} ge {v1} and {f} le {v2})',
    },
  },
  /** OGC CQL / ECQL, as WFS and OGC API–Features take it. */
  cql: {
    join: ' AND ',
    quote: { wrap: "'…'", escape: "''" },
    ops: {
      is: "{f} = {v}", eq: '{f} = {v}', on: '{f} = {v}',
      isAnyOf: { template: '{f} = {v}', join: ' OR ', wrap: '(…)' },
      contains: "{f} LIKE '%{raw}%'",
      lt: '{f} < {v}', before: '{f} < {v}', lte: '{f} <= {v}',
      gt: '{f} > {v}', after: '{f} > {v}', gte: '{f} >= {v}',
      between: '({f} BETWEEN {v1} AND {v2})',
      dateBetween: '({f} BETWEEN {v1} AND {v2})',
    },
  },
  /** An Esri `where` clause — SQL-92, single quotes. */
  esri: {
    join: ' AND ',
    quote: { wrap: "'…'", escape: "''" },
    ops: {
      is: '{f} = {v}', eq: '{f} = {v}', on: '{f} = {v}',
      isAnyOf: { template: '{v}', join: ', ', wrap: '{f} IN (…)' },
      contains: "{f} LIKE '%{raw}%'",
      lt: '{f} < {v}', before: '{f} < {v}', lte: '{f} <= {v}',
      gt: '{f} > {v}', after: '{f} > {v}', gte: '{f} >= {v}',
      between: '({f} BETWEEN {v1} AND {v2})',
      dateBetween: '({f} BETWEEN {v1} AND {v2})',
    },
  },
  /** Socrata SoQL `$where`. */
  soql: {
    join: ' AND ',
    quote: { wrap: "'…'", escape: "''" },
    ops: {
      is: '{f} = {v}', eq: '{f} = {v}', on: '{f} = {v}',
      isAnyOf: { template: '{v}', join: ', ', wrap: '{f} IN (…)' },
      contains: 'lower({f}) like lower({v})',
      lt: '{f} < {v}', before: '{f} < {v}', lte: '{f} <= {v}',
      gt: '{f} > {v}', after: '{f} > {v}', gte: '{f} >= {v}',
      between: '({f} between {v1} and {v2})',
      dateBetween: '({f} between {v1} and {v2})',
    },
  },
  /**
   * Plain `key=value` query parameters — the shape Macrostrat and most small
   * REST APIs use. Only equality and lists mean anything; a range has no
   * general spelling, so a spec that needs one names its own dialect.
   */
  params: {
    join: '&',
    ops: {
      is: '{f}={raw}', eq: '{f}={raw}', on: '{f}={raw}',
      isAnyOf: { template: '{raw}', join: ',', wrap: '{f}=…' },
    },
  },
}

// ── Compilation ────────────────────────────────────────────────────────────

export interface CompileProviderResult {
  ok: boolean
  provider?: ApiProvider
  error?: string
}

/** Turn a spec into a provider, or say precisely what is wrong with it. */
export function compileProvider(
  spec: DeclarativeProviderSpec, idPrefix = '',
): CompileProviderResult {
  const fail = (error: string): CompileProviderResult => ({ ok: false, error })

  if (!spec || typeof spec !== 'object') return fail('A connector spec must be an object.')
  if (!spec.name) return fail('"name" is required — it becomes the provider id.')
  if (!spec.label) return fail('"label" is required — it is what the user picks in the Data Connector.')
  if (!Array.isArray(spec.servers) || spec.servers.length === 0) {
    return fail('"servers" needs at least one { id, label, baseUrl }.')
  }
  if (!Array.isArray(spec.cascade) || spec.cascade.length === 0) {
    return fail('"cascade" needs at least one level — the last one selects the resource.')
  }
  for (const [i, level] of spec.cascade.entries()) {
    if (!level.key || !level.label) return fail(`cascade[${i}] needs "key" and "label".`)
    if (!level.options && !level.url) {
      return fail(`cascade[${i}] ("${level.key}") needs either "options" (a fixed list) or "url" (one to fetch).`)
    }
  }
  if (!spec.import?.template) {
    return fail('"import.template" is required — it is the R the Load button runs.')
  }
  if (!spec.import.template.includes('{var}')) {
    return fail('"import.template" must contain {var}, or the import assigns to nothing.')
  }

  const dialect = resolveDialect(spec.filterDialect)
  if (typeof dialect === 'string') return fail(dialect)

  const id = idPrefix ? `${idPrefix}-${spec.name}` : spec.name
  const leafKey = spec.cascade[spec.cascade.length - 1].key

  const provider: ApiProvider = {
    id,
    label: spec.label,
    category: spec.category,
    description: spec.description ?? '',
    builtinServers: spec.servers,
    cascade: spec.cascade.map(({ key, label, placeholder }) => ({ key, label, placeholder })),

    async listLevel(levelKey, sel, ctx) {
      const level = spec.cascade.find((l) => l.key === levelKey)
      if (!level) return []
      if (level.options) return level.options
      const data = await getJson(fillUrl(level.url!, { spec, sel, ctx }))
      const items = asArray(pick(data, level.itemsPath))
      return items.map((item): SearchableOption => ({
        value: String(pick(item, level.valuePath ?? 'id') ?? ''),
        label: String(pick(item, level.labelPath ?? 'name') ?? pick(item, level.valuePath ?? 'id') ?? ''),
        hint: level.hintPath ? strOrUndef(pick(item, level.hintPath)) : undefined,
      })).filter((o) => o.value !== '')
    },

    async getMetadata(sel, ctx): Promise<ResourceMetadata> {
      const m = spec.metadata
      const base: ResourceMetadata = {
        fields: [],
        spatial: m.spatial ?? false,
        queryable: m.queryable ?? true,
        note: m.note,
        previewColumns: m.previewColumns,
      }
      if (m.fields) return { ...base, fields: m.fields }
      if (!m.url) return base

      const data = await getJson(fillUrl(m.url, { spec, sel, ctx }))
      const total = m.totalPath ? Number(pick(data, m.totalPath)) : undefined

      if (m.fieldsFrom === 'sampleRow') {
        const row = asArray(pick(data, m.rowsPath))[0]
        return { ...base, total, fields: inferFields(row) }
      }
      const raw = asArray(pick(data, m.fieldsPath))
      return {
        ...base,
        total: Number.isFinite(total) ? total : undefined,
        fields: raw.map((f): Field => ({
          id: String(pick(f, m.fieldId ?? 'id') ?? ''),
          type: String(pick(f, m.fieldType ?? 'type') ?? 'text'),
          label: m.fieldLabel ? strOrUndef(pick(f, m.fieldLabel)) : undefined,
        })).filter((f) => f.id !== ''),
      }
    },

    opsFor(kind) {
      const wanted = spec.ops?.[kind]
      if (!wanted || wanted.length === 0) {
        // Only the operators the dialect can actually write. Offering one it
        // has no template for produces a filter the server silently ignores,
        // which reads to the user as ouRGeo losing their query.
        return defaultOpsFor(kind).filter((op) => dialect.ops[op] !== undefined)
      }
      return wanted.filter((op) => dialect.ops[op] !== undefined)
    },

    async preview(sel, query, ctx) {
      if (!spec.preview) return []
      const data = await getJson(fillUrl(spec.preview.url, { spec, sel, ctx, query, dialect }))
      return asArray(pick(data, spec.preview.rowsPath)).map((r) => asRecord(r))
    },

    buildCode(sel, query, varName, ctx) {
      return fillTemplate(spec.import.template, { spec, sel, ctx, query, dialect, varName })
    },

    defaultVarName: spec.defaultVarName
      ? () => spec.defaultVarName!
      : (sel: Selection) => toVarName(sel[leafKey] ?? spec.name),
  }

  if (spec.distinctValues) {
    provider.distinctValues = async (sel, field, ctx) => {
      const data = await getJson(fillUrl(spec.distinctValues!.url, { spec, sel, ctx, field }))
      const items = asArray(pick(data, spec.distinctValues!.path))
      const values = items.map((v) => (
        v !== null && typeof v === 'object' ? String(pick(v, field) ?? '') : String(v)
      )).filter(Boolean)
      return [...new Set(values)].sort()
    }
  }

  return { ok: true, provider }
}

function resolveDialect(d: DeclarativeProviderSpec['filterDialect']): FilterDialect | string {
  if (!d) return DIALECTS.params
  if (typeof d === 'string') {
    const hit = DIALECTS[d]
    return hit ?? `No filter dialect called "${d}". Built in: ${Object.keys(DIALECTS).join(', ')} — or supply a table of your own.`
  }
  if (!d.ops || typeof d.ops !== 'object') return '"filterDialect" needs an "ops" table.'
  return { join: d.join ?? ' AND ', quote: d.quote, ops: d.ops }
}

// ── Filter serialisation ───────────────────────────────────────────────────

/** Serialise a query into one dialect. Exported so a spec can be tested
 *  against a known-good string without standing up a provider. */
export function serializeFilters(query: Query, dialect: FilterDialect): string {
  const parts: string[] = []
  for (const f of completeFilters(query)) {
    const rule = dialect.ops[f.op]
    if (!rule) continue          // opsFor already excluded it; belt and braces
    parts.push(typeof rule === 'string' ? one(rule, f, dialect) : many(rule, f, dialect))
  }
  return parts.join(dialect.join)
}

function one(template: string, f: Filter, d: FilterDialect): string {
  return template
    .replace(/\{f\}/g, f.field)
    .replace(/\{v1\}/g, literal(f.value, f.kind, d))
    .replace(/\{v2\}/g, literal(f.value2 ?? '', f.kind, d))
    .replace(/\{v\}/g, literal(f.value, f.kind, d))
    .replace(/\{raw\}/g, f.value)
}

function many(
  rule: { template: string; join: string; wrap?: string }, f: Filter, d: FilterDialect,
): string {
  const body = (f.values ?? []).map((v) => one(rule.template, { ...f, value: v }, d)).join(rule.join)
  if (!rule.wrap) return body
  return rule.wrap.replace('…', body).replace(/\{f\}/g, f.field)
}

/**
 * A value as the dialect writes it.
 *
 * Numbers and timestamps go in bare; text is quoted and escaped. This is the
 * one place a value the user typed could become part of the server's query
 * language, so the escape is not cosmetic.
 */
function literal(value: string, kind: FieldKind, d: FilterDialect): string {
  if (kind === 'numeric') {
    const n = Number(value)
    return Number.isFinite(n) && value.trim() !== '' ? String(n) : quote(value, d)
  }
  if (kind === 'timestamp') return value.trim()
  return quote(value, d)
}

function quote(value: string, d: FilterDialect): string {
  if (!d.quote) return value
  const [open, close] = d.quote.wrap.split('…')
  const escaped = value.split(open).join(d.quote.escape)
  return `${open}${escaped}${close}`
}

// ── Templating ─────────────────────────────────────────────────────────────

interface FillContext {
  spec: DeclarativeProviderSpec
  sel: Selection
  ctx: ProviderContext
  query?: Query
  dialect?: FilterDialect
  varName?: string
  field?: string
}

/**
 * Fill a template.
 *
 * `{x}` is URL-encoded, `{{x}}` is raw. A cascade id in a path and a filter
 * clause in a query string need opposite treatment, and picking the wrong one
 * silently is how a connector "works" for simple values and breaks the first
 * time someone's dataset has a space in its name.
 */
export function fillTemplate(template: string, c: FillContext): string {
  const value = (key: string): string => {
    if (key === 'baseUrl') return c.ctx.baseUrl
    if (key === 'var') return c.varName ?? 'data'
    if (key === 'field') return c.field ?? ''
    if (key === 'limit') return String(c.query?.limit ?? 1000)
    if (key === 'q') return c.query?.q?.trim() ?? ''
    if (key === 'filter') {
      return c.query && c.dialect ? serializeFilters(c.query, c.dialect) : ''
    }
    if (key.startsWith('sel.')) return c.sel[key.slice(4)] ?? ''
    if (key.startsWith('apiKey.')) return c.ctx.apiKeys[key.slice(7)] ?? ''
    return ''
  }
  return template
    .replace(/\{\{([\w.]+)\}\}/g, (_m, k: string) => value(k))
    .replace(/\{([\w.]+)\}/g, (_m, k: string) => encodeURIComponent(value(k)))
}

/**
 * Fill a URL, then drop any query parameter whose value came out empty.
 *
 * An unfilled `&$filter=` is not the same request as one with no filter — some
 * servers 400 on it, and the ones that do not return everything, which looks
 * like the filter being ignored. Emptiness is the normal case here: most of a
 * connector's parameters are optional.
 */
export function fillUrl(template: string, c: FillContext): string {
  const filled = fillTemplate(template, c)
  const [head, ...rest] = filled.split('?')
  if (rest.length === 0) return head
  const kept = rest.join('?').split('&').filter((pair) => {
    const eq = pair.indexOf('=')
    return eq === -1 ? pair !== '' : pair.slice(eq + 1) !== ''
  })
  return kept.length > 0 ? `${head}?${kept.join('&')}` : head
}

// ── Fetching and reading ───────────────────────────────────────────────────

async function getJson(url: string): Promise<unknown> {
  const res = await proxyFetch(url, { headers: { Accept: 'application/json' } })
  const text = await res.text()
  if (!res.ok) {
    // The body is often the only thing that says WHY, and a bare status code
    // sends the user to the wrong problem.
    throw new Error(`HTTP ${res.status} from ${url}${text ? `: ${text.slice(0, 300)}` : ''}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} did not return JSON. First 200 characters: ${text.slice(0, 200)}`)
  }
}

/** `a.b[0].c` out of a parsed response. An empty path returns the value. */
export function pick(value: unknown, path?: string): unknown {
  if (!path) return value
  let cur = value
  for (const part of path.split('.')) {
    const m = /^(\w*)((?:\[\d+\])*)$/.exec(part)
    if (!m) return undefined
    if (m[1]) cur = (cur as Record<string, unknown>)?.[m[1]]
    for (const idx of m[2].match(/\d+/g) ?? []) cur = (cur as unknown[])?.[Number(idx)]
    if (cur === undefined || cur === null) return cur
  }
  return cur
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : { value: v }
}

function strOrUndef(v: unknown): string | undefined {
  return v === null || v === undefined || v === '' ? undefined : String(v)
}

/** Fields from a sample row, typed by what the values look like. */
function inferFields(row: unknown): Field[] {
  if (row === null || typeof row !== 'object') return []
  return Object.entries(row as Record<string, unknown>).map(([id, v]) => ({
    id,
    type: typeof v === 'number' ? 'number'
      : typeof v === 'boolean' ? 'boolean'
      : looksLikeDate(v) ? 'timestamp'
      : 'text',
  }))
}

function looksLikeDate(v: unknown): boolean {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(v)
}

function toVarName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  return /^[a-z]/.test(cleaned) ? cleaned : `d_${cleaned || 'data'}`
}

/** The kinds a field type maps to, re-exported so a spec author can see the
 *  vocabulary without reading query-model.ts. */
export { fieldKind }
