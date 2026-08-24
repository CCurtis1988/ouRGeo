// Raster map-layer helpers: RasterSymbology (UI model) → wire payload,
// register/re-register against the R server, tile URL templates, and
// rehydration of persisted raster layers after reload / project load.

import { isAxiosError } from 'axios'
import { rClient } from '@/lib/r-client'
import { withPowerBlock } from '@/lib/power-block'
import type { RasterRegisterResponse, RasterSymbologyPayload } from '@/lib/r-client'
import { SEQUENTIAL_SCALES } from '@/lib/color-scales'
import {
  useSpatialStore,
  EMPTY_FEATURE_COLLECTION,
  DEFAULT_RASTER_SYMBOLOGY,
} from '@/store/spatial'
import type { RasterLayerInfo, RasterMeta, RasterSymbology, SpatialLayer } from '@/store/spatial'

/** Extra ramps that only make sense for rasters (grayscale for DEM/imagery). */
export const RASTER_EXTRA_RAMPS: Record<string, string[]> = {
  gray: ['#000000', '#ffffff'],
  terrain: ['#00a600', '#e6e600', '#eab64f', '#d9c39a', '#f2f2f2'],
}

export const RASTER_RAMPS: Record<string, string[]> = {
  ...RASTER_EXTRA_RAMPS,
  ...SEQUENTIAL_SCALES,
}

/** Resolve a ramp key (+ invert) into evenly spaced colormap stops for R. */
export function rampToColormap(
  ramp: string,
  invert: boolean
): { position: number; color: string }[] {
  const colors = [...(RASTER_RAMPS[ramp] ?? RASTER_RAMPS.viridis)]
  if (invert) colors.reverse()
  const n = colors.length
  return colors.map((color, i) => ({
    position: n === 1 ? 0 : i / (n - 1),
    color,
  }))
}

/** UI symbology → the exact payload /raster/register consumes. */
export function toSymbologyPayload(sym: RasterSymbology): RasterSymbologyPayload {
  return {
    mode: sym.mode,
    bands: sym.bands,
    stretch: {
      type: sym.stretch.type,
      pLow: sym.stretch.pLow,
      pHigh: sym.stretch.pHigh,
      nStd: sym.stretch.nStd,
      min: sym.stretch.min,
      max: sym.stretch.max,
    },
    colormap: sym.mode === 'singleband' ? rampToColormap(sym.ramp, sym.invertRamp) : undefined,
    categories: sym.mode === 'categorical' ? sym.categories : undefined,
    nodataTransparent: sym.nodataTransparent,
    resampling: sym.resampling,
  }
}

/** MapLibre tile URL template for a registered raster layer. */
export function rasterTileUrl(info: RasterLayerInfo): string {
  return `${rClient.baseUrl}/raster/tile/${info.layerId}/{z}/{x}/{y}.png?v=${info.version}`
}

function metaFromRegister(reg: RasterRegisterResponse, crs: string | null): RasterMeta {
  return {
    bands: reg.bands,
    nbands: reg.nbands,
    nrow: 0,
    ncol: 0,
    dtype: '',
    crs,
    nodata: null,
    approx: false,
  }
}

/** Sensible default symbology for a raster given its band stats. */
export function defaultRasterSymbology(reg: {
  nbands: number
  bands: { categorical: boolean }[]
}): RasterSymbology {
  if (reg.bands[0]?.categorical) {
    return { ...DEFAULT_RASTER_SYMBOLOGY, mode: 'categorical' }
  }
  if (reg.nbands >= 3) {
    // Multiband imagery reads as natural-color RGB out of the box.
    return { ...DEFAULT_RASTER_SYMBOLOGY, mode: 'rgb', bands: [1, 2, 3] }
  }
  return DEFAULT_RASTER_SYMBOLOGY
}

/**
 * Unwrap axios failures into actionable messages: an HTTP 500 from the R
 * server carries the real error in the JSON body ("Request failed with status
 * code 500" hides it), and a bare "Network Error" means the request was
 * severed without a response — an OS sleep/network change aborting in-flight
 * requests, or (rarely) the R process dying.
 */
function rasterRequestError(e: unknown): Error {
  if (isAxiosError(e)) {
    const serverMsg = (e.response?.data as { error?: string } | undefined)?.error
    if (serverMsg) return new Error(serverMsg)
    if (!e.response) {
      return new Error(
        'The connection to the R server was interrupted mid-request (this happens when the ' +
        'machine sleeps or the network changes while a large raster is being prepared, or if ' +
        'R crashed — check the console). The preparation may have finished anyway; try adding ' +
        'the layer again.'
      )
    }
  }
  return e instanceof Error ? e : new Error(String(e))
}

