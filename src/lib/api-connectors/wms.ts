// OGC WMS provider — Web Map Service, the OGC standard for *rendered* map
// imagery (satellite composites, hillshades, orthophotos). GetMap returns
// styled RGB pictures, not data values; ourgeo_read_wms() (r/lib/util-wms.R)
// chunks + mosaics the export into a georeferenced terra SpatRaster.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { useSpatialStore } from '@/store/spatial'
import type { FieldKind, FilterOp } from './query-model'
import type { ApiProvider, DownloadCodeOptions } from './types'
import { childText, elems, parseXml, withParams } from './xml'

// Matches the chunk cap in ourgeo_read_wms() — many servers cap GetMap around
// 2048–4096px, and smaller chunks retry cheaply.
export const WMS_CHUNK_PX = 2048

interface WmsLayer {
  name: string
  title?: string
  /** From EX_GeographicBoundingBox — 4326 [w, s, e, n]. */
  extent4326?: [number, number, number, number]
  /** TIME dimension, when the layer is time-enabled. */
  time?: { default?: string; extent?: string }
}

interface WmsCaps {
  layers: Map<string, WmsLayer>
  /** GetMap formats advertised by the server. */
  formats: string[]
}

const capsCache = new Map<string, WmsCaps>()

/** Compact a WMS time extent (possibly thousands of values/ranges) for display. */
function compactTimeExtent(extent: string | undefined): string | undefined {
  if (!extent) return undefined
  const tokens = extent.split(',').map((t) => t.trim()).filter(Boolean)
  if (tokens.length === 0) return undefined
  const first = tokens[0].split('/')[0]
  const lastToken = tokens[tokens.length - 1].split('/')
  const last = lastToken[1] && lastToken[1] !== first ? lastToken[1] : lastToken[0]
  return first === last ? first : `${first} – ${last}`
}

async function fetchCaps(baseUrl: string): Promise<WmsCaps> {
  const cached = capsCache.get(baseUrl)
  if (cached) return cached
  const url = withParams(baseUrl, { service: 'WMS', request: 'GetCapabilities', version: '1.3.0' })
  const res = await proxyFetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} from WMS server`)
  const doc = parseXml(text, 'WMS GetCapabilities')

  const layers = new Map<string, WmsLayer>()
  for (const el of elems(doc, 'Layer')) {
    const name = childText(el, 'Name')
    if (!name || layers.has(name)) continue

    let extent4326: [number, number, number, number] | undefined
    // Walk up the layer tree for an inherited geographic bbox.
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.localName !== 'Layer') break
      const gb = Array.from(node.children).find((c) => c.localName === 'EX_GeographicBoundingBox')
      if (gb) {
        const nums = ['westBoundLongitude', 'southBoundLatitude', 'eastBoundLongitude', 'northBoundLatitude']
          .map((k) => Number(childText(gb, k)))
        if (nums.every(Number.isFinite)) extent4326 = nums as [number, number, number, number]
        break
      }
    }

    let time: WmsLayer['time']
    const dim = Array.from(el.children).find(
      (c) => c.localName === 'Dimension' && (c.getAttribute('name') ?? '').toLowerCase() === 'time',
    )
    if (dim) {
      time = {
        default: dim.getAttribute('default') ?? undefined,
        extent: compactTimeExtent(dim.textContent ?? undefined),
      }
    }

    layers.set(name, { name, title: childText(el, 'Title'), extent4326, time })
  }
  if (layers.size === 0) throw new Error('This WMS server offers no named layers (or is not a WMS endpoint).')

  const getMap = elems(doc, 'GetMap')[0]
  const formats = getMap ? elems(getMap, 'Format').map((f) => f.textContent?.trim() ?? '').filter(Boolean) : []

  const caps = { layers, formats }
  capsCache.set(baseUrl, caps)
  return caps
}

/** Prefer a georeferenced TIFF when the server offers one; else PNG. */
function pickFormat(formats: string[]): string {
  for (const want of ['image/geotiff', 'image/tiff']) {
    const hit = formats.find((f) => f.toLowerCase().startsWith(want))
    if (hit) return hit
  }
  return 'image/png'
}

/** R code importing a WMS layer as a SpatRaster via ourgeo_read_wms(). */
function buildWmsCode(
  baseUrl: string, layerName: string, format: string, varName: string, opts?: DownloadCodeOptions,
): string {
  const bbox = opts?.bbox !== undefined ? opts.bbox : useSpatialStore.getState().viewBbox
  const size = opts?.size ?? 2048
  const bboxLines = bbox
    ? [`  bbox      = c(${bbox.map((v) => parseFloat(v.toFixed(6))).join(', ')}),  # EPSG:4326 — edit to your AOI`]
    : ['  bbox      = NULL,  # NULL = full layer extent; pass c(xmin, ymin, xmax, ymax) for an AOI']
  const tail: string[] = []
  if (opts?.time) tail.push(`  time      = "${opts.time}",`)
  if (opts?.maxTiles && opts.maxTiles > 64) tail.push(`  max_tiles = ${opts.maxTiles}L,  # this export spans many GetMap requests`)
  tail.push(`  size      = ${size}L  # pixels on the long side`)
  return [
    'library(terra)',
    '',
    `# OGC WMS map export — ${layerName} (rendered imagery, not data values)`,
    '# Tiles GetMap requests to a safe chunk size and mosaics them.',
    `${varName} <- ourgeo_read_wms(`,
    `  base_url  = "${baseUrl}",`,
    `  layer     = "${layerName}",`,
    ...bboxLines,
    `  format    = "${format}",`,
    ...tail,
    ')',
  ].join('\n')
}

