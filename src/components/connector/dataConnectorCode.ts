// ── Data connector: code generation & helpers ────────────────────────────────
import type { DataSource, DynamicResult, KaggleFile } from './types'
import type { CkanQuery, CkanResource } from '@/lib/ckan-client'
import { queryNeedsSql, buildFiltersJson, buildSelectSql } from '@/lib/ckan-client'

// ── Kaggle categories (search-term based) ─────────────────────────────────
export const KAGGLE_CATEGORIES = [
  { id: 'all',     label: 'All',             searchTerm: '' },
  { id: 'ml',      label: 'Machine Learning', searchTerm: 'machine learning' },
  { id: 'nlp',     label: 'NLP',             searchTerm: 'natural language processing' },
  { id: 'cv',      label: 'Computer Vision', searchTerm: 'computer vision' },
  { id: 'health',  label: 'Healthcare',      searchTerm: 'healthcare medicine' },
  { id: 'finance', label: 'Finance',         searchTerm: 'finance economics' },
  { id: 'earth',   label: 'Earth & Nature',  searchTerm: 'environment climate earth' },
  { id: 'sports',  label: 'Sports',          searchTerm: 'sports' },
  { id: 'social',  label: 'Social Science',  searchTerm: 'social science' },
  { id: 'viz',     label: 'Visualization',   searchTerm: 'data visualization' },
  { id: 'edu',     label: 'Education',       searchTerm: 'education' },
  { id: 'gov',     label: 'Government',      searchTerm: 'government policy' },
]

// ── Helpers ───────────────────────────────────────────────────────────────
export const LOADABLE_EXTS = new Set(['csv', 'tsv', 'json', 'parquet', 'xlsx', 'xls', 'feather'])

export function isLoadableExtension(name: string): boolean {
  return LOADABLE_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

export function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Convert any string to a valid R identifier, preserving the source name. */
export function toRVarName(str: string): string {
  let name = str.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '')
  if (!name) name = 'data'
  if (/^[0-9]/.test(name)) name = `data_${name}`
  return name
}

export function fileVarName(filename: string, prefix: string): string {
  const stem = toRVarName(filename)
  return prefix ? `${prefix}_${stem}` : stem
}

export function readerForFile(filename: string, varName: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const path = `file.path(tmp_dir, "${filename}")`
  switch (ext) {
    case 'csv':     return `${varName} <- read.csv(${path})`
    case 'tsv':     return `${varName} <- read.delim(${path})`
    case 'json':    return `${varName} <- jsonlite::fromJSON(${path}, simplifyVector = TRUE)`
    case 'parquet': return `${varName} <- arrow::read_parquet(${path})`
    case 'xlsx':
    case 'xls':     return `${varName} <- readxl::read_excel(${path})`
    case 'feather': return `${varName} <- arrow::read_feather(${path})`
    default:        return `# ${varName}: cannot auto-load "${filename}" (unsupported format)`
  }
}

// ── Kaggle file-list normaliser (pure) ───────────────────────────────────
export function extractKaggleFiles(data: unknown): KaggleFile[] {
  type RawFile = { name?: string; fileName?: string; totalBytes?: number; fileSize?: number; size?: number }
  const toFile = (f: RawFile): KaggleFile | null => {
    const name = f.name ?? f.fileName
    if (!name || typeof name !== 'string') return null
    return { name, totalBytes: f.totalBytes ?? f.fileSize ?? f.size ?? 0 }
  }
  if (Array.isArray(data)) return (data as RawFile[]).map(toFile).filter((f): f is KaggleFile => f !== null)
  const obj = data as Record<string, unknown>
  for (const key of ['datasetFiles', 'files', 'dataFiles', 'items']) {
    if (Array.isArray(obj[key])) return (obj[key] as RawFile[]).map(toFile).filter((f): f is KaggleFile => f !== null)
  }
  return []
}

