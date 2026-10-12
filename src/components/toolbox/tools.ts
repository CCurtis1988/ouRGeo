// ── Tool definitions ──────────────────────────────────────────────────────
// Each tool is a pure data object. ToolboxDialog renders any tool generically.

import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { CALC_CRS_CHOICES } from '@/lib/calc-crs'
import { rasterOps } from './tools-raster'

export type Values = Record<string, string>

/**
 * Metadata for `dataset` fields, keyed by field id (not variable name).
 * Populated by ToolboxDialog from the live R environment so that buildCode
 * can decide whether to wrap a database tbl in `(x %>% collect())` before
 * passing it to a non-dplyr function (e.g. sf::*, geos::*, bind_cols).
 *
 * For proxy-backed datasets (Rgeo connect), `rgeoProxy` carries the
 * (handle, name) pair so the dialog can pre-collect via /dataset/collect
 * before running the tool. `materializedAs` is set to the local-env var
 * the pre-collect produced; dsRef substitutes that name in the emitted
 * code so the tool sees a real sf/data.frame.
 */
export type DatasetMeta = Record<
  string,
  {
    isDbTbl: boolean
    cls: string
    rgeoProxy?: { handle: string; name: string } | null
    materializedAs?: string
  } | undefined
>

export interface FilterCondition {
  col: string
  op: string
  rhsType: 'value' | 'column' | 'none' | 'set'
  rhsCol: string
  rhsVal: string
  joinOp: 'AND' | 'OR'
}

export interface ArrangeColumn {
  col: string
  dir: 'asc' | 'desc'
}

