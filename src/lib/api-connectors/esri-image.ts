// Esri Image Services provider — ArcGIS ImageServer raster imagery (e.g. USGS
// 3DEP elevation, USDA NAIP aerial photography). One service = one raster; the
// import is a bbox'd, chunked /exportImage handled by ourgeo_read_esri_image()
// (r/lib/util-arcgis.R) and lands as a terra SpatRaster.

import { useSpatialStore } from '@/store/spatial'
import type { FieldKind, FilterOp } from './query-model'
import { getJson } from './esri'
import type { ApiProvider, DownloadCodeOptions, ProviderContext, Selection } from './types'

// Matches the soft cap in ourgeo_read_esri_image() — servers often 504 on
// their own advertised maxima, so exports are chunked at this size.
export const IMAGE_CHUNK_PX = 2048

/** Web-Mercator [x, y] metres → 4326 [lon, lat]. */
function mercatorToLonLat(x: number, y: number): [number, number] {
  const R = 6378137
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)]
}

/** R code importing an ImageServer as a SpatRaster via ourgeo_read_esri_image(). */
function buildImageServerCode(
  serviceUrl: string,
  name: string,
  varName: string,
  opts?: DownloadCodeOptions
): string {
  // Extent: the browser panel's choice; falling back to the Spatial Editor's
  // current view ("give me what I'm looking at"), else the full service extent.
  const bbox = opts?.bbox !== undefined ? opts.bbox : useSpatialStore.getState().viewBbox
  const size = opts?.size ?? 2048
  const bboxLines = bbox
    ? [
        `  bbox        = c(${bbox.map((v) => parseFloat(v.toFixed(6))).join(', ')}),  # EPSG:4326 — edit to your AOI`,
        '  bbox_sr     = 4326,',
      ]
    : ['  bbox        = NULL,  # NULL = full service extent; pass c(xmin, ymin, xmax, ymax) for an AOI']
  const tail = [`  size        = ${size}L  # pixels on the long side`]
  if (opts?.maxTiles && opts.maxTiles > 64) {
    tail[0] += ','
    tail.push(`  max_tiles   = ${opts.maxTiles}L  # this export spans many exportImage requests`)
  }
  return [
    'library(terra)',
    '',
    `# Esri ImageServer raster export — ${name}`,
    `# Tiles /exportImage requests to the server's size caps and mosaics them.`,
    `${varName} <- ourgeo_read_esri_image(`,
    `  service_url = "${serviceUrl}",`,
    ...bboxLines,
    ...tail,
    ')',
  ].join('\n')
}

const serviceUrl = (ctx: ProviderContext, sel: Selection) => `${ctx.baseUrl}/${sel.service}`

export const esriImageProvider: ApiProvider = {
  id: 'esri-image',
  label: 'Esri Image Services',
  category: 'Raster / Image Layers',
  description: 'ArcGIS ImageServer raster imagery (elevation, aerial photography). Exports your chosen extent + resolution as a terra SpatRaster.',
  docsUrl: 'https://developers.arcgis.com/rest/services-reference/enterprise/image-service/',
  builtinServers: [
    { id: 'usgs3dep', label: 'USGS National Map — Elevation (3DEP)', baseUrl: 'https://elevation.nationalmap.gov/arcgis/rest/services' },
    { id: 'usdanaip', label: 'USDA NAIP Aerial Imagery', baseUrl: 'https://gis.apfo.usda.gov/arcgis/rest/services' },
  ],
  cascade: [{ key: 'service', label: 'Image service', placeholder: 'Select an image service' }],

  async listLevel(_levelKey, _sel, ctx) {
    const root = await getJson(`${ctx.baseUrl}?f=json`) as { services?: { name: string; type: string }[]; folders?: string[] }
    const services = [...(root.services ?? [])]
    for (const folder of root.folders ?? []) {
      try {
        const fr = await getJson(`${ctx.baseUrl}/${folder}?f=json`) as { services?: { name: string; type: string }[] }
        services.push(...(fr.services ?? []))
      } catch { /* skip unreadable folder */ }
    }
    const images = services.filter((s) => s.type === 'ImageServer')
    if (images.length === 0) throw new Error('This server publishes no ImageServer services.')
    return images.map((s) => ({ value: `${s.name}/${s.type}`, label: s.name }))
  },

  async getMetadata(sel, ctx) {
    const svcUrl = serviceUrl(ctx, sel)
    const info = await getJson(`${svcUrl}?f=json`) as {
      name?: string
      pixelType?: string
      bandCount?: number
      fullExtent?: { xmin: number; ymin: number; xmax: number; ymax: number
                     spatialReference?: { wkid?: number; latestWkid?: number } }
      extent?: { xmin: number; ymin: number; xmax: number; ymax: number
                 spatialReference?: { wkid?: number; latestWkid?: number } }
    }
    const name = info.name ?? sel.service.replace(/\/ImageServer$/, '')
    const bands = info.bandCount ?? 1

    // Full extent → 4326 when the SR is geographic or Web Mercator (the two
    // overwhelmingly common cases); anything else omits the estimate basis.
    let extent4326: [number, number, number, number] | undefined
    const fe = info.fullExtent ?? info.extent
    if (fe) {
      const wkid = fe.spatialReference?.latestWkid ?? fe.spatialReference?.wkid
      if (wkid === 4326) {
        extent4326 = [fe.xmin, fe.ymin, fe.xmax, fe.ymax]
      } else if (wkid === 3857 || wkid === 102100) {
        const [w, s] = mercatorToLonLat(fe.xmin, fe.ymin)
        const [e, n] = mercatorToLonLat(fe.xmax, fe.ymax)
        extent4326 = [w, s, e, n]
      }
    }

    return {
      fields: [],
      spatial: true,
      queryable: false,
      rasterResult: true,
      note:
        `Raster imagery service (${bands} band${bands === 1 ? '' : 's'}` +
        `${info.pixelType ? `, ${info.pixelType}` : ''}) — imports as a terra SpatRaster ` +
        `via tiled exportImage requests.`,
      imageExport: {
        serviceUrl: svcUrl,
        name,
        pixelType: info.pixelType,
        bandCount: bands,
        extent4326,
        chunkPx: IMAGE_CHUNK_PX,
      },
      downloadCode: (varName, opts) => buildImageServerCode(svcUrl, name, varName, opts),
    }
  },

  opsFor(_kind: FieldKind): FilterOp[] {
    return [] // raster imagery — no attribute queries
  },

  async preview() {
    return [] // no tabular preview for imagery
  },

  buildCode() {
    return '# Imagery services import via the export panel above.'
  },
}
