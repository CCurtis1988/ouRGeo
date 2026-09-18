// ERDDAP griddap provider — gridded scientific data (SST, chlorophyll, climate
// model grids). One dataset variable at one time slice imports as a GeoTIFF
// grid via ourgeo_read_erddap_grid() (r/lib/util-erddap.R) → terra SpatRaster.
// Tabular ERDDAP (tabledap) stays under the Scientific category.

import { useSpatialStore } from '@/store/spatial'
import { col, getTable, type ErddapTableData } from './erddap'
import type { FieldKind, FilterOp } from './query-model'
import type { ApiProvider, DownloadCodeOptions } from './types'

/** ERDDAP data type → ArcGIS-style pixel code the size estimate understands. */
const PIXEL_TYPES: Record<string, string> = {
  byte: 'S8', ubyte: 'U8', short: 'S16', ushort: 'U16',
  int: 'S32', uint: 'U32', float: 'F32', double: 'F64',
}

interface GridInfo {
  /** Data (non-axis) variables: name → long_name. */
  variables: Map<string, string | undefined>
  /** Data type per variable (ERDDAP names, e.g. "float"). */
  dtypes: Map<string, string>
  extent4326?: [number, number, number, number]
  timeStart?: string
  timeEnd?: string
}

// info/{id}/index.json parsed once per server+dataset; the variable level and
// getMetadata both read from here.
const infoCache = new Map<string, GridInfo>()

function parseGridInfo(t: ErddapTableData): GridInfo {
  const rowTypeI = col(t, 'Row Type')
  const nameI = col(t, 'Variable Name')
  const attrI = col(t, 'Attribute Name')
  const valueI = col(t, 'Value')
  const dtypeI = col(t, 'Data Type')

  const variables = new Map<string, string | undefined>()
  const dtypes = new Map<string, string>()
  const attrs = new Map<string, string>() // "var|attr" → value
  for (const r of t.rows) {
    const rowType = String(r[rowTypeI])
    const name = String(r[nameI])
    // griddap info marks axes as "dimension" rows and data variables as "variable".
    if (rowType === 'variable') {
      variables.set(name, undefined)
      dtypes.set(name, String(r[dtypeI] ?? ''))
    } else if (rowType === 'attribute') {
      attrs.set(`${name}|${String(r[attrI])}`, String(r[valueI] ?? ''))
    }
  }
  for (const name of variables.keys()) {
    variables.set(name, attrs.get(`${name}|long_name`))
  }

  const range = (axis: string): [number, number] | null => {
    const v = (attrs.get(`${axis}|actual_range`) ?? '').split(',').map((s) => Number(s.trim()))
    return v.length === 2 && v.every(Number.isFinite) ? [Math.min(v[0], v[1]), Math.max(v[0], v[1])] : null
  }
  const lon = range('longitude')
  const lat = range('latitude')
  return {
    variables,
    dtypes,
    extent4326: lon && lat ? [lon[0], lat[0], lon[1], lat[1]] : undefined,
    timeStart: attrs.get('NC_GLOBAL|time_coverage_start'),
    timeEnd: attrs.get('NC_GLOBAL|time_coverage_end'),
  }
}

async function fetchGridInfo(baseUrl: string, dataset: string): Promise<GridInfo> {
  const key = `${baseUrl}|${dataset}`
  const cached = infoCache.get(key)
  if (cached) return cached
  const t = await getTable(`${baseUrl}/info/${dataset}/index.json`)
  if (!t) throw new Error('Could not read dataset info from ERDDAP.')
  const info = parseGridInfo(t)
  infoCache.set(key, info)
  return info
}

