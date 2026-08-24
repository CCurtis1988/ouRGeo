// OGC WCS provider — Web Coverage Service, the OGC standard for downloading
// real raster data values (elevation, bathymetry, model grids). One coverage =
// one raster; the import is a bbox'd GetCoverage handled by ourgeo_read_wcs()
// (r/lib/util-wcs.R) and lands as a terra SpatRaster.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { useSpatialStore } from '@/store/spatial'
import type { FieldKind, FilterOp } from './query-model'
import type { ApiProvider, DownloadCodeOptions } from './types'
import { childText, descText, elems, parseCorner, parseXml, withParams } from './xml'

interface WcsCoverage {
  id: string
  title?: string
  /** From ows:WGS84BoundingBox — 4326 [w, s, e, n]. */
  extent4326?: [number, number, number, number]
}

// GetCapabilities parsed once per server; getMetadata reads from here so
// selecting a coverage costs no extra round trip.
const capsCache = new Map<string, Map<string, WcsCoverage>>()

async function fetchCoverages(baseUrl: string): Promise<Map<string, WcsCoverage>> {
  const cached = capsCache.get(baseUrl)
  if (cached) return cached
  const url = withParams(baseUrl, { service: 'WCS', request: 'GetCapabilities' })
  const res = await proxyFetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from WCS server`)
  const doc = parseXml(text, 'WCS GetCapabilities')

  const coverages = new Map<string, WcsCoverage>()
  for (const cs of elems(doc, 'CoverageSummary')) {
    const id = childText(cs, 'CoverageId') ?? childText(cs, 'Identifier') // 2.0.1 / 1.1.x
    if (!id) continue
    let extent4326: [number, number, number, number] | undefined
    const bb = elems(cs, 'WGS84BoundingBox')[0]
    if (bb) {
      const lo = parseCorner(descText(bb, 'LowerCorner'))
      const hi = parseCorner(descText(bb, 'UpperCorner'))
      if (lo && hi) extent4326 = [lo[0], lo[1], hi[0], hi[1]]
    }
    coverages.set(id, { id, title: childText(cs, 'Title'), extent4326 })
  }
  if (coverages.size === 0) throw new Error('This WCS server offers no coverages (or is not a WCS endpoint).')
  capsCache.set(baseUrl, coverages)
  return coverages
}

/** R code importing a WCS coverage as a SpatRaster via ourgeo_read_wcs(). */
function buildWcsCode(baseUrl: string, coverageId: string, varName: string, opts?: DownloadCodeOptions): string {
  const bbox = opts?.bbox !== undefined ? opts.bbox : useSpatialStore.getState().viewBbox
  const size = opts?.size ?? 2048
  const bboxLines = bbox
    ? [
        `  bbox        = c(${bbox.map((v) => parseFloat(v.toFixed(6))).join(', ')}),  # EPSG:4326 — edit to your AOI`,
        '  bbox_sr     = 4326,',
      ]
    : ['  bbox        = NULL,  # NULL = full coverage extent; pass c(xmin, ymin, xmax, ymax) for an AOI']
  return [
    'library(terra)',
    '',
    `# OGC WCS coverage export — ${coverageId}`,
    '# Requests a GeoTIFF subset scaled to the chosen resolution (GetCoverage 2.0.1).',
    `${varName} <- ourgeo_read_wcs(`,
    `  base_url    = "${baseUrl}",`,
    `  coverage_id = "${coverageId}",`,
    ...bboxLines,
    `  size        = ${size}L  # pixels on the long side`,
    ')',
  ].join('\n')
}

export const wcsProvider: ApiProvider = {
  id: 'wcs',
  label: 'OGC WCS',
  category: 'Raster / Image Layers',
  description: 'OGC Web Coverage Service — downloads real raster data values (elevation, bathymetry, model grids) as a terra SpatRaster.',
  builtinServers: [
    { id: 'emodnet', label: 'EMODnet Bathymetry', baseUrl: 'https://ows.emodnet-bathymetry.eu/wcs' },
    { id: 'dlr-elevation', label: 'DLR EOC Elevation (SRTM X-SAR)', baseUrl: 'https://geoservice.dlr.de/eoc/elevation/wcs' },
  ],
  cascade: [{ key: 'coverage', label: 'Coverage', placeholder: 'Select a coverage' }],

  async listLevel(_levelKey, _sel, ctx) {
    const coverages = await fetchCoverages(ctx.baseUrl)
    return Array.from(coverages.values()).map((c) => ({ value: c.id, label: c.title ?? c.id }))
  },

  async getMetadata(sel, ctx) {
    const coverages = await fetchCoverages(ctx.baseUrl)
    const cov = coverages.get(sel.coverage)
    if (!cov) throw new Error(`Coverage "${sel.coverage}" not found in the server's capabilities.`)
    return {
      fields: [],
      spatial: true,
      queryable: false,
      rasterResult: true,
      note:
        'WCS coverage — imports real data values (not a rendered picture) as a terra ' +
        'SpatRaster via a single scaled GetCoverage request.',
      imageExport: {
        serviceUrl: ctx.baseUrl,
        name: cov.title ?? cov.id,
        pixelType: undefined, // unknown until read — estimate assumes float32
        bandCount: 1,
        extent4326: cov.extent4326,
        // One GetCoverage request regardless of size — the server scales.
        chunkPx: 1_000_000,
      },
      downloadCode: (varName, opts) => buildWcsCode(ctx.baseUrl, cov.id, varName, opts),
    }
  },

  opsFor(_kind: FieldKind): FilterOp[] {
    return [] // coverages — no attribute queries
  },

  async preview() {
    return [] // no tabular preview for coverages
  },

  buildCode() {
    return '# Coverages import via the export panel above.'
  },
}
