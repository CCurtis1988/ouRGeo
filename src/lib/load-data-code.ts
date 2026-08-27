// The R that an import produces.
//
// Lifted out of LoadDataDialog: the dialog owns the form, this owns the code
// generation — format detection, per-column casts, and the read call itself.
// Extracted so the AI assistant's `data.load` action emits byte-identical R to
// the dialog rather than growing a second importer that drifts from it.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataFormat =
  | 'csv' | 'tsv' | 'txt'
  | 'excel' | 'ods'
  | 'json_tabular'
  | 'parquet' | 'feather'
  | 'sas' | 'spss' | 'stata'
  | 'geojson' | 'shapefile' | 'kml'
  | 'spatial'
  | 'raster'

export const FORMAT_LABELS: Record<DataFormat, string> = {
  csv: 'CSV', tsv: 'TSV', txt: 'Text', excel: 'Excel', ods: 'ODS',
  json_tabular: 'JSON', parquet: 'Parquet', feather: 'Feather',
  sas: 'SAS', spss: 'SPSS', stata: 'Stata',
  geojson: 'GeoJSON', shapefile: 'Shapefile', kml: 'KML',
  spatial: 'Spatial',
  raster: 'Raster (GeoTIFF, …)',
}

export const COLUMN_TYPES = ['character', 'numeric', 'integer', 'logical', 'factor', 'Date'] as const
export type ColumnType = typeof COLUMN_TYPES[number]

export interface LoadColumnDef {
  name: string
  type: ColumnType
  originalType: ColumnType
  formula: string
  include: boolean
  isGeometry: boolean
}

export interface NewColumnDef {
  id: string
  name: string
  type: ColumnType
  formula: string
}

export function detectFormat(filePath: string): DataFormat {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'csv': return 'csv'
    case 'tsv': case 'tab': return 'tsv'
    case 'txt': return 'txt'
    case 'xlsx': case 'xls': return 'excel'
    case 'ods': return 'ods'
    case 'geojson': return 'geojson'
    case 'json': return 'json_tabular'
    case 'parquet': return 'parquet'
    case 'feather': return 'feather'
    case 'sas7bdat': return 'sas'
    case 'sav': return 'spss'
    case 'dta': return 'stata'
    case 'shp': return 'shapefile'
    case 'kml': case 'kmz': return 'kml'
    case 'gpkg': case 'gml': case 'dxf': case 'gpx': case 'fgb': return 'spatial'
    case 'tif': case 'tiff': case 'img': case 'vrt': case 'asc':
    case 'nc': case 'jp2': case 'grd': case 'hgt': case 'dem':
      return 'raster'
    default: return 'csv'
  }
}

export const isTabularFormat = (f: DataFormat) => ['csv', 'tsv', 'txt'].includes(f)
export const isExcelFormat = (f: DataFormat) => f === 'excel' || f === 'ods'
export const isSpatialFormat = (f: DataFormat) =>
  f === 'geojson' || f === 'shapefile' || f === 'kml' || f === 'spatial'
export const isRasterFormat = (f: DataFormat) => f === 'raster'
export const isPlainFormat = (f: DataFormat) =>
  ['json_tabular', 'parquet', 'feather', 'sas', 'spss', 'stata'].includes(f)

export function mapRTypeToColumn(rType: string): ColumnType {
  if (rType === 'sf') return 'character'  // geometry — will be flagged as isGeometry
  if (rType === 'numeric') return 'numeric'
  if (rType === 'integer') return 'integer'
  if (rType === 'logical') return 'logical'
  if (rType === 'factor') return 'factor'
  if (rType === 'Date') return 'Date'
  return 'character'
}

export function typeCastR(type: ColumnType, expr: string): string {
  switch (type) {
    case 'numeric': return `as.numeric(${expr})`
    case 'integer': return `as.integer(${expr})`
    case 'logical': return `as.logical(${expr})`
    case 'factor': return `as.factor(${expr})`
    case 'Date': return `as.Date(${expr})`
    case 'character': return `as.character(${expr})`
  }
}

export function quoteCol(name: string): string {
  if (/^[a-zA-Z.][a-zA-Z0-9._]*$/.test(name)) return name
  return '`' + name + '`'
}