/** Request died without any response (sleep/network change/R crash). */
function isNoResponseError(e: unknown): boolean {
  return isAxiosError(e) && !e.response
}

// Client-generated layer ids let a retried registration target the same
// server entry: if the aborted attempt actually completed server-side (the
// warp keeps running whether or not the client is listening), the retry hits
// the restyle fast path and returns instantly instead of re-warping.
let clientLayerSeq = 0
function nextClientLayerId(): string {
  clientLayerSeq += 1
  return `rl_c${Date.now()}_${clientLayerSeq}`
}

const REGISTER_RETRIES = 2
const RETRY_DELAY_MS = 1500

/**
 * Run a raster request, retrying (only) connection-severed failures — the
 * OS suspending or the network flapping aborts every in-flight Chromium
 * request including localhost ones, while the R server happily keeps working.
 */
async function withRasterRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= REGISTER_RETRIES || !isNoResponseError(e)) {
        throw rasterRequestError(e)
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
    }
  }
}

/**
 * Register (or re-register) a raster object with the R server and return the
 * assembled RasterLayerInfo. `layerId` re-registers in place (symbology-only
 * changes keep the server-side warp and just bump the version).
 */
export async function registerRaster(
  name: string,
  envName: string,
  symbology: RasterSymbology,
  layerId?: string
): Promise<RasterLayerInfo> {
  // Always register under a known id so a connection-severed attempt can be
  // retried against the same entry (reusing its completed warp).
  const id = layerId ?? nextClientLayerId()
  const reg: RasterRegisterResponse = await withPowerBlock(() =>
    withRasterRetry(() =>
      rClient.rasterRegister(name, envName, toSymbologyPayload(symbology), id)
    )
  )
  if (!reg.success) throw new Error(reg.error || 'Raster registration failed')
  return {
    layerId: reg.layerId,
    version: reg.version,
    bounds: reg.bounds4326 ?? [-180, -85, 180, 85],
    maxzoom: reg.maxzoom,
    meta: metaFromRegister(reg, null),
    symbology,
    stretchRange: reg.stretch,
  }
}

/**
 * Fetch full meta (/raster/info) and register in one step — the Add-layer
 * path. Picks a default symbology from the band stats when none is given.
 */
export async function createRasterLayerInfo(
  name: string,
  envName: string,
  symbology?: RasterSymbology
): Promise<RasterLayerInfo> {
  const info: Awaited<ReturnType<typeof rClient.rasterInfo>> = await withRasterRetry(() =>
    rClient.rasterInfo(name, envName)
  )
  if (!info.success) throw new Error(info.error || 'Could not read raster')
  const sym = symbology ?? defaultRasterSymbology(info)
  const reg = await registerRaster(name, envName, sym)
  reg.meta = {
    bands: info.bands,
    nbands: info.nbands,
    nrow: info.nrow,
    ncol: info.ncol,
    dtype: info.dtype,
    crs: info.crs,
    nodata: info.nodata,
    approx: info.approx,
  }
  return reg
}

/**
 * Re-register every persisted raster layer after a reload / project load.
 * Server-side layerIds are session-scoped, so each layer gets a fresh
 * registration; layers whose R object is gone are removed (same spirit as
 * pruneStaleObjectTabs).
 */
export async function rehydrateRasterLayers(): Promise<void> {
  const { layers, updateRasterInfo, removeLayer } = useSpatialStore.getState()
  for (const layer of layers) {
    if (layer.kind !== 'raster' || !layer.raster) continue
    try {
      const info = await createRasterLayerInfo(
        layer.name,
        layer.envName,
        layer.raster.symbology
      )
      updateRasterInfo(layer.id, info)
    } catch {
      removeLayer(layer.id)
    }
  }
}

/** Shape handed to useSpatialStore.addLayer for a raster object. */
export function rasterLayerDraft(
  name: string,
  envName: string,
  info: RasterLayerInfo
): Omit<SpatialLayer, 'id' | 'color' | 'opacity' | 'visible'> {
  return {
    name,
    envName,
    geometryType: 'RASTER',
    geojson: EMPTY_FEATURE_COLLECTION,
    colLib: 'sf',
    columnName: '',
    kind: 'raster',
    raster: info,
  }
}