// ── Kaggle fallback code (download full archive + list.files) ─────────────
export function buildKaggleFallbackCode(ref: string, keys: Record<string, string>): string {
  const slug = (ref.split('/')[1] ?? ref).replace(/-/g, '_')
  const username = keys.kaggle_username || 'your_username'
  const apiKey = keys.kaggle || 'your_api_key'
  return [
    'library(httr2)',
    '',
    `# Download Kaggle dataset: ${ref}`,
    `tmp_zip <- tempfile(fileext = ".zip")`,
    `tmp_dir <- file.path(tempdir(), "kaggle_${slug}")`,
    `dir.create(tmp_dir, recursive = TRUE, showWarnings = FALSE)`,
    '',
    `request("https://www.kaggle.com/api/v1/datasets/download/${ref}") |>`,
    `  req_auth_basic("${username}", "${apiKey}") |>`,
    `  req_perform() |>`,
    `  resp_body_raw() |>`,
    `  writeBin(tmp_zip)`,
    '',
    `unzip(tmp_zip, exdir = tmp_dir)`,
    '',
    '# Inspect available files:',
    'list.files(tmp_dir, recursive = TRUE)',
    '',
    '# Then load a specific file, e.g.:',
    '# mydata <- read.csv(file.path(tmp_dir, "data.csv"))',
  ].join('\n')
}

// ── Kaggle code builder (pure, outside component) ─────────────────────────
export function buildKaggleCode(
  ref: string,
  files: Set<string>,
  prefix: string,
  keys: Record<string, string>,
  zipPath?: string | null
): string {
  if (files.size === 0) return '# Select at least one file to load'
  const slug = (ref.split('/')[1] ?? ref).replace(/-/g, '_')
  const username = keys.kaggle_username || 'your_username'
  const apiKey = keys.kaggle || 'your_api_key'
  // Reuse cached ZIP if available so we don't re-download
  const safeRef = ref.replace(/[^a-zA-Z0-9_]/g, '_')
  const zipExpr = zipPath
    ? `"${zipPath}"`
    : `file.path(tempdir(), ".kaggle_${safeRef}.zip")`

  const lines: string[] = [
    'library(httr2)',
    '',
    `# Download Kaggle dataset: ${ref}`,
    `tmp_zip <- ${zipExpr}`,
    `tmp_dir <- file.path(tempdir(), "kaggle_${slug}")`,
    `dir.create(tmp_dir, recursive = TRUE, showWarnings = FALSE)`,
    '',
    'if (!file.exists(tmp_zip) || file.info(tmp_zip)$size == 0) {',
    `  request("https://www.kaggle.com/api/v1/datasets/download/${ref}") |>`,
    `    req_auth_basic("${username}", "${apiKey}") |>`,
    `    req_perform() |>`,
    `    resp_body_raw() |>`,
    `    writeBin(tmp_zip)`,
    '}',
    '',
    `unzip(tmp_zip, exdir = tmp_dir)`,
    '',
    '# Load selected files',
  ]

  for (const fname of files) {
    lines.push(readerForFile(fname, fileVarName(fname, prefix)))
  }

  return lines.join('\n')
}

// ── Spatial package check ──────────────────────────────────────────────────
export const SPATIAL_PACKAGES = new Set(['osmdata', 'tigris', 'esri2sf', 'sf'])
export function sourceIsSpatial(source: DataSource): boolean {
  return SPATIAL_PACKAGES.has(source.rPackage)
}