export const wmsProvider: ApiProvider = {
  id: 'wms',
  label: 'OGC WMS',
  category: 'Raster / Image Layers',
  description: 'OGC Web Map Service — rendered map imagery (satellite composites, hillshades, basemaps). Imports styled RGB pictures as a georeferenced SpatRaster.',
  builtinServers: [
    { id: 'nasa-gibs', label: 'NASA GIBS (EPSG:4326, best)', baseUrl: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi' },
    { id: 'terrestris-osm', label: 'terrestris OSM / SRTM', baseUrl: 'https://ows.terrestris.de/osm/service' },
  ],
  cascade: [{ key: 'layer', label: 'Layer', placeholder: 'Select a layer' }],

  async listLevel(_levelKey, _sel, ctx) {
    const caps = await fetchCaps(ctx.baseUrl)
    return Array.from(caps.layers.values()).map((l) => ({ value: l.name, label: l.title ?? l.name }))
  },

  async getMetadata(sel, ctx) {
    const caps = await fetchCaps(ctx.baseUrl)
    const layer = caps.layers.get(sel.layer)
    if (!layer) throw new Error(`Layer "${sel.layer}" not found in the server's capabilities.`)
    const format = pickFormat(caps.formats)
    return {
      fields: [],
      spatial: true,
      queryable: false,
      rasterResult: true,
      note:
        'WMS layer — imports *rendered* RGB imagery (a styled picture, not data values) ' +
        `as a georeferenced terra SpatRaster via tiled GetMap requests${layer.time ? '; time-enabled' : ''}.`,
      imageExport: {
        serviceUrl: ctx.baseUrl,
        name: layer.title ?? layer.name,
        pixelType: 'U8',
        bandCount: 3,
        extent4326: layer.extent4326,
        chunkPx: WMS_CHUNK_PX,
        time: layer.time,
      },
      downloadCode: (varName, opts) => buildWmsCode(ctx.baseUrl, layer.name, format, varName, opts),
    }
  },

  opsFor(_kind: FieldKind): FilterOp[] {
    return [] // rendered imagery — no attribute queries
  },

  async preview() {
    return [] // no tabular preview for imagery
  },

  buildCode() {
    return '# WMS layers import via the export panel above.'
  },
}
