// ── Selection Tool Definitions ────────────────────────────────────────────────
// These tools produce row selections rather than new R objects.
// Each buildCode() returns a pure R expression (no assignment) that evaluates
// to a subset of the source dataset. The /selection/query endpoint evaluates
// this expression and extracts the 0-based row indices from the rownames.

import type { ToolDef, FilterCondition, Values } from './tools'
import { maybeLinearize, withLinearize } from './tools'

// ── Helpers (mirrors tools.ts internal helpers) ───────────────────────────────

function q(col: string): string {
  return /^[a-zA-Z_.][a-zA-Z0-9_.]*$/.test(col) ? col : `\`${col}\``
}

function cols(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

function colList(v: string): string {
  const cs = cols(v)
  if (cs.length === 0) return '""'
  if (cs.length === 1) return `"${cs[0]}"`
  return `c(${cs.map(c => `"${c}"`).join(', ')})`
}

function rVal(val: string): string {
  const t = val.trim()
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return t
  if (['TRUE', 'FALSE', 'NA', 'NULL', 'NaN', 'Inf', '-Inf'].includes(t)) return t
  return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function rStr(val: string): string {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildFilterExpr(c: FilterCondition): string {
  const col = q(c.col)
  switch (c.op) {
    case 'is.na':       return `is.na(${col})`
    case '!is.na':      return `!is.na(${col})`
    case 'is.null':     return `is.null(${col})`
    case '!is.null':    return `!is.null(${col})`
    case 'is.nan':      return `is.nan(${col})`
    case 'is.finite':   return `is.finite(${col})`
    case 'is.infinite': return `is.infinite(${col})`
    case 'grepl':       return `grepl(${rStr(c.rhsVal)}, ${col}, ignore.case = FALSE)`
    case 'grepl_i':     return `grepl(${rStr(c.rhsVal)}, ${col}, ignore.case = TRUE)`
    case 'startsWith':  return `startsWith(${col}, ${rStr(c.rhsVal)})`
    case 'endsWith':    return `endsWith(${col}, ${rStr(c.rhsVal)})`
    case 'nchar_gt':    return `nchar(${col}) > ${c.rhsVal || '0'}`
    case '%in%': {
      const items = c.rhsVal.split(',').map(s => s.trim()).filter(Boolean)
      return `${col} %in% c(${items.map(rVal).join(', ')})`
    }
    default: {
      const rhs = c.rhsType === 'column' ? q(c.rhsCol) : rVal(c.rhsVal)
      return `${col} ${c.op} ${rhs}`
    }
  }
}

// ── Category 1: Attribute Selection ──────────────────────────────────────────

const attributeTools: ToolDef[] = [
  {
    id: 'sel-filter',
    label: 'Filter Rows',
    description: 'Keep rows that match one or more attribute conditions.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'conds', label: 'Conditions', type: 'filter-conditions', datasetField: 'ds' },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      let conditions: FilterCondition[] = []
      try { conditions = JSON.parse(v.conds || '[]') } catch { /* ignore */ }
      const valid = conditions.filter(c => c.col && c.op)
      if (valid.length === 0) return `dplyr::filter(${ds}, TRUE)`
      const exprs = valid.map(buildFilterExpr)
      const allAnd = valid.every((c, i) => i === 0 || c.joinOp === 'AND')
      if (allAnd) {
        return exprs.length === 1
          ? `dplyr::filter(${ds}, ${exprs[0]})`
          : `dplyr::filter(${ds},\n  ${exprs.join(',\n  ')})`
      }
      let expr = `(${exprs[0]})`
      for (let i = 1; i < valid.length; i++) {
        expr += valid[i].joinOp === 'AND' ? ` &\n  (${exprs[i]})` : ` |\n  (${exprs[i]})`
      }
      return `dplyr::filter(${ds}, ${expr})`
    },
  },
  {
    id: 'sel-semi-join',
    label: 'Semi-join',
    description: 'Keep rows in this dataset that have a matching row in another dataset.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'right', label: 'Match Against', type: 'dataset', filter: 'any' },
      { id: 'by', label: 'Match Columns', type: 'column', datasetField: 'ds', multi: true },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      const right = v.right || 'data2'
      const byCols = cols(v.by || '')
      const byArg = byCols.length > 0 ? `, by = ${colList(v.by)}` : ''
      return `dplyr::semi_join(${ds}, ${right}${byArg})`
    },
  },
  {
    id: 'sel-anti-join',
    label: 'Anti-join',
    description: 'Keep rows in this dataset that have NO matching row in another dataset.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'right', label: 'Exclude Matches From', type: 'dataset', filter: 'any' },
      { id: 'by', label: 'Match Columns', type: 'column', datasetField: 'ds', multi: true },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      const right = v.right || 'data2'
      const byCols = cols(v.by || '')
      const byArg = byCols.length > 0 ? `, by = ${colList(v.by)}` : ''
      return `dplyr::anti_join(${ds}, ${right}${byArg})`
    },
  },
  {
    id: 'sel-distinct',
    label: 'Remove Duplicates',
    description: 'Keep one row per unique combination of the specified columns.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'cols', label: 'Key Columns (blank = all)', type: 'column', datasetField: 'ds', multi: true },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      const keyCols = cols(v.cols || '')
      return keyCols.length > 0
        ? `dplyr::distinct(${ds}, ${keyCols.map(q).join(', ')}, .keep_all = TRUE)`
        : `dplyr::distinct(${ds})`
    },
  },
  {
    id: 'sel-slice',
    label: 'Slice Rows',
    description: 'Select rows by explicit row numbers (e.g. 1:10 or c(2,5,8)).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'rows', label: 'Row Numbers', type: 'text', placeholder: '1:10  or  c(2, 5, 8)', default: '1:10' },
    ],
    buildCode: (v: Values) =>
      `dplyr::slice(${v.ds || 'data'}, ${v.rows || '1:10'})`,
  },
  {
    id: 'sel-slice-max',
    label: 'Top N by Column',
    description: 'Select the N rows with the highest value in a column.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Order Column', type: 'column', datasetField: 'ds' },
      { id: 'n', label: 'N rows', type: 'number', min: 1, step: 1, default: '10' },
      { id: 'order', label: 'Order', type: 'select', options: [{ value: 'max', label: 'Top N (highest)' }, { value: 'min', label: 'Bottom N (lowest)' }] },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      const col = q(v.col || 'col')
      const n = v.n || '10'
      return v.order === 'min'
        ? `dplyr::slice_min(${ds}, ${col}, n = ${n}, with_ties = FALSE)`
        : `dplyr::slice_max(${ds}, ${col}, n = ${n}, with_ties = FALSE)`
    },
  },
  {
    id: 'sel-sample',
    label: 'Random Sample',
    description: 'Select a random sample of N rows.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'n', label: 'N rows', type: 'number', min: 1, step: 1, default: '100' },
      { id: 'replace', label: 'Sample with replacement', type: 'checkbox', default: false },
    ],
    buildCode: (v: Values) => {
      const ds = v.ds || 'data'
      const n = v.n || '100'
      const rep = v.replace === 'true' ? ', replace = TRUE' : ''
      return `dplyr::slice_sample(${ds}, n = ${n}${rep})`
    },
  },
]