export type FieldDef = (
  | { id: string; label: string; type: 'dataset'; filter?: 'sf' | 'geos' | 'raster' | 'any'; optional?: boolean }
  | { id: string; label: string; type: 'column'; datasetField: string; multi?: boolean }
  | { id: string; label: string; type: 'band'; datasetField: string; multi?: boolean }
  | { id: string; label: string; type: 'text'; placeholder?: string; default?: string }
  | { id: string; label: string; type: 'number'; min?: number; step?: number; default?: string }
  | { id: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { id: string; label: string; type: 'output-name'; derive?: (v: Values) => string }
  | { id: string; label: string; type: 'checkbox'; default?: boolean }
  | { id: string; label: string; type: 'filter-conditions'; datasetField: string }
  | { id: string; label: string; type: 'arrange-columns'; datasetField: string }
) & {
  /** Hide the field unless this predicate holds on the current values. */
  visibleWhen?: (v: Values) => boolean
}

export interface ToolDef {
  id: string
  label: string
  description: string
  fields: FieldDef[]
  buildCode: (v: Values, meta?: DatasetMeta) => string
  /**
   * What the tool produces. 'raster' results skip the data-viewer tab
   * (SpatRasters are not tabular); default/undefined behaves like 'table'.
   */
  output?: 'raster' | 'spatial' | 'table'
}

export interface Category {
  id: string
  label: string
  tools: ToolDef[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Wrap a column name in backticks if it contains special characters */
function q(col: string): string {
  return /^[a-zA-Z_.][a-zA-Z0-9_.]*$/.test(col) ? col : `\`${col}\``
}

/** Split a comma-separated multi-column value */
function cols(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

/** Format a list of columns as c("a", "b") or just "a" */
function colList(v: string): string {
  const cs = cols(v)
  if (cs.length === 0) return '""'
  if (cs.length === 1) return `"${cs[0]}"`
  return `c(${cs.map(c => `"${c}"`).join(', ')})`
}

/** Format a list of columns as dplyr select cols: a, b */
function selectCols(v: string): string {
  return cols(v).map(q).join(', ')
}

/** Quote a value for R: bare for numbers/booleans/specials, double-quoted otherwise */
function rVal(val: string): string {
  const t = val.trim()
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return t
  if (['TRUE', 'FALSE', 'NA', 'NULL', 'NaN', 'Inf', '-Inf'].includes(t)) return t
  return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Always produce a double-quoted R string */
function rStr(val: string): string {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Reference a dataset variable inside generated R code.
 *
 * `mode = 'lazy'` returns the bare variable name (works for dplyr verbs that
 * dbplyr lifts to SQL).
 * `mode = 'materialized'` wraps tbl_dbi inputs in `(x %>% dplyr::collect())`
 * so non-dplyr functions (sf::*, geos::*, bind_cols, …) receive a real
 * data.frame / sf object. Non-tbl_dbi inputs are returned unchanged.
 */
export function dsRef(
  v: Values,
  meta: DatasetMeta | undefined,
  key: string,
  mode: 'lazy' | 'materialized',
  fallback = 'data',
): string {
  const name = v[key] || fallback
  if (mode === 'lazy') return name
  const m = meta?.[key]
  if (!m) return name
  // Proxy collected up-front via /dataset/collect: emit the local var name
  // so the tool sees a real sf/data.frame with proper geometry.
  if (m.rgeoProxy && m.materializedAs) return m.materializedAs
  if (!m.isDbTbl) return name
  return `(${name} %>% dplyr::collect())`
}

// ── Curved-geometry support (sfarc) ────────────────────────────────────────
//
// With the sfarc package loaded (session init), sf's own generics
// (st_area/st_buffer/st_intersection/…) become exact on OGC curve types.
// Every spatial tool also offers a "linearize" checkbox that densifies
// curved input via the session helper `ourgeo_linearize()` (a guarded
// wrapper around sfarc::st_linearize — a no-op when sfarc is missing),
// which is the escape hatch for GEOS-only operations (simplify, cast,
// predicates, geos_*) that cannot process curves.

/** Shared "Linearize curved geometry" checkbox appended to spatial tools. */
export const LINEARIZE_FIELD: FieldDef = {
  id: 'linearize',
  label: 'Linearize curved geometry before calculation',
  type: 'checkbox',
  default: false,
}

/** Wrap an expression in ourgeo_linearize() when the checkbox is ticked. */
export function maybeLinearize(expr: string, v: Values): string {
  return v.linearize === 'true' ? `ourgeo_linearize(${expr})` : expr
}

/** Linearize-aware dsRef: spatial tools route their dataset refs through this. */
function dsRefL(
  v: Values,
  meta: DatasetMeta | undefined,
  key: string,
  mode: 'lazy' | 'materialized',
  fallback = 'data',
): string {
  return maybeLinearize(dsRef(v, meta, key, mode, fallback), v)
}

/** Insert the linearize checkbox before the tool's output-name field. */
export function withLinearize(tool: ToolDef): ToolDef {
  const idx = tool.fields.findIndex((f) => f.type === 'output-name')
  const fields =
    idx >= 0
      ? [...tool.fields.slice(0, idx), LINEARIZE_FIELD, ...tool.fields.slice(idx)]
      : [...tool.fields, LINEARIZE_FIELD]
  return { ...tool, fields }
}

/**
 * Calculation CRS for tools that need planar math (buffer, overlays,
 * centroid, simplify). sfarc's exact curved engine is planar — on geographic
 * (lat/lon) data it falls back to a linearized approximation, so the
 * generated code transforms into a projected CRS, computes, and transforms
 * the result back to the layer's CRS.
 *
 * Resolution order: the per-tool override, else the Settings default
 * ('auto' by default). 'auto' resolves in R at run time via
 * `ourgeo_calc_crs()` — UTM zone from the dataset centroid for geographic
 * input, identity for already-projected input.
 */
export const CALC_CRS_FIELD: FieldDef = {
  id: 'calccrs',
  label: 'Calculation CRS',
  type: 'select',
  options: [
    { value: '', label: 'Default (from Settings)' },
    { value: 'native', label: 'Layer CRS (no transform)' },
    ...CALC_CRS_CHOICES,
    { value: 'custom', label: 'Custom EPSG…' },
  ],
}

export const CALC_CRS_CUSTOM_FIELD: FieldDef = {
  id: 'calccrs_custom',
  label: 'Custom calculation CRS (EPSG code or CRS string)',
  type: 'text',
  placeholder: 'e.g. 32610',
  visibleWhen: (v) => v.calccrs === 'custom',
}

type CalcCrsMode = { kind: 'none' } | { kind: 'auto' } | { kind: 'epsg'; expr: string }

function resolveCalcCrs(v: Values): CalcCrsMode {
  let choice = (v.calccrs || '').trim()
  if (choice === 'custom') choice = (v.calccrs_custom || '').trim() || 'auto'
  if (choice === '') choice = useSpatialSettingsStore.getState().calcCrs || 'auto'
  if (choice === 'native') return { kind: 'none' }
  if (choice === 'auto') return { kind: 'auto' }
  return { kind: 'epsg', expr: isNaN(Number(choice)) ? `"${choice}"` : choice }
}

/** transform → op → transform-back wrapper for one dataset ref. */
export function withCalcCrs(
  v: Values,
  src: string,
  op: (ref: string) => string
): string {
  const mode = resolveCalcCrs(v)
  if (mode.kind === 'none') return op(src)
  if (mode.kind === 'auto') {
    return [
      `local({`,
      `  .src <- ${src}`,
      `  .crs <- ourgeo_calc_crs(.src)`,
      `  sf::st_transform(${op(`sf::st_transform(.src, .crs)`)}, sf::st_crs(.src))`,
      `})`,
    ].join('\n')
  }
  return [
    `local({`,
    `  .src <- ${src}`,
    `  sf::st_transform(${op(`sf::st_transform(.src, ${mode.expr})`)}, sf::st_crs(.src))`,
    `})`,
  ].join('\n')
}

/** transform → op → transform-back wrapper for two dataset refs. */
export function withCalcCrs2(
  v: Values,
  src1: string,
  src2: string,
  op: (ref1: string, ref2: string) => string
): string {
  const mode = resolveCalcCrs(v)
  if (mode.kind === 'none') return op(src1, src2)
  const crsExpr = mode.kind === 'auto' ? '.crs' : mode.expr
  const crsLine = mode.kind === 'auto' ? [`  .crs <- ourgeo_calc_crs(.a)`] : []
  return [
    `local({`,
    `  .a <- ${src1}`,
    `  .b <- ${src2}`,
    ...crsLine,
    `  sf::st_transform(${op(`sf::st_transform(.a, ${crsExpr})`, `sf::st_transform(.b, ${crsExpr})`)}, sf::st_crs(.a))`,
    `})`,
  ].join('\n')
}

/** Build a single R filter expression from a FilterCondition */
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
      // Binary comparison: ==, !=, >, >=, <, <=
      const rhs = c.rhsType === 'column' ? q(c.rhsCol) : rVal(c.rhsVal)
      return `${col} ${c.op} ${rhs}`
    }
  }
}

// ── Category 1: Table Operations ──────────────────────────────────────────

const tableOps: ToolDef[] = [
  {
    id: 'filter-rows',
    label: 'Filter Rows',
    description: 'Keep rows matching one or more conditions.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'conds', label: 'Conditions', type: 'filter-conditions', datasetField: 'ds' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_filtered` : '' },
    ],
    buildCode: v => {
      const ds = v.ds || 'data'
      const out = v.out || 'result'
      let conditions: FilterCondition[] = []
      try { conditions = JSON.parse(v.conds || '[]') } catch { /* ignore */ }

      const valid = conditions.filter(c => c.col && c.op)
      if (valid.length === 0) return `${out} <- dplyr::filter(${ds}, TRUE)`

      const exprs = valid.map(buildFilterExpr)

      // If all AND, use separate filter args (cleaner output)
      const allAnd = valid.every((c, i) => i === 0 || c.joinOp === 'AND')
      if (allAnd) {
        return exprs.length === 1
          ? `${out} <- dplyr::filter(${ds}, ${exprs[0]})`
          : `${out} <- dplyr::filter(${ds},\n  ${exprs.join(',\n  ')})`
      }

      // Mixed AND/OR — build a single combined expression
      let expr = `(${exprs[0]})`
      for (let i = 1; i < valid.length; i++) {
        expr += valid[i].joinOp === 'AND' ? ` &\n  (${exprs[i]})` : ` |\n  (${exprs[i]})`
      }
      return `${out} <- dplyr::filter(${ds}, ${expr})`
    },
  },
  {
    id: 'select-columns',
    label: 'Select Columns',
    description: 'Keep only the specified columns.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'cols', label: 'Columns to Keep', type: 'column', datasetField: 'ds', multi: true },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_sel` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::select(${v.ds || 'data'}, ${selectCols(v.cols || '')})`,
  },
  {
    id: 'remove-columns',
    label: 'Remove Columns',
    description: 'Drop the specified columns.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'cols', label: 'Columns to Remove', type: 'column', datasetField: 'ds', multi: true },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_dropped` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::select(${v.ds || 'data'}, -c(${selectCols(v.cols || '')}))`,
  },
  {
    id: 'arrange',
    label: 'Sort / Arrange',
    description: 'Sort rows by one or more columns, each ascending or descending.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'sortcols', label: 'Sort Columns', type: 'arrange-columns', datasetField: 'ds' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_sorted` : '' },
    ],
    buildCode: v => {
      const ds = v.ds || 'data'
      const out = v.out || 'result'
      let sortCols: ArrangeColumn[] = []
      try { sortCols = JSON.parse(v.sortcols || '[]') } catch { /* ignore */ }

      const valid = sortCols.filter(c => c.col)
      if (valid.length === 0) return `${out} <- dplyr::arrange(${ds})`

      const args = valid.map(c => c.dir === 'desc' ? `dplyr::desc(${q(c.col)})` : q(c.col))
      return `${out} <- dplyr::arrange(${ds}, ${args.join(', ')})`
    },
  },
  {
    id: 'rename-column',
    label: 'Rename Column',
    description: 'Rename one column to a new name.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'old', label: 'Column to Rename', type: 'column', datasetField: 'ds' },
      { id: 'new', label: 'New Name', type: 'text', placeholder: 'new_column_name' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::rename(${v.ds || 'data'}, \`${v.new || 'new_col'}\` = ${q(v.old || 'col')})`,
  },
  {
    id: 'mutate',
    label: 'Add / Mutate Column',
    description: 'Create a new column using an R expression.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'colname', label: 'New Column Name', type: 'text', placeholder: 'new_col' },
      { id: 'expr', label: 'Expression', type: 'text', placeholder: 'col_a + col_b' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.colname || 'new_col')} = ${v.expr || 'NA'})`,
  },
  {
    id: 'distinct',
    label: 'Remove Duplicates',
    description: 'Remove duplicate rows, optionally based on specific columns.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'cols', label: 'Key Columns (optional)', type: 'column', datasetField: 'ds', multi: true },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_distinct` : '' },
    ],
    buildCode: v => {
      const keyCols = v.cols?.trim() ? `, ${selectCols(v.cols)}` : ''
      return `${v.out || 'result'} <- dplyr::distinct(${v.ds || 'data'}${keyCols})`
    },
  },
  {
    id: 'slice',
    label: 'Slice Rows',
    description: 'Select rows by position (from–to, 1-based).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'from', label: 'From Row', type: 'number', min: 1, step: 1, default: '1' },
      { id: 'to', label: 'To Row', type: 'number', min: 1, step: 1, default: '10' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_slice` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::slice(${v.ds || 'data'}, ${v.from || 1}:${v.to || 10})`,
  },
  {
    id: 'sample-rows',
    label: 'Sample Rows',
    description: 'Randomly sample rows by count or fraction.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'type', label: 'Sample Type', type: 'select', options: [{ value: 'n', label: 'Count (n)' }, { value: 'frac', label: 'Fraction (0–1)' }] },
      { id: 'val', label: 'Value', type: 'number', min: 0, step: 1, default: '100' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_sample` : '' },
    ],
    buildCode: v => {
      const fn = v.type === 'frac' ? 'dplyr::slice_sample' : 'dplyr::slice_sample'
      const arg = v.type === 'frac' ? `prop = ${v.val || 0.1}` : `n = ${v.val || 100}`
      return `${v.out || 'result'} <- ${fn}(${v.ds || 'data'}, ${arg})`
    },
  },
  {
    id: 'head',
    label: 'Head',
    description: 'Return the first n rows.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'n', label: 'Rows (n)', type: 'number', min: 1, step: 1, default: '6' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_head` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- head(${v.ds || 'data'}, ${v.n || 6})`,
  },
  {
    id: 'tail',
    label: 'Tail',
    description: 'Return the last n rows.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'n', label: 'Rows (n)', type: 'number', min: 1, step: 1, default: '6' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_tail` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- tail(${v.ds || 'data'}, ${v.n || 6})`,
  },
]

// ── Category 2: Joins & Combine ────────────────────────────────────────────

function joinTool(id: string, label: string, fn: string, desc: string): ToolDef {
  return {
    id,
    label,
    description: desc,
    fields: [
      { id: 'left', label: 'Left Dataset', type: 'dataset', filter: 'any' },
      { id: 'right', label: 'Right Dataset', type: 'dataset', filter: 'any' },
      { id: 'leftkey', label: 'Left Key Column', type: 'column', datasetField: 'left' },
      { id: 'rightkey', label: 'Right Key Column', type: 'column', datasetField: 'right' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.left ? `${v.left}_${id.split('-')[0]}` : '' },
    ],
    buildCode: v => {
      const byArg = v.leftkey && v.rightkey && v.leftkey === v.rightkey
        ? `by = "${v.leftkey || 'id'}"`
        : `by = c("${v.leftkey || 'id'}" = "${v.rightkey || 'id'}")`
      return `${v.out || 'result'} <- dplyr::${fn}(${v.left || 'left_data'}, ${v.right || 'right_data'}, ${byArg})`
    },
  }
}

const joinsOps: ToolDef[] = [
  joinTool('inner-join', 'Inner Join', 'inner_join', 'Keep rows with matching keys in both datasets.'),
  joinTool('left-join', 'Left Join', 'left_join', 'Keep all rows from the left dataset; add matching columns from the right.'),
  joinTool('right-join', 'Right Join', 'right_join', 'Keep all rows from the right dataset; add matching columns from the left.'),
  joinTool('full-join', 'Full Join', 'full_join', 'Keep all rows from both datasets.'),
  joinTool('anti-join', 'Anti Join', 'anti_join', 'Keep rows from the left dataset that have NO match in the right.'),
  joinTool('semi-join', 'Semi Join', 'semi_join', 'Keep rows from the left dataset that have a match in the right, without duplicating columns.'),
  {
    id: 'bind-rows',
    label: 'Bind Rows',
    description: 'Stack two datasets vertically (same columns).',
    fields: [
      { id: 'ds1', label: 'Dataset 1', type: 'dataset', filter: 'any' },
      { id: 'ds2', label: 'Dataset 2', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_appended` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::bind_rows(${v.ds1 || 'data1'}, ${v.ds2 || 'data2'})`,
  },
  {
    id: 'bind-cols',
    label: 'Bind Columns',
    description: 'Merge two datasets side by side (same number of rows).',
    fields: [
      { id: 'ds1', label: 'Dataset 1', type: 'dataset', filter: 'any' },
      { id: 'ds2', label: 'Dataset 2', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_merged` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- dplyr::bind_cols(${dsRef(v, meta, 'ds1', 'materialized', 'data1')}, ${dsRef(v, meta, 'ds2', 'materialized', 'data2')})`,
  },
]

// ── Category 3: Aggregate & Reshape ───────────────────────────────────────

const aggregateOps: ToolDef[] = [
  {
    id: 'group-summarize',
    label: 'Group & Summarize',
    description: 'Group rows by a column and compute an aggregate statistic.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'groupcol', label: 'Group By Column', type: 'column', datasetField: 'ds' },
      { id: 'aggcol', label: 'Aggregate Column', type: 'column', datasetField: 'ds' },
      { id: 'fn', label: 'Function', type: 'select', options: [
        { value: 'sum', label: 'Sum' }, { value: 'mean', label: 'Mean' },
        { value: 'n', label: 'Count (n)' }, { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' }, { value: 'sd', label: 'Std Dev' },
        { value: 'median', label: 'Median' },
      ]},
      { id: 'newcol', label: 'Result Column Name', type: 'text', placeholder: 'result', default: 'value' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_summary` : '' },
    ],
    buildCode: v => {
      const fn = v.fn || 'sum'
      const aggExpr = fn === 'n' ? 'dplyr::n()' : `${fn}(${q(v.aggcol || 'col')}, na.rm = TRUE)`
      return [
        `${v.out || 'result'} <- ${v.ds || 'data'} |>`,
        `  dplyr::group_by(${q(v.groupcol || 'group')}) |>`,
        `  dplyr::summarize(${q(v.newcol || 'value')} = ${aggExpr}, .groups = "drop")`,
      ].join('\n')
    },
  },
  {
    id: 'count',
    label: 'Count',
    description: 'Count the number of rows per group.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_count` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::count(${v.ds || 'data'}, ${q(v.col || 'col')})`,
  },
  {
    id: 'pivot-wider',
    label: 'Pivot Wider',
    description: 'Spread rows into columns (long → wide format).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'names_from', label: 'Names From Column', type: 'column', datasetField: 'ds' },
      { id: 'values_from', label: 'Values From Column', type: 'column', datasetField: 'ds' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_wide` : '' },
    ],
    buildCode: v => [
      `${v.out || 'result'} <- tidyr::pivot_wider(`,
      `  ${v.ds || 'data'},`,
      `  names_from = ${q(v.names_from || 'name')},`,
      `  values_from = ${q(v.values_from || 'value')}`,
      `)`,
    ].join('\n'),
  },
  {
    id: 'pivot-longer',
    label: 'Pivot Longer',
    description: 'Gather columns into rows (wide → long format).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'cols', label: 'Columns to Pivot', type: 'column', datasetField: 'ds', multi: true },
      { id: 'names_to', label: 'Names To', type: 'text', placeholder: 'name', default: 'name' },
      { id: 'values_to', label: 'Values To', type: 'text', placeholder: 'value', default: 'value' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_long` : '' },
    ],
    buildCode: v => [
      `${v.out || 'result'} <- tidyr::pivot_longer(`,
      `  ${v.ds || 'data'},`,
      `  cols = c(${selectCols(v.cols || '')}),`,
      `  names_to = "${v.names_to || 'name'}",`,
      `  values_to = "${v.values_to || 'value'}"`,
      `)`,
    ].join('\n'),
  },
  {
    id: 'freq-table',
    label: 'Frequency Table',
    description: 'Compute a frequency table for a column.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.col ? `${v.col}_freq` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- as.data.frame(table(${v.ds || 'data'}$${q(v.col || 'col')}))`,
  },
]