export function buildLoadCode(
  varName: string,
  filePath: string,
  format: DataFormat,
  opts: {
    delimiter: string
    hasHeader: boolean
    skipRows: number
    encoding: string
    naStrings: string
    sheet: string
    crsOverride: string
    layerName: string
  },
  columns: LoadColumnDef[],
  newColumns: NewColumnDef[]
): string {
  const lines: string[] = []
  const path = filePath.replace(/\\/g, '/')
  const { delimiter, hasHeader, skipRows, encoding, naStrings, sheet, crsOverride, layerName } = opts
  const naArr = naStrings.split(',').map(s => `"${s.trim()}"`).join(', ')
  const hdr = hasHeader ? 'TRUE' : 'FALSE'

  switch (format) {
    case 'csv':
      lines.push(`${varName} <- read.csv("${path}", header = ${hdr}, skip = ${skipRows}, sep = "${delimiter}", encoding = "${encoding}", na.strings = c(${naArr}), stringsAsFactors = FALSE)`)
      break
    case 'tsv':
      lines.push(`${varName} <- read.delim("${path}", header = ${hdr}, skip = ${skipRows}, encoding = "${encoding}", na.strings = c(${naArr}), stringsAsFactors = FALSE)`)
      break
    case 'txt':
      lines.push(`${varName} <- read.delim("${path}", header = ${hdr}, skip = ${skipRows}, sep = "${delimiter}", encoding = "${encoding}", na.strings = c(${naArr}), stringsAsFactors = FALSE)`)
      break
    case 'excel':
      lines.push(`${varName} <- readxl::read_excel("${path}"${sheet ? `, sheet = "${sheet}"` : ''}, skip = ${skipRows}, col_names = ${hdr})`)
      break
    case 'ods':
      lines.push(`${varName} <- readODS::read_ods("${path}"${sheet ? `, sheet = "${sheet}"` : ''}, skip = ${skipRows}, col_names = ${hdr})`)
      break
    case 'json_tabular':
      lines.push(`${varName} <- as.data.frame(jsonlite::fromJSON("${path}"))`)
      break
    case 'parquet':
      lines.push(`${varName} <- arrow::read_parquet("${path}")`)
      break
    case 'feather':
      lines.push(`${varName} <- arrow::read_feather("${path}")`)
      break
    case 'sas':
      lines.push(`${varName} <- haven::read_sas("${path}")`)
      break
    case 'spss':
      lines.push(`${varName} <- haven::read_spss("${path}")`)
      break
    case 'stata':
      lines.push(`${varName} <- haven::read_stata("${path}")`)
      break
    case 'geojson':
    case 'shapefile':
    case 'kml':
    case 'spatial': {
      const layerArg = layerName.trim() ? `, layer = "${layerName.trim()}"` : ''
      lines.push(`${varName} <- sf::st_read("${path}"${layerArg}, quiet = TRUE)`)
      if (crsOverride.trim()) lines.push(`${varName} <- sf::st_transform(${varName}, ${crsOverride.trim()})`)
      break
    }
    case 'raster': {
      // terra reads lazily via GDAL — subdatasets (NetCDF/HDF) select by name.
      const layerArg = layerName.trim() ? `, subds = "${layerName.trim()}"` : ''
      lines.push(`${varName} <- terra::rast("${path}"${layerArg})`)
      if (crsOverride.trim()) {
        const crs = crsOverride.trim()
        const crsStr = /^\d+$/.test(crs) ? `EPSG:${crs}` : crs
        lines.push(`${varName} <- terra::project(${varName}, "${crsStr}")`)
      }
      break
    }
  }

  // Exclude columns
  const excluded = columns.filter(c => !c.include).map(c => `"${c.name}"`)
  if (excluded.length) {
    lines.push(`${varName} <- ${varName}[, !names(${varName}) %in% c(${excluded.join(', ')}), drop = FALSE]`)
  }

  // Type coercions (only when changed from original, skip geometry)
  for (const col of columns.filter(c => c.include && !c.isGeometry && c.type !== c.originalType)) {
    const ref = `${varName}$${quoteCol(col.name)}`
    lines.push(`${varName}$${quoteCol(col.name)} <- ${typeCastR(col.type, ref)}`)
  }

  // Formulas on existing columns
  for (const col of columns.filter(c => c.include && c.formula.trim())) {
    lines.push(`${varName}$${quoteCol(col.name)} <- ${col.formula.trim()}`)
  }

  // New user-added columns
  for (const col of newColumns) {
    if (!col.name.trim()) continue
    if (col.formula.trim()) {
      lines.push(`${varName}$${col.name} <- ${col.formula.trim()}`)
    } else {
      lines.push(`${varName}$${col.name} <- rep(${typeCastR(col.type, 'NA')}, nrow(${varName}))`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// FormulaInput
// ---------------------------------------------------------------------------