/** R code importing one griddap variable slice via ourgeo_read_erddap_grid(). */
function buildGridCode(
  baseUrl: string, dataset: string, variable: string, varName: string, opts?: DownloadCodeOptions,
): string {
  const bbox = opts?.bbox !== undefined ? opts.bbox : useSpatialStore.getState().viewBbox
  const size = opts?.size ?? 2048
  const time = opts?.time?.trim() || 'last'
  const bboxLines = bbox
    ? [`  bbox       = c(${bbox.map((v) => parseFloat(v.toFixed(6))).join(', ')}),  # EPSG:4326 — edit to your AOI`]
    : ['  bbox       = NULL,  # NULL = full grid extent; pass c(xmin, ymin, xmax, ymax) for an AOI']
  return [
    'library(terra)',
    '',
    `# ERDDAP griddap export — ${dataset} / ${variable} (one time slice)`,
    `${varName} <- ourgeo_read_erddap_grid(`,
    `  base_url   = "${baseUrl}",`,
    `  dataset_id = "${dataset}",`,
    `  variable   = "${variable}",`,
    ...bboxLines,
    `  time       = "${time}",  # "last" or an ISO time within the dataset's range`,
    `  size       = ${size}L  # pixels on the long side (subsampled by stride)`,
    ')',
  ].join('\n')
}

export const erddapGridProvider: ApiProvider = {
  id: 'erddap-grid',
  label: 'ERDDAP Grids',
  category: 'Raster / Image Layers',
  description: 'ERDDAP griddap — gridded scientific data (SST, chlorophyll, climate grids). Imports one variable at one time slice as a terra SpatRaster.',
  docsUrl: 'https://www.ncei.noaa.gov/erddap/griddap/documentation.html',
  builtinServers: [
    { id: 'coastwatch', label: 'NOAA CoastWatch West Coast', baseUrl: 'https://coastwatch.pfeg.noaa.gov/erddap' },
    { id: 'ncei', label: 'NOAA NCEI', baseUrl: 'https://www.ncei.noaa.gov/erddap' },
  ],
  cascade: [
    { key: 'dataset', label: 'Dataset', placeholder: 'Select a gridded dataset' },
    { key: 'variable', label: 'Variable', placeholder: 'Select a variable' },
  ],

  async listLevel(levelKey, sel, ctx) {
    if (levelKey === 'dataset') {
      const t = await getTable(
        `${ctx.baseUrl}/tabledap/allDatasets.json?datasetID,title,dataStructure&dataStructure=${encodeURIComponent('"grid"')}`,
      )
      if (!t) return []
      const idI = col(t, 'datasetID'); const titleI = col(t, 'title')
      return t.rows
        .map((r) => ({ id: String(r[idI]), title: String(r[titleI] ?? r[idI]) }))
        .filter((d) => d.id && d.id !== 'allDatasets')
        .map((d) => ({ value: d.id, label: d.title }))
    }
    // variable
    const info = await fetchGridInfo(ctx.baseUrl, sel.dataset)
    return Array.from(info.variables.entries()).map(([name, longName]) => ({
      value: name,
      label: longName && longName !== name ? `${name} — ${longName}` : name,
    }))
  },

  async getMetadata(sel, ctx) {
    const info = await fetchGridInfo(ctx.baseUrl, sel.dataset)
    if (!info.variables.has(sel.variable)) {
      throw new Error(`Variable "${sel.variable}" not found in this dataset.`)
    }
    const timeExtent = info.timeStart && info.timeEnd
      ? `${info.timeStart} – ${info.timeEnd}`
      : info.timeEnd
    return {
      fields: [],
      spatial: true,
      queryable: false,
      rasterResult: true,
      note:
        'Gridded dataset — imports one time slice of this variable as real data values ' +
        '(terra SpatRaster). Extra dimensions (e.g. depth) take their first index.',
      imageExport: {
        serviceUrl: `${ctx.baseUrl}/griddap/${sel.dataset}`,
        name: `${sel.dataset}/${sel.variable}`,
        pixelType: PIXEL_TYPES[(info.dtypes.get(sel.variable) ?? '').toLowerCase()],
        bandCount: 1,
        extent4326: info.extent4326,
        // One griddap request regardless of size — stride does the scaling.
        chunkPx: 1_000_000,
        time: info.timeEnd ? { default: info.timeEnd, extent: timeExtent } : undefined,
      },
      downloadCode: (varName, opts) => buildGridCode(ctx.baseUrl, sel.dataset, sel.variable, varName, opts),
    }
  },

  opsFor(_kind: FieldKind): FilterOp[] {
    return [] // grids — no attribute queries
  },

  async preview() {
    return [] // no tabular preview for grids
  },

  buildCode() {
    return '# Gridded variables import via the export panel above.'
  },
}