// ── Category 4: Type & String ──────────────────────────────────────────────

const typeStringOps: ToolDef[] = [
  {
    id: 'cast-type',
    label: 'Cast Column Type',
    description: 'Convert a column to a different data type.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'totype', label: 'Target Type', type: 'select', options: [
        { value: 'character', label: 'Character (text)' },
        { value: 'numeric', label: 'Numeric' },
        { value: 'integer', label: 'Integer' },
        { value: 'logical', label: 'Logical' },
        { value: 'factor', label: 'Factor' },
        { value: 'Date', label: 'Date' },
        { value: 'POSIXct', label: 'DateTime (POSIXct)' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v => {
      const fn = v.totype === 'Date' ? 'as.Date' : v.totype === 'POSIXct' ? 'as.POSIXct' : `as.${v.totype || 'character'}`
      return `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.col || 'col')} = ${fn}(${q(v.col || 'col')}))`
    },
  },
  {
    id: 'str-replace',
    label: 'String Replace',
    description: 'Replace a pattern in a text column.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'pattern', label: 'Pattern', type: 'text', placeholder: 'pattern to find' },
      { id: 'replacement', label: 'Replacement', type: 'text', placeholder: 'replacement text' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.col || 'col')} = gsub("${v.pattern || ''}", "${v.replacement || ''}", ${q(v.col || 'col')}))`,
  },
  {
    id: 'str-case',
    label: 'To Upper / Lower',
    description: 'Convert a text column to upper or lower case.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'dir', label: 'Direction', type: 'select', options: [{ value: 'upper', label: 'UPPER CASE' }, { value: 'lower', label: 'lower case' }] },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v => {
      const fn = v.dir === 'lower' ? 'tolower' : 'toupper'
      return `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.col || 'col')} = ${fn}(${q(v.col || 'col')}))`
    },
  },
  {
    id: 'trim-ws',
    label: 'Trim Whitespace',
    description: 'Remove leading/trailing whitespace from a text column.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'which', label: 'Which Side', type: 'select', options: [{ value: 'both', label: 'Both' }, { value: 'left', label: 'Left only' }, { value: 'right', label: 'Right only' }] },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.col || 'col')} = trimws(${q(v.col || 'col')}, which = "${v.which || 'both'}"))`,
  },
  {
    id: 'fill-na',
    label: 'Fill NA Values',
    description: 'Replace NA values in a column with a specified value.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'val', label: 'Fill Value', type: 'text', placeholder: '0 or "unknown"' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v => {
      const fillList = `list(${q(v.col || 'col')} = ${v.val || 'NA'})`
      return `${v.out || 'result'} <- tidyr::replace_na(${v.ds || 'data'}, ${fillList})`
    },
  },
  {
    id: 'coalesce',
    label: 'Coalesce Columns',
    description: 'Combine two columns, using the second as a fallback for NAs.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'primary', label: 'Primary Column', type: 'column', datasetField: 'ds' },
      { id: 'fallback', label: 'Fallback Column', type: 'column', datasetField: 'ds' },
      { id: 'newcol', label: 'New Column Name', type: 'text', placeholder: 'combined', default: 'combined' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::mutate(${v.ds || 'data'}, ${q(v.newcol || 'combined')} = dplyr::coalesce(${q(v.primary || 'col1')}, ${q(v.fallback || 'col2')}))`,
  },
  {
    id: 'str-detect-filter',
    label: 'Filter by Pattern',
    description: 'Keep rows where a text column matches a pattern (regex).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column', type: 'column', datasetField: 'ds' },
      { id: 'pattern', label: 'Pattern (regex)', type: 'text', placeholder: 'e.g. ^New' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_filtered` : '' },
    ],
    buildCode: v =>
      `${v.out || 'result'} <- dplyr::filter(${v.ds || 'data'}, stringr::str_detect(${q(v.col || 'col')}, "${v.pattern || ''}"))`,
  },
  {
    id: 'separate',
    label: 'Separate Column',
    description: 'Split one column into multiple columns by a separator.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'col', label: 'Column to Split', type: 'column', datasetField: 'ds' },
      { id: 'into', label: 'New Column Names (comma separated)', type: 'text', placeholder: 'part1, part2' },
      { id: 'sep', label: 'Separator', type: 'text', placeholder: ',', default: ',' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: v => {
      const intoCols = cols(v.into || 'part1, part2').map(c => `"${c}"`).join(', ')
      return [
        `${v.out || 'result'} <- tidyr::separate(`,
        `  ${v.ds || 'data'},`,
        `  col = ${q(v.col || 'col')},`,
        `  into = c(${intoCols}),`,
        `  sep = "${v.sep || ','}"`,
        `)`,
      ].join('\n')
    },
  },
]