// ── Non-Kaggle dynamic code builder ──────────────────────────────────────
export function buildDynamicCode(
  source: DataSource,
  result: DynamicResult,
  extraParams: Record<string, string>,
  varName: string,
  keys: Record<string, string>
): string {
  if (source.dynamicType === 'socrata') {
    const url = result.url ?? ''
    const lines = ['library(RSocrata)']
    const tokenLine = keys.socrata ? `,\n  app_token = "${keys.socrata}"` : ''
    lines.push(`${varName} <- read.socrata(\n  "${url}"${tokenLine}\n)`)
    return lines.join('\n')
  }

  if (source.dynamicType === 'fred') {
    const lines = ['library(fredr)']
    if (keys.fred) lines.push(`fredr_set_key("${keys.fred}")`)
    const startArg = extraParams.startDate ? `,\n  observation_start = "${extraParams.startDate}"` : ''
    const endArg = extraParams.endDate ? `,\n  observation_end = "${extraParams.endDate}"` : ''
    lines.push(`${varName} <- fredr(\n  series_id = "${result.id}"${startArg}${endArg}\n)`)
    return lines.join('\n')
  }

  if (source.dynamicType === 'ckan') {
    const url = result.url ?? ''
    if (!url) return `# No downloadable resource URL found for this dataset`
    return [
      'library(httr2)',
      `response <- request("${url}") |>`,
      '  req_perform()',
      `${varName} <- resp_body_string(response) |>`,
      '  (\\(x) read.csv(text = x))()',
    ].join('\n')
  }

  return ''
}

// ── Manual code builder ────────────────────────────────────────────────────
export interface QueryParam { id: string; key: string; value: string }

export function buildManualCode(
  url: string,
  authHeader: string,
  queryParams: QueryParam[],
  format: string,
  limit: number,
  varName: string
): string {
  if (!url) return '# Enter a URL to generate code'

  // GeoTIFF / COG: no HTTP fetch in R at all — GDAL's /vsicurl/ streams byte
  // ranges on demand, which is the whole point of cloud-optimized rasters.
  if (format === 'geotiff') {
    const src = /^https?:\/\//i.test(url) ? `/vsicurl/${url}` : url
    return [
      `# Cloud-optimized GeoTIFF: terra reads lazily over HTTP range requests`,
      `${varName} <- terra::rast("${src}")`,
    ].join('\n')
  }

  const lines = ['library(httr2)']
  const pipes: string[] = [`response <- request("${url}")`]

  if (authHeader.includes(':')) {
    const colonIdx = authHeader.indexOf(':')
    const headerName = authHeader.slice(0, colonIdx).trim()
    const headerValue = authHeader.slice(colonIdx + 1).trim()
    pipes.push(`  req_headers("${headerName}" = "${headerValue}")`)
  } else if (authHeader) {
    pipes.push(`  req_headers("Authorization" = "Bearer ${authHeader}")`)
  }

  const qParts = queryParams.filter(p => p.key).map(p => `${p.key} = "${p.value}"`)
  if (limit) qParts.push(`limit = ${limit}`)
  if (qParts.length > 0) pipes.push(`  req_url_query(${qParts.join(', ')})`)

  pipes.push('  req_perform()')
  lines.push(pipes.join(' |>\n'))

  if (format === 'csv') {
    lines.push(`${varName} <- resp_body_string(response) |>\n  (\\(x) read.csv(text = x))()`)
  } else if (format === 'geojson') {
    lines.push(`${varName} <- sf::st_read(resp_body_string(response))`)
  } else {
    lines.push(`${varName} <- resp_body_json(response, simplifyVector = TRUE) |>\n  as.data.frame()`)
  }
  return lines.join('\n')
}

// ── CKAN datastore code builder ─────────────────────────────────────────────
// R raw strings r"(...)" carry JSON/SQL verbatim — no quote-escaping headaches.
const rRaw = (s: string): string => `r"(${s})"`

/** Generate reproducible R that pulls a CKAN datastore resource into a data.frame.
 *  Uses datastore_search (paginated) for equality/IN/full-text, or
 *  datastore_search_sql for ranges/comparisons/contains. */