// ── Category 2: Spatial Selection ─────────────────────────────────────────────

const spatialTools: ToolDef[] = [
  {
    id: 'sel-st-intersects',
    label: 'Intersects',
    description: 'Keep features that spatially intersect the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_intersects)`,
  },
  {
    id: 'sel-st-within',
    label: 'Within',
    description: 'Keep features that fall completely within the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_within)`,
  },
  {
    id: 'sel-st-contains',
    label: 'Contains',
    description: 'Keep features that completely contain the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_contains)`,
  },
  {
    id: 'sel-st-covers',
    label: 'Covers',
    description: 'Keep features that cover (no part of filter geometry is outside).',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_covers)`,
  },
  {
    id: 'sel-st-covered-by',
    label: 'Covered By',
    description: 'Keep features that are fully covered by the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_covered_by)`,
  },
  {
    id: 'sel-st-touches',
    label: 'Touches',
    description: 'Keep features that share a boundary point but do not overlap.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_touches)`,
  },
  {
    id: 'sel-st-crosses',
    label: 'Crosses',
    description: 'Keep features whose geometry crosses (partly shares interior of) the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_crosses)`,
  },
  {
    id: 'sel-st-disjoint',
    label: 'Disjoint',
    description: 'Keep features that have no spatial relationship with the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
    ],
    buildCode: (v: Values) =>
      `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_disjoint)`,
  },
  {
    id: 'sel-st-distance',
    label: 'Within Distance',
    description: 'Keep features within a specified distance of the filter geometry.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'filter', label: 'Filter Geometry (sf)', type: 'dataset', filter: 'sf' },
      { id: 'dist', label: 'Distance (CRS units)', type: 'number', min: 0, step: 1, default: '1000' },
    ],
    buildCode: (v: Values) => {
      const dist = v.dist || '1000'
      return `sf::st_filter(${maybeLinearize(v.ds || 'data', v)}, ${maybeLinearize(v.filter || 'filter_geom', v)}, .predicate = sf::st_is_within_distance, dist = ${dist})`
    },
  },
  {
    id: 'sel-nearest',
    label: 'Nearest N Features',
    description: 'Select the N closest features to a target geometry dataset.',
    fields: [
      { id: 'ds', label: 'Source (sf)', type: 'dataset', filter: 'sf' },
      { id: 'target', label: 'Target Geometry (sf)', type: 'dataset', filter: 'sf' },
      { id: 'n', label: 'N features', type: 'number', min: 1, step: 1, default: '10' },
    ],
    buildCode: (v: Values) => {
      const ds = maybeLinearize(v.ds || 'data', v)
      const target = maybeLinearize(v.target || 'target_geom', v)
      const n = v.n || '10'
      return `dplyr::slice_min(${ds}, as.numeric(sf::st_distance(${ds}, sf::st_union(${target}))), n = ${n}, with_ties = FALSE)`
    },
  },
]

// ── Exported categories ────────────────────────────────────────────────────────

export interface SelectionCategory {
  id: string
  label: string
  tools: ToolDef[]
}

export const SELECTION_CATEGORIES: SelectionCategory[] = [
  { id: 'attribute', label: 'Attribute', tools: attributeTools },
  // Spatial predicates are GEOS-only (not curve-aware) — the linearize
  // checkbox is how curved inputs stay filterable.
  { id: 'spatial', label: 'Spatial (sf)', tools: spatialTools.map(withLinearize) },
]

export const ALL_SELECTION_TOOLS = SELECTION_CATEGORIES.flatMap(c =>
  c.tools.map(t => ({ ...t, categoryLabel: c.label, categoryId: c.id }))
)