// ── Category 5: Spatial — sf ───────────────────────────────────────────────

const spatialSfOps: ToolDef[] = [
  {
    id: 'sf-buffer',
    label: 'Buffer',
    description:
      'Create buffer zones around sf geometries. Exact curved output (true circular arcs) ' +
      'requires planar math: on geographic (lat/lon) data set Calculation CRS to a projected ' +
      'EPSG (e.g. the local UTM zone) — otherwise the buffer is computed linearized.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'dist', label: 'Distance', type: 'number', min: 0, step: 1, default: '100' },
      { id: 'units', label: 'Units', type: 'select', options: [
        { value: 'meters', label: 'Meters' }, { value: 'kilometers', label: 'Kilometers' },
        { value: 'feet', label: 'Feet' }, { value: 'miles', label: 'Miles' },
      ]},
      {
        id: 'nquadsegs', label: 'Segments per Quadrant', type: 'number', min: 1, step: 1, default: '30',
        // Only meaningful for linearized (GEOS) buffering — the exact sfarc
        // path produces true arcs and ignores segment counts.
        visibleWhen: v => v.linearize === 'true',
      },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_buffer` : '' },
    ],
    buildCode: (v, meta) => {
      const dist = v.units && v.units !== 'meters'
        ? `units::set_units(${v.dist || 100}, "${v.units}")`
        : `${v.dist || 100}`
      const nqs = v.linearize === 'true' && v.nquadsegs ? `, nQuadSegs = ${v.nquadsegs}` : ''
      const src = dsRefL(v, meta, 'ds', 'materialized', 'sf_data')
      return `${v.out || 'result'} <- ${withCalcCrs(v, src, ref => `sf::st_buffer(${ref}, dist = ${dist}${nqs})`)}`
    },
  },
  {
    id: 'sf-intersection',
    label: 'Intersection',
    description: 'Return the shared area between two sf layers.',
    fields: [
      { id: 'ds1', label: 'sf Dataset 1', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'sf Dataset 2', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_intersection` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs2(
        v,
        dsRefL(v, meta, 'ds1', 'materialized', 'sf1'),
        dsRefL(v, meta, 'ds2', 'materialized', 'sf2'),
        (a, b) => `sf::st_intersection(${a}, ${b})`
      )}`,
  },
  {
    id: 'sf-union-dissolve',
    label: 'Union (Dissolve)',
    description: 'Dissolve all features in an sf layer into a single geometry.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_union` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs(
        v,
        dsRefL(v, meta, 'ds', 'materialized', 'sf_data'),
        ref => `sf::st_union(${ref})`
      )}`,
  },
  {
    id: 'sf-union-merge',
    label: 'Union (Merge Two Layers)',
    description: 'Combine two sf layers and dissolve all features.',
    fields: [
      { id: 'ds1', label: 'sf Dataset 1', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'sf Dataset 2', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_union` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs2(
        v,
        dsRefL(v, meta, 'ds1', 'materialized', 'sf1'),
        dsRefL(v, meta, 'ds2', 'materialized', 'sf2'),
        (a, b) => `sf::st_union(dplyr::bind_rows(${a}, ${b}))`
      )}`,
  },
  {
    id: 'sf-difference',
    label: 'Difference',
    description: 'Return the part of Dataset 1 that falls outside Dataset 2.',
    fields: [
      { id: 'ds1', label: 'Target sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'Clip sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_diff` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs2(
        v,
        dsRefL(v, meta, 'ds1', 'materialized', 'sf1'),
        dsRefL(v, meta, 'ds2', 'materialized', 'sf2'),
        (a, b) => `sf::st_difference(${a}, ${b})`
      )}`,
  },
  {
    id: 'sf-erase',
    label: 'Erase',
    description: 'Erase the area of Dataset 2 from Dataset 1 (using unioned erase layer).',
    fields: [
      { id: 'ds1', label: 'Target sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'Erase sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_erased` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs2(
        v,
        dsRefL(v, meta, 'ds1', 'materialized', 'sf1'),
        dsRefL(v, meta, 'ds2', 'materialized', 'sf2'),
        (a, b) => `sf::st_difference(${a}, sf::st_union(${b}))`
      )}`,
  },
  {
    id: 'sf-clip',
    label: 'Clip',
    description: 'Clip features to the extent/shape of a second sf layer.',
    fields: [
      { id: 'ds1', label: 'Target sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'Clip sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_clipped` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs2(
        v,
        dsRefL(v, meta, 'ds1', 'materialized', 'sf1'),
        dsRefL(v, meta, 'ds2', 'materialized', 'sf2'),
        (a, b) => `sf::st_intersection(${a}, sf::st_union(${b}))`
      )}`,
  },
  {
    id: 'sf-spatial-filter',
    label: 'Spatial Filter',
    description: 'Select features that satisfy a spatial predicate with another layer. Predicates are GEOS-only — tick Linearize for curved inputs.',
    fields: [
      { id: 'ds1', label: 'Features sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'Filter by sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'pred', label: 'Predicate', type: 'select', options: [
        { value: 'st_intersects', label: 'Intersects' },
        { value: 'st_within', label: 'Within' },
        { value: 'st_contains', label: 'Contains' },
        { value: 'st_overlaps', label: 'Overlaps' },
        { value: 'st_touches', label: 'Touches' },
        { value: 'st_crosses', label: 'Crosses' },
        { value: 'st_disjoint', label: 'Disjoint' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_spatfilter` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- sf::st_filter(${dsRefL(v, meta, 'ds1', 'materialized', 'sf1')}, ${dsRefL(v, meta, 'ds2', 'materialized', 'sf2')}, .predicate = sf::${v.pred || 'st_intersects'})`,
  },
  {
    id: 'sf-spatial-join',
    label: 'Spatial Join',
    description: 'Join attributes from a second layer based on spatial relationship. Spatial joins are GEOS-only — tick Linearize for curved inputs.',
    fields: [
      { id: 'ds1', label: 'Left sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'ds2', label: 'Right sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'join', label: 'Join Type', type: 'select', options: [
        { value: 'left', label: 'Left Join' },
        { value: 'inner', label: 'Inner Join' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_spatjoin` : '' },
    ],
    buildCode: (v, meta) => {
      const left = v.join === 'inner' ? 'FALSE' : 'TRUE'
      return `${v.out || 'result'} <- sf::st_join(${dsRefL(v, meta, 'ds1', 'materialized', 'sf1')}, ${dsRefL(v, meta, 'ds2', 'materialized', 'sf2')}, join = sf::st_intersects, left = ${left})`
    },
  },
  {
    id: 'sf-centroid',
    label: 'Centroid',
    description: 'Compute centroids of sf geometries.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_centroid` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs(
        v,
        dsRefL(v, meta, 'ds', 'materialized', 'sf_data'),
        ref => `sf::st_centroid(${ref})`
      )}`,
  },
  {
    id: 'sf-add-area',
    label: 'Add Area Column',
    description: 'Add a column containing the area of each feature.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'colname', label: 'New Column Name', type: 'text', placeholder: 'area', default: 'area' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- dplyr::mutate(${dsRefL(v, meta, 'ds', 'materialized', 'sf_data')}, ${q(v.colname || 'area')} = as.numeric(sf::st_area(geometry)))`,
  },
  {
    id: 'sf-add-length',
    label: 'Add Length Column',
    description: 'Add a column containing the length of each line feature.',
    fields: [
      { id: 'ds', label: 'sf Line Dataset', type: 'dataset', filter: 'sf' },
      { id: 'colname', label: 'New Column Name', type: 'text', placeholder: 'length', default: 'length' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds || '' },
    ],
    buildCode: (v, meta) =>
      // Unqualified st_length: sf's version is a plain function (not a
      // generic), so sfarc masks it at attach time — the unqualified call
      // resolves to sfarc's exact curved version when loaded, sf's otherwise.
      `${v.out || 'result'} <- dplyr::mutate(${dsRefL(v, meta, 'ds', 'materialized', 'sf_data')}, ${q(v.colname || 'length')} = as.numeric(st_length(geometry)))`,
  },
  {
    id: 'sf-transform',
    label: 'CRS Transform',
    description: 'Reproject an sf object to a different coordinate reference system.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'crs', label: 'Target CRS (EPSG or proj string)', type: 'text', placeholder: '4326', default: '4326' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_reproj` : '' },
    ],
    buildCode: (v, meta) => {
      const crs = isNaN(Number(v.crs)) ? `"${v.crs || '4326'}"` : Number(v.crs || 4326)
      return `${v.out || 'result'} <- sf::st_transform(${dsRefL(v, meta, 'ds', 'materialized', 'sf_data')}, crs = ${crs})`
    },
  },
  {
    id: 'sf-simplify',
    label: 'Simplify',
    description: 'Simplify geometries by removing vertices below a tolerance. GEOS-only — tick Linearize for curved inputs.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'tol', label: 'Tolerance (dTolerance)', type: 'number', min: 0, step: 1, default: '100' },
      { id: 'preserve', label: 'Preserve Topology', type: 'select', options: [{ value: 'TRUE', label: 'Yes (recommended)' }, { value: 'FALSE', label: 'No' }] },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_simplified` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- ${withCalcCrs(
        v,
        dsRefL(v, meta, 'ds', 'materialized', 'sf_data'),
        ref => `sf::st_simplify(${ref}, preserveTopology = ${v.preserve || 'TRUE'}, dTolerance = ${v.tol || 100})`
      )}`,
  },
  {
    id: 'sf-cast',
    label: 'Cast Geometry',
    description: 'Convert geometry type (e.g. POLYGON → MULTIPOLYGON). GEOS-only — tick Linearize for curved inputs.',
    fields: [
      { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
      { id: 'geomtype', label: 'Target Geometry Type', type: 'select', options: [
        { value: 'POINT', label: 'POINT' }, { value: 'MULTIPOINT', label: 'MULTIPOINT' },
        { value: 'LINESTRING', label: 'LINESTRING' }, { value: 'MULTILINESTRING', label: 'MULTILINESTRING' },
        { value: 'POLYGON', label: 'POLYGON' }, { value: 'MULTIPOLYGON', label: 'MULTIPOLYGON' },
        { value: 'GEOMETRYCOLLECTION', label: 'GEOMETRYCOLLECTION' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_cast` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- sf::st_cast(${dsRefL(v, meta, 'ds', 'materialized', 'sf_data')}, "${v.geomtype || 'MULTIPOLYGON'}")`,
  },
  {
    id: 'sf-points-from-cols',
    label: 'Points from XY Columns',
    description: 'Convert a tabular dataset with coordinate columns into an sf points layer.',
    fields: [
      { id: 'ds', label: 'Tabular Dataset', type: 'dataset', filter: 'any' },
      { id: 'xcol', label: 'X / Longitude Column', type: 'column', datasetField: 'ds' },
      { id: 'ycol', label: 'Y / Latitude Column', type: 'column', datasetField: 'ds' },
      { id: 'crs', label: 'CRS (EPSG)', type: 'text', placeholder: '4326', default: '4326' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_sf` : '' },
    ],
    buildCode: (v, meta) => [
      // Tabular input — never curved; plain dsRef on purpose.
      `${v.out || 'result'} <- sf::st_as_sf(`,
      `  ${dsRef(v, meta, 'ds', 'materialized', 'data')},`,
      `  coords = c("${v.xcol || 'x'}", "${v.ycol || 'y'}"),`,
      `  crs = ${isNaN(Number(v.crs)) ? `"${v.crs || '4326'}"` : Number(v.crs || 4326)}`,
      `)`,
    ].join('\n'),
  },
]

// ── Category 6: Spatial — geos ─────────────────────────────────────────────

const spatialGeosOps: ToolDef[] = [
  {
    id: 'geos-buffer',
    label: 'Buffer',
    description: 'Create buffer zones using the geos engine (planar distance).',
    fields: [
      { id: 'ds', label: 'Dataset (geos_geometry or sf)', type: 'dataset', filter: 'any' },
      { id: 'dist', label: 'Distance', type: 'number', min: 0, step: 1, default: '100' },
      { id: 'quad_segs', label: 'Segments per Quadrant', type: 'number', min: 1, step: 1, default: '30' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_buffer` : '' },
    ],
    buildCode: (v, meta) => {
      const params = v.quad_segs ? `, params = geos::geos_buffer_params(quad_segs = ${v.quad_segs})` : ''
      return `${v.out || 'result'} <- geos::geos_buffer(${dsRefL(v, meta, 'ds', 'materialized')}, distance = ${v.dist || 100}${params})`
    },
  },
  {
    id: 'geos-intersection',
    label: 'Intersection',
    description: 'Return the shared geometry between two geos datasets.',
    fields: [
      { id: 'ds1', label: 'Dataset 1', type: 'dataset', filter: 'any' },
      { id: 'ds2', label: 'Dataset 2', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_intersection` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_intersection(${dsRefL(v, meta, 'ds1', 'materialized', 'geom1')}, ${dsRefL(v, meta, 'ds2', 'materialized', 'geom2')})`,
  },
  {
    id: 'geos-union',
    label: 'Union',
    description: 'Dissolve all geometries in a dataset into a single geometry.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_union` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_unary_union(${dsRefL(v, meta, 'ds', 'materialized')})`,
  },
  {
    id: 'geos-difference',
    label: 'Difference',
    description: 'Return the part of Dataset 1 not covered by Dataset 2.',
    fields: [
      { id: 'ds1', label: 'Dataset 1', type: 'dataset', filter: 'any' },
      { id: 'ds2', label: 'Dataset 2', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_diff` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_difference(${dsRefL(v, meta, 'ds1', 'materialized', 'geom1')}, ${dsRefL(v, meta, 'ds2', 'materialized', 'geom2')})`,
  },
  {
    id: 'geos-centroid',
    label: 'Centroid',
    description: 'Compute centroids using the geos engine.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_centroid` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_centroid(${dsRefL(v, meta, 'ds', 'materialized')})`,
  },
  {
    id: 'geos-area',
    label: 'Area',
    description: 'Compute the area of each geometry (planar).',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_area` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_area(${dsRefL(v, meta, 'ds', 'materialized')})`,
  },
  {
    id: 'geos-distance',
    label: 'Distance',
    description: 'Compute pairwise distances between two geos datasets.',
    fields: [
      { id: 'ds1', label: 'Dataset 1', type: 'dataset', filter: 'any' },
      { id: 'ds2', label: 'Dataset 2', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds1 ? `${v.ds1}_dist` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_distance(${dsRefL(v, meta, 'ds1', 'materialized', 'geom1')}, ${dsRefL(v, meta, 'ds2', 'materialized', 'geom2')})`,
  },
  {
    id: 'geos-convex-hull',
    label: 'Convex Hull',
    description: 'Compute the convex hull of each geometry.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_hull` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_convex_hull(${dsRefL(v, meta, 'ds', 'materialized')})`,
  },
  {
    id: 'geos-simplify',
    label: 'Simplify',
    description: 'Simplify geometries using Douglas-Peucker algorithm.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'tol', label: 'Tolerance', type: 'number', min: 0, step: 1, default: '100' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_simplified` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_simplify(${dsRefL(v, meta, 'ds', 'materialized')}, tolerance = ${v.tol || 100})`,
  },
  {
    id: 'geos-make-valid',
    label: 'Make Valid',
    description: 'Repair invalid geometries.',
    fields: [
      { id: 'ds', label: 'Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_valid` : '' },
    ],
    buildCode: (v, meta) =>
      `${v.out || 'result'} <- geos::geos_make_valid(${dsRefL(v, meta, 'ds', 'materialized')})`,
  },
  {
    id: 'geos-voronoi',
    label: 'Voronoi Polygons',
    description: 'Generate Voronoi polygons from a set of point geometries.',
    fields: [
      { id: 'ds', label: 'Point Dataset', type: 'dataset', filter: 'any' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.ds ? `${v.ds}_voronoi` : '' },
    ],
    buildCode: (v, meta) => [
      `${v.out || 'result'} <- geos::geos_voronoi_polygons(`,
      `  geos::geos_unary_union(${dsRefL(v, meta, 'ds', 'materialized')})`,
      `)`,
    ].join('\n'),
  },
]

// Assignment is an explicit metadata assumption, never a guessed transform.
spatialSfOps.push({
  id: 'assign-crs', label: 'Assign CRS',
  description: 'These existing coordinates are already expressed in this CRS. Values do not change. Assignment requires explicit review.',
  fields: [
    { id: 'ds', label: 'sf Dataset', type: 'dataset', filter: 'sf' },
    { id: 'crs', label: 'Known coordinate CRS (EPSG or WKT)', type: 'text' },
    { id: 'out', label: 'Derived copy name', type: 'output-name', derive: v => `${v.ds}_assigned` },
  ],
  buildCode: v => `${v.out || 'result'} <- sf::st_set_crs(${v.ds || 'data'}, ${rStr(v.crs || '')})`,
})

// ── Export ─────────────────────────────────────────────────────────────────

// Tools whose inputs are tabular (no geometry) — the linearize checkbox
// would be meaningless (and st_linearize has no data.frame method).
const NO_LINEARIZE = new Set(['sf-points-from-cols', 'assign-crs'])

// Tools whose planar math needs a projected CRS (exact curved results, and
// meter-valued tolerances) — these get the Calculation CRS fields.
const CALC_CRS_TOOLS = new Set([
  'sf-buffer', 'sf-intersection', 'sf-union-dissolve', 'sf-union-merge',
  'sf-difference', 'sf-erase', 'sf-clip', 'sf-centroid', 'sf-simplify',
])

function insertBeforeOutput(tool: ToolDef, field: FieldDef): ToolDef {
  const idx = tool.fields.findIndex((f) => f.type === 'output-name')
  const fields =
    idx >= 0
      ? [...tool.fields.slice(0, idx), field, ...tool.fields.slice(idx)]
      : [...tool.fields, field]
  return { ...tool, fields }
}

const addLinearize = (tools: ToolDef[]): ToolDef[] =>
  tools.map((t) => {
    if (NO_LINEARIZE.has(t.id)) return t
    let out = withLinearize(t)
    if (CALC_CRS_TOOLS.has(t.id)) {
      out = insertBeforeOutput(out, CALC_CRS_FIELD)
      out = insertBeforeOutput(out, CALC_CRS_CUSTOM_FIELD)
    }
    return out
  })

const BUILTIN_CATEGORIES: Category[] = [
  { id: 'table', label: 'Table Operations', tools: tableOps },
  { id: 'joins', label: 'Joins & Combine', tools: joinsOps },
  { id: 'aggregate', label: 'Aggregate & Reshape', tools: aggregateOps },
  { id: 'typestring', label: 'Type & String', tools: typeStringOps },
  { id: 'spatial-sf', label: 'Spatial — sf', tools: addLinearize(spatialSfOps) },
  { id: 'spatial-geos', label: 'Spatial — geos', tools: addLinearize(spatialGeosOps) },
  // Raster tools skip the linearize/calc-CRS injection — those are sf/geos
  // concepts; terra handles CRS via terra::project explicitly.
  { id: 'spatial-raster', label: 'Spatial — Raster', tools: rasterOps },
]

// Shared form policies belong to the actual tools, so the assistant describes
// the same choices that the user sees. No normalisation is a hidden default.
for (const category of BUILTIN_CATEGORIES) {
  category.tools = category.tools.map(tool => {
    let result = tool
    if (/^(left|right|inner|full|anti|semi)-join$/.test(tool.id)) {
      for (const field of [
        { id: 'relationship', label: 'Expected relationship', type: 'select', options: [
          { value: 'many-to-one', label: 'Many left to one right' }, { value: 'one-to-one', label: 'One to one' },
          { value: 'one-to-many', label: 'One left to many right' }, { value: 'many-to-many', label: 'Many to many (review expansion)' },
        ] },
        { id: 'suffixLeft', label: 'Colliding left field suffix', type: 'text', default: '.x' },
        { id: 'suffixRight', label: 'Colliding right field suffix', type: 'text', default: '.y' },
      ] as FieldDef[]) result = insertBeforeOutput(result, field)
    }
    if (tool.id === 'group-summarize') result = insertBeforeOutput(result, {
      id: 'missingPolicy', label: 'Missing / non-finite values', type: 'select', options: [
        { value: 'block', label: 'Block until resolved' }, { value: 'propagate', label: 'Propagate missing result' }, { value: 'omit', label: 'Omit with explicit denominators' },
      ],
    })
    if (['sf-add-area','sf-add-length','sf-spatial-filter','sf-spatial-join','geos-buffer','geos-area','geos-distance','geos-intersection','geos-difference','geos-union'].includes(tool.id)) result = insertBeforeOutput(result, {
      id: 'workingCRS', label: 'Working CRS (native, EPSG or WKT; no inferred UTM)', type: 'text', default: 'native',
    })
    if (tool.id === 'geos-buffer') result = { ...result, fields: result.fields.map(f => f.id === 'dist' ? { ...f, label: 'Distance (metres, converted to working CRS units)' } : f) }
    if (['sf-add-area','sf-add-length'].includes(tool.id)) result = { ...result, fields: result.fields.map(f => f.type === 'output-name' ? { ...f, derive: v => v.ds ? `${v.ds}_${tool.id === 'sf-add-area' ? 'area' : 'length'}` : '' } : f) }
    if (tool.id === 'sf-buffer') {
      result = { ...result, description: 'Positive metric buffer. Native geographic input uses S2 spherical metres; projected input uses planar units converted explicitly. A chosen working CRS is reviewed before analytical transformation.' }
      result.fields = result.fields.map(f => f.id === 'units' && f.type === 'select' ? { ...f, options: [
        { value: 'm', label: 'Metres' }, { value: 'km', label: 'Kilometres' }, { value: 'ft', label: 'International feet' }, { value: 'US_survey_foot', label: 'US survey feet' }, { value: 'mi', label: 'Miles' },
      ] } : f)
    }
    if (['sf-buffer','sf-add-area','sf-add-length'].includes(tool.id)) result = insertBeforeOutput(result, {
      id: 'method', label: 'Geographic method (projected inputs remain planar)', type: 'select', options: [{ value: 's2', label: 'S2 spherical metric; output metres / square metres' }],
    })
    const checked = /^(left|right|inner|full|anti|semi)-join$/.test(tool.id) || tool.id === 'group-summarize' || ['sf-buffer','sf-intersection','sf-difference','sf-erase','sf-clip','sf-union-dissolve','sf-union-merge','sf-spatial-filter','sf-spatial-join','sf-add-area','sf-add-length','sf-transform','assign-crs','geos-buffer','geos-area','geos-distance','geos-intersection','geos-difference','geos-union'].includes(tool.id)
    if (checked) {
      result.fields = result.fields.map(f => f.id === 'calccrs' && f.type === 'select' ? { ...f, options: f.options.filter(o => o.value !== 'auto').map(o => o.value === 'native' ? { value: 'native', label: 'Native CRS / supported S2 (no inferred projection)' } : o) } : f)
      for (const field of tool.fields.filter(f => f.type === 'dataset')) result = insertBeforeOutput(result, {
        id: `exclude_${field.id}`, label: `Explicitly exclude source rows from ${field.label} (1-based numbers, comma separated)`, type: 'text',
      })
      result = insertBeforeOutput(result, { id: 'exclusionReason', label: 'Reason for explicit exclusions (required when excluding)', type: 'text' })
    }
    return result
  })
}

/** The categories ouRGeo ships. */
export const BUILTIN_TOOL_CATEGORIES: readonly Category[] = BUILTIN_CATEGORIES

const BUILTIN_CATEGORY_IDS = new Set(BUILTIN_CATEGORIES.map(c => c.id))
const BUILTIN_TOOL_IDS = new Set(BUILTIN_CATEGORIES.flatMap(c => c.tools).map(t => t.id))

let liveCategories: Category[] = BUILTIN_CATEGORIES

/**
 * The live category list — shipped first, then plugin-contributed.
 *
 * A function rather than a const because a plugin can add a tool while the app
 * runs, and the Toolbox dialog, `toolbox_tools` and `run_toolbox_tool` all have
 * to see it. Same contract as the theme and action registries: only
 * `registerPluginTools` writes, and React reads `usePluginStore` to re-render.
 */
export function categoryList(): Category[] {
  return liveCategories
}

/** Every tool in the live registry, flattened. */
export function toolList(): ToolDef[] {
  return liveCategories.flatMap(c => c.tools)
}

/**
 * Replace every plugin-contributed tool with `categories`, in one pass.
 *
 * A plugin may add tools to a shipped category (they are appended, so the
 * built-ins keep their order) or declare a category of its own. Tool ids are
 * global — `run_toolbox_tool` takes one with no category — so a plugin tool
 * that collides with a shipped id is dropped rather than allowed to shadow it.
 */
export function registerPluginTools(categories: Category[]): void {
  const seenTools = new Set<string>()
  const extraByCategory = new Map<string, ToolDef[]>()
  const newCategories: Category[] = []

  for (const cat of categories) {
    const tools = cat.tools.filter(t => {
      if (BUILTIN_TOOL_IDS.has(t.id) || seenTools.has(t.id)) return false
      seenTools.add(t.id)
      return true
    })
    if (tools.length === 0) continue
    if (BUILTIN_CATEGORY_IDS.has(cat.id)) {
      extraByCategory.set(cat.id, [...(extraByCategory.get(cat.id) ?? []), ...tools])
    } else {
      const existing = newCategories.find(c => c.id === cat.id)
      if (existing) existing.tools.push(...tools)
      else newCategories.push({ ...cat, tools: [...tools] })
    }
  }

  if (extraByCategory.size === 0 && newCategories.length === 0) {
    liveCategories = BUILTIN_CATEGORIES
    return
  }
  liveCategories = [
    ...BUILTIN_CATEGORIES.map(c => {
      const extra = extraByCategory.get(c.id)
      return extra ? { ...c, tools: [...c.tools, ...extra] } : c
    }),
    ...newCategories,
  ]
}