export function buildCkanDatastoreCode(
  baseUrl: string, resourceId: string, query: CkanQuery, varName: string, portalLabel: string,
): string {
  const base = baseUrl.replace(/\/+$/, '')

  if (queryNeedsSql(query)) {
    const sql = buildSelectSql(resourceId, query)
    return [
      'library(httr2)',
      '',
      `# CKAN datastore SQL query — ${portalLabel}`,
      `.sql <- ${rRaw(sql)}`,
      `.resp <- request("${base}/api/3/action/datastore_search_sql") |>`,
      '  req_url_query(sql = .sql) |>',
      '  req_perform() |>',
      '  resp_body_json(simplifyVector = TRUE)',
      `${varName} <- as.data.frame(.resp$result$records, stringsAsFactors = FALSE)`,
    ].join('\n')
  }

  const filters = buildFiltersJson(query)
  const q = query.q.trim()
  const queryArgs = [
    '      resource_id = .resource_id',
    '      limit = .page_size',
    '      offset = .offset',
    filters ? '      filters = .filters' : null,
    q ? '      q = .q' : null,
  ].filter(Boolean).join(',\n')

  return [
    'library(httr2)',
    '',
    `# CKAN datastore query — ${portalLabel}`,
    `.base <- "${base}/api/3/action/datastore_search"`,
    `.resource_id <- "${resourceId}"`,
    filters ? `.filters <- ${rRaw(filters)}` : null,
    q ? `.q <- ${rRaw(q)}` : null,
    '.page_size <- 1000L',
    `.max_rows <- ${query.limit}L`,
    '',
    '.pages <- list()',
    '.offset <- 0L',
    'repeat {',
    '  .resp <- request(.base) |>',
    '    req_url_query(',
    queryArgs,
    '    ) |>',
    '    req_perform() |>',
    '    resp_body_json(simplifyVector = TRUE)',
    '  .recs <- .resp$result$records',
    '  if (is.null(.recs) || NROW(.recs) == 0) break',
    '  .pages[[length(.pages) + 1L]] <- as.data.frame(.recs, stringsAsFactors = FALSE)',
    '  .offset <- .offset + NROW(.recs)',
    '  if (.offset >= min(.max_rows, .resp$result$total)) break',
    '}',
    `${varName} <- if (length(.pages)) do.call(rbind, .pages) else data.frame()`,
    `if (nrow(${varName}) > .max_rows) ${varName} <- utils::head(${varName}, .max_rows)`,
  ].filter((l) => l !== null).join('\n')
}

/** Fallback for non-datastore resources: download the file and read it by format. */
export function buildCkanResourceDownloadCode(
  resource: CkanResource, varName: string,
): string {
  const url = resource.url
  if (!url) return '# This resource has no downloadable file URL.'
  const ext = (url.split('?')[0].split('.').pop() ?? '').toLowerCase()
  const fmt = resource.format.toLowerCase()
  const is = (...keys: string[]) => keys.includes(ext) || keys.includes(fmt)

  if (is('csv')) return `${varName} <- read.csv("${url}")`
  if (is('tsv', 'tab')) return `${varName} <- read.delim("${url}")`
  if (is('json')) return `${varName} <- jsonlite::fromJSON("${url}", simplifyVector = TRUE)`
  if (is('geojson', 'kml', 'gpkg', 'gml')) return `${varName} <- sf::st_read("${url}")`
  if (is('zip', 'shp', 'shapefile')) {
    return [
      'library(httr2)',
      `.tmp_zip <- tempfile(fileext = ".zip")`,
      `.tmp_dir <- tempfile()`,
      `dir.create(.tmp_dir)`,
      `request("${url}") |> req_perform() |> resp_body_raw() |> writeBin(.tmp_zip)`,
      `unzip(.tmp_zip, exdir = .tmp_dir)`,
      `.shp <- list.files(.tmp_dir, pattern = "\\\\.shp$", recursive = TRUE, full.names = TRUE)[1]`,
      `${varName} <- sf::st_read(.shp)`,
    ].join('\n')
  }
  if (is('xlsx', 'xls')) {
    return [
      `.tmp <- tempfile(fileext = ".${ext || 'xlsx'}")`,
      `download.file("${url}", .tmp, mode = "wb")`,
      `${varName} <- readxl::read_excel(.tmp)`,
    ].join('\n')
  }
  if (is('parquet')) {
    return [
      `.tmp <- tempfile(fileext = ".parquet")`,
      `download.file("${url}", .tmp, mode = "wb")`,
      `${varName} <- arrow::read_parquet(.tmp)`,
    ].join('\n')
  }
  return `# Unsupported resource format "${resource.format}". Download manually:\n# browseURL("${url}")`
}

