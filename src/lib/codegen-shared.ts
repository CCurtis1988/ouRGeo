// Shared helpers used by both the ggplot2 and tmap code generators. These were
// previously duplicated verbatim in ggplot-codegen.ts and tmap-codegen.ts.

import type { SpatialLayer, RasterLayerInfo } from '@/store/spatial'
import { rStr } from '@/lib/r-identifier'
import { RASTER_RAMPS } from '@/lib/raster-layers'

export { rStr }

/** Point shape name -> R `pch` code (filled shapes). */
export const POINT_SHAPE_PCH: Record<string, number> = {
  circle: 21, square: 22, triangle: 24, cross: 3, diamond: 23,
}

/** Maps bold/italic flags to an R `fontface` value. */
export function fontface(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'bold.italic'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'plain'
}

/** Formats a number for R code, trimming to `decimals` significant places. */
export function rNum(n: number, decimals = 3): string {
  return parseFloat(n.toFixed(decimals)).toString()
}

// Reference a layer's R object in generated code. Database-backed layers
// (`layer.tileSource` set) live as `dplyr::tbl(con, "table")` proxies, which
// tmap/ggplot don't accept directly — wrap them in `rgeo_materialize()` so the
// proxy gets pulled into an in-memory sf object before plotting. `bbox`
// (xmin, ymin, xmax, ymax in WGS84) limits the pull to the export extent; pass
// null to materialize the full layer.
export function layerRef(layer: SpatialLayer, bbox: [number, number, number, number] | null): string {
  if (!layer.tileSource) return layer.name
  if (!bbox) return `rgeo_materialize(${layer.name})`
  const [w, s, e, n] = bbox
  return `rgeo_materialize(${layer.name}, bbox = c(${rNum(w)}, ${rNum(s)}, ${rNum(e)}, ${rNum(n)}))`
}

// ── Raster layer export helpers ──────────────────────────────────────────────
// Shared by both generators so the exported plot reproduces the on-map raster
// symbology (band choice, stretch, color ramp) rather than terra defaults.

/** Resolved [lo, hi] stretch range the map is currently rendering with. */
export function rasterLimits(info: RasterLayerInfo): [number, number] | null {
  const lo = info.stretchRange?.lo?.[0]
  const hi = info.stretchRange?.hi?.[0]
  if (lo !== undefined && hi !== undefined) return [lo, hi]
  const band = info.meta.bands[(info.symbology.bands[0] ?? 1) - 1]
  return band ? [band.min, band.max] : null
}

/** Ramp hex stops (invert applied) as an R `c("#...", ...)` vector. */
export function rasterRampVector(info: RasterLayerInfo): string {
  const colors = [...(RASTER_RAMPS[info.symbology.ramp] ?? RASTER_RAMPS.viridis)]
  if (info.symbology.invertRamp) colors.reverse()
  return `c(${colors.map((c) => rStr(c)).join(', ')})`
}

/** Name of the displayed band (backticked for aes() when needed elsewhere). */
export function rasterBandName(info: RasterLayerInfo): string {
  const idx = info.symbology.bands[0] ?? 1
  return info.meta.bands[idx - 1]?.name ?? `band_${idx}`
}

/**
 * R expression producing the RGB-mode raster with the on-map stretch applied:
 * terra::stretch() maps each channel into 0–255 using the same bounds the tile
 * renderer used (quantiles for percent clip, explicit smin/smax otherwise).
 */
export function rasterRgbExpr(name: string, info: RasterLayerInfo): string {
  const sym = info.symbology
  const bands = sym.bands.length >= 3 ? sym.bands.slice(0, 3) : [1, 1, 1]
  const subset = `${name}[[c(${bands.join(', ')})]]`
  const st = sym.stretch
  if (st.type === 'percent') {
    return `terra::stretch(${subset}, minq = ${rNum((st.pLow ?? 2) / 100, 4)}, maxq = ${rNum((st.pHigh ?? 98) / 100, 4)})`
  }
  if (st.type === 'minmax') {
    return `terra::stretch(${subset})`
  }
  const lo = info.stretchRange?.lo ?? []
  const hi = info.stretchRange?.hi ?? []
  if (lo.length > 0 && hi.length > 0) {
    return `terra::stretch(${subset}, smin = ${rNum(Math.min(...lo))}, smax = ${rNum(Math.max(...hi))})`
  }
  return `terra::stretch(${subset})`
}

/** Categorical value/label/color triples the map is rendering with. */
export function rasterCategories(info: RasterLayerInfo): { value: number; label: string; color: string }[] {
  return (
    info.symbology.categories ??
    info.meta.bands[(info.symbology.bands[0] ?? 1) - 1]?.levels ??
    []
  )
}
