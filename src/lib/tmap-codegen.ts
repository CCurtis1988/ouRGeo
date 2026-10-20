import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import { projectPathCall } from './project-file-code'
import type { SpatialLayer, LegendSettings, NorthArrowSettings, NorthArrowStyle, OverlayPosition } from '@/store/spatial'
import { getEffectiveSym } from '@/lib/layer-symbology'
import { getProviderInfo } from '@/lib/basemap-providers'
import type { MapAnnotations } from '@/lib/map-annotations'
import { alignToTmapPos, hasLayoutChanges } from '@/lib/map-annotations'
import {
  POINT_SHAPE_PCH, fontface, rStr, rNum, layerRef,
  rasterLimits, rasterRampVector, rasterRgbExpr, rasterCategories,
} from '@/lib/codegen-shared'

export interface TmapExportOpts {
  path: string
  /** Save into Project Files under this name instead of `path`
   *  (`ourgeo_project_path("figures/map.png")`). */
  projectFile?: string
  width: number
  height: number
  units: 'px' | 'in' | 'cm'
  dpi: number
  format: 'png' | 'jpg' | 'pdf'
}

export interface TmapCodeParams {
  layers: SpatialLayer[]
  viewState: { longitude: number; latitude: number; zoom: number }
  viewBbox: [number, number, number, number] | null
  showLegend: boolean
  legendSettings: LegendSettings
  showNorthArrow: boolean
  northArrowSettings: NorthArrowSettings
  basemapId: string
  activeView: boolean
  annotations?: MapAnnotations
  exportOpts?: TmapExportOpts
  adjustedBbox?: [number, number, number, number] | null
  tileZoom?: number
}

// ---- Constant mappings ----

function northArrowType(style: NorthArrowStyle): string {
  return style === 'compass' ? '4star' : 'arrow'
}

/** Unified position helper — returns tm_pos_in() or tm_pos_out() */
function tmapPos(position: OverlayPosition | string, inside: boolean, justification?: string): string {
  const posMap: Record<string, [string, string]> = {
    'top-left':     ['"left"',   '"top"'],
    'top':          ['"center"', '"top"'],
    'top-right':    ['"right"',  '"top"'],
    'left':         ['"left"',   '"center"'],
    'right':        ['"right"',  '"center"'],
    'bottom-left':  ['"left"',   '"bottom"'],
    'bottom':       ['"center"', '"bottom"'],
    'bottom-right': ['"right"',  '"bottom"'],
  }
  const [h, v] = posMap[position] ?? ['"right"', '"bottom"']

  const isSideH = position === 'top'  || position === 'bottom'
  const isSideV = position === 'left' || position === 'right'

  let args = `${h}, ${v}`
  if (isSideH && justification !== undefined) args += `, pos.h="${justification}"`
  if (isSideV && justification !== undefined) args += `, pos.v="${justification}"`

  return inside ? `tm_pos_in(${args})` : `tm_pos_out(${args})`
}

// ---- Legend helper — emits fill.legend / col.legend inside a layer function (data-bound only) ----

function emitLegend(
  lines: string[],
  param: string,
  show: boolean,
  a: MapAnnotations | undefined,
  ls: LegendSettings,
  useAnn: boolean,
): void {
  if (!show) {
    lines.push(`    ${param} = tm_legend(show = FALSE),`)
    return
  }
  if (useAnn && a) {
    const legendTitle = a.legendExportTitle.trim()
    lines.push(`    ${param} = tm_legend(`)
    if (legendTitle)
      lines.push(`      title          = ${rStr(legendTitle)},`)
    lines.push(`      title.size     = ${rNum(a.legendExportTitleSize)},`)
    lines.push(`      title.color    = ${rStr(a.legendExportTitleColor)},`)
    lines.push(`      title.fontface = ${rStr(a.legendExportTitleFace)},`)
    lines.push(`      text.size      = ${rNum(a.legendExportTextSize)},`)
    lines.push(`      text.color     = ${rStr(a.legendExportTextColor)},`)
    lines.push(`      orientation    = ${rStr(a.legendExportOrientation)},`)
    lines.push(`      position       = ${tmapPos(a.legendExportPosition, a.legendExportPositionIn, a.legendExportJustification)},`)
    lines.push(`      frame          = ${a.legendExportFrame ? 'TRUE' : 'FALSE'},`)
    lines.push(`      bg.color       = ${rStr(a.legendExportBgColor)},`)
    lines.push(`      bg.alpha       = ${rNum(a.legendExportBgAlpha)}`)
    lines.push(`    ),`)
  } else {
    const legendTitle = ls.title
    lines.push(`    ${param} = tm_legend(`)
    if (legendTitle)
      lines.push(`      title      = ${rStr(legendTitle)},`)
    lines.push(`      title.size = ${rNum(ls.titleSize / 12)},`)
    lines.push(`      position   = ${tmapPos(ls.position, true)},`)
    lines.push(`      frame      = ${ls.showBorder ? 'TRUE' : 'FALSE'},`)
    lines.push(`      bg.color   = ${rStr(ls.bgColor)},`)
    lines.push(`      bg.alpha   = ${rNum(ls.bgOpacity)}`)
    lines.push(`    ),`)
  }
}

// ---- Main code generator ----

export function generateTmapCode(params: TmapCodeParams): string {
  const {
    layers, viewState, viewBbox, showLegend, legendSettings,
    showNorthArrow, northArrowSettings, basemapId, activeView, annotations, exportOpts,
    adjustedBbox, tileZoom,
  } = params

  const visibleLayers = layers.filter((l) => l.visible)
  const firstLayer = visibleLayers[0]
  const provider = getProviderInfo(basemapId)
  const mapBbox = adjustedBbox ?? viewBbox
  const zoom = tileZoom ?? Math.round(viewState.zoom)
  const isStatic = !activeView
  const hasBasemap = isStatic ? provider.maptiles !== null : provider.leaflet !== null

  // When annotations is present (export dialog), use annotation show flags; else fall back to store
  const useAnn = annotations !== undefined && annotations !== null
  const showCompass    = useAnn ? annotations!.showCompassExport   : showNorthArrow
  const showLegendBlock = useAnn ? annotations!.showLegendExport   : showLegend

  const lines: string[] = []

  // ---- Libraries ----
  lines.push('library(tmap)')
  if (isStatic && hasBasemap && firstLayer) {
    lines.push('library(maptiles)')
  }
  if (visibleLayers.some((l) => l.kind === 'raster' && l.raster)) {
    lines.push('library(terra)')
  }
  lines.push('')

  // ---- Mode ----
  lines.push(`tmap_mode("${isStatic ? 'plot' : 'view'}")`)
  lines.push('')

  // ---- View mode basemap ----
  if (!isStatic) {
    if (provider.leaflet && provider.leaflet !== 'none') {
      lines.push(`# Basemap: ${provider.label}`)
      lines.push(`tmap_options(basemaps = c(${rStr(provider.leaflet)}))`)
      lines.push('')
    }
  }

  // ---- Static basemap tile fetch ----
  if (isStatic && hasBasemap && firstLayer) {
    lines.push(`# Fetch ${provider.label} basemap tiles`)
    lines.push(`bg <- get_tiles(`)
    if (mapBbox) {
      const [w, s, e, n] = mapBbox
      lines.push(`  x        = sf::st_bbox(c(xmin = ${rNum(w)}, ymin = ${rNum(s)}, xmax = ${rNum(e)}, ymax = ${rNum(n)}), crs = sf::st_crs(4326)),`)
    } else {
      lines.push(`  x        = ${firstLayer.name},`)
    }
    lines.push(`  provider = ${rStr(provider.maptiles!)},`)
    lines.push(`  zoom     = ${zoom},`)
    lines.push(`  cachedir = tempdir()`)
    lines.push(`)`)
    lines.push('')
  }

  // ---- Map object ----
  if (visibleLayers.length === 0 && !(isStatic && hasBasemap && firstLayer)) {
    lines.push('# No visible layers')
    lines.push('tm <- tm_basemap(NULL)')
    lines.push('')
  } else {
    lines.push('tm <-')

    // basemap shape first
    if (isStatic && hasBasemap && firstLayer) {
      if (mapBbox) {
        const [w, s, e, n] = mapBbox
        lines.push(`  tm_shape(bg,`)
        lines.push(`    bbox = sf::st_bbox(c(xmin = ${rNum(w)}, ymin = ${rNum(s)}, xmax = ${rNum(e)}, ymax = ${rNum(n)}), crs = sf::st_crs(4326))) + tm_rgb() +`)
      } else {
        lines.push('  tm_shape(bg) + tm_rgb() +')
      }
    }

    // Graticules — placed before data layers so they render behind
    if (annotations?.showGraticules) {
      const g = annotations
      lines.push(`  tm_graticules(`)
      lines.push(`    n.x             = ${g.graticulesNX},`)
      lines.push(`    n.y             = ${g.graticulesNY},`)
      lines.push(`    labels.cardinal = ${g.graticulesLabels ? 'TRUE' : 'FALSE'},`)
      lines.push(`    col             = ${rStr(g.graticulesColor)},`)
      lines.push(`    lwd             = ${rNum(g.graticulesLwd)},`)
      lines.push(`    alpha           = ${rNum(g.graticulesAlpha)}`)
      lines.push(`  ) +`)
      lines.push('')
    }

    // When there is a static basemap, get_tiles() already used viewBbox so the raster
    // extent is correct. Only need to add bbox to the first *data* layer when there
    // is no basemap.
    let bboxAdded = false

    interface FixedLegendEntry { name: string; color: string; lwd: number; geomClass: 'fill' | 'line' }
    const fixedLegendEntries: FixedLegendEntry[] = []

    // Layer blocks
    for (let i = 0; i < visibleLayers.length; i++) {
      const layer = visibleLayers[i]
      const isLast = i === visibleLayers.length - 1

      // Raster layers: tm_raster/tm_rgb reproducing the on-map symbology
      // (band, stretch bounds, ramp). Shape expression carries the band
      // subset / RGB stretch so the plotted pixels match the tiles.
      if (layer.kind === 'raster' && layer.raster) {
        const info = layer.raster
        const sym = info.symbology
        const band = sym.bands[0] ?? 1
        const shapeExpr =
          sym.mode === 'rgb' ? rasterRgbExpr(layer.name, info)
          : sym.mode === 'categorical' ? `as.factor(${layer.name}[[${band}]])`
          : `${layer.name}[[${band}]]`

        if (isStatic && mapBbox && !bboxAdded) {
          const [w, s2, e, n] = mapBbox
          lines.push(`  tm_shape(${shapeExpr},`)
          lines.push(`    bbox = sf::st_bbox(c(xmin = ${rNum(w)}, ymin = ${rNum(s2)}, xmax = ${rNum(e)}, ymax = ${rNum(n)}), crs = sf::st_crs(4326))) +`)
          bboxAdded = true
        } else {
          lines.push(`  tm_shape(${shapeExpr}) +`)
        }

        if (sym.mode === 'rgb') {
          lines.push(`  tm_rgb() +`)
        } else if (sym.mode === 'categorical') {
          const cats = rasterCategories(info)
          const values = cats.length > 0
            ? `values = c(${cats.map((c) => rStr(c.color)).join(', ')})`
            : `values = "brewer.set3"`
          lines.push(`  tm_raster(`)
          lines.push(`    col.scale = tm_scale_categorical(${values}),`)
          lines.push(`    col_alpha = ${rNum(layer.opacity)},`)
          emitLegend(lines, 'col.legend', showLegendBlock, annotations, legendSettings, useAnn)
          lines.push(`  ) +`)
        } else {
          const limits = rasterLimits(info)
          const limitsArg = limits
            ? `, limits = c(${rNum(limits[0])}, ${rNum(limits[1])}), outliers.trunc = c(TRUE, TRUE)`
            : ''
          lines.push(`  tm_raster(`)
          lines.push(`    col.scale = tm_scale_continuous(values = ${rasterRampVector(info)}${limitsArg}),`)
          lines.push(`    col_alpha = ${rNum(layer.opacity)},`)
          emitLegend(lines, 'col.legend', showLegendBlock, annotations, legendSettings, useAnn)
          lines.push(`  ) +`)
        }

        if (!isLast || showCompass || annotations?.showScalebar) lines.push('')
        continue
      }

      const s = getEffectiveSym(layer)
      const gt = layer.geometryType.toUpperCase()
      const hasLabel = layer.labelSettings?.enabled && layer.labelSettings.field.trim()

      if (isStatic && mapBbox && !bboxAdded) {
        const [w, s2, e, n] = mapBbox
        lines.push(`  tm_shape(${layerRef(layer, mapBbox)},`)
        lines.push(`    bbox = sf::st_bbox(c(xmin = ${rNum(w)}, ymin = ${rNum(s2)}, xmax = ${rNum(e)}, ymax = ${rNum(n)}), crs = sf::st_crs(4326))) +`)
        bboxAdded = true
      } else {
        lines.push(`  tm_shape(${layerRef(layer, mapBbox)}) +`)
      }

      if (familyIsPolygon(gt)) {
        const fill = s.fillColorBinding
          ? rStr(s.fillColorBinding.column)
          : rStr(s.fillColor)
        lines.push(`  tm_polygons(`)
        lines.push(`    fill       = ${fill},`)
        lines.push(`    fill_alpha = ${rNum(s.fillOpacity)},`)
        lines.push(`    col        = ${rStr(s.borderColor)},`)
        if (s.fillColorBinding) {
          lines.push(`    lwd        = ${rNum(s.borderWidth)},`)
          emitLegend(lines, 'fill.legend', showLegendBlock, annotations, legendSettings, useAnn)
        } else {
          lines.push(`    lwd        = ${rNum(s.borderWidth)}`)
        }
        lines.push(`  ) +`)
      } else if (familyIsLine(gt)) {
        const col = s.fillColorBinding
          ? rStr(s.fillColorBinding.column)
          : rStr(s.fillColor)
        lines.push(`  tm_lines(`)
        lines.push(`    col       = ${col},`)
        lines.push(`    col_alpha = ${rNum(layer.opacity)},`)
        lines.push(`    lwd       = ${rNum(s.lineWidth)},`)
        if (s.fillColorBinding) {
          lines.push(`    lty       = ${rStr(s.lineDash)},`)
          emitLegend(lines, 'col.legend', showLegendBlock, annotations, legendSettings, useAnn)
        } else {
          lines.push(`    lty       = ${rStr(s.lineDash)}`)
        }
        lines.push(`  ) +`)
      } else {
        // POINT
        const fill = s.fillColorBinding
          ? rStr(s.fillColorBinding.column)
          : rStr(s.fillColor)
        const pch = POINT_SHAPE_PCH[s.pointShape] ?? 21
        lines.push(`  tm_symbols(`)
        lines.push(`    fill       = ${fill},`)
        lines.push(`    fill_alpha = ${rNum(layer.opacity)},`)
        lines.push(`    size       = ${rNum(s.pointSize / 8)},`)
        if (s.fillColorBinding) {
          lines.push(`    shape      = ${pch},`)
          emitLegend(lines, 'fill.legend', showLegendBlock, annotations, legendSettings, useAnn)
        } else {
          lines.push(`    shape      = ${pch}`)
        }
        lines.push(`  ) +`)
      }

      // Collect fixed-color layers for tm_add_legend() after the loop
      if (showLegendBlock && !s.fillColorBinding) {
        fixedLegendEntries.push({
          name:      layer.name,
          color:     s.fillColor,
          lwd:       familyIsLine(gt) ? s.lineWidth : 1,
          geomClass: familyIsLine(gt) ? 'line' : 'fill',
        })
      }

      // Label layer
      if (hasLabel) {
        const ls = layer.labelSettings!
        const face = fontface(ls.bold, ls.italic)
        lines.push(`  tm_shape(${layerRef(layer, mapBbox)}) +`)
        lines.push(`  tm_text(`)
        lines.push(`    text       = ${rStr(ls.field)},`)
        lines.push(`    col        = ${rStr(ls.color)},`)
        lines.push(`    col_alpha  = ${rNum(ls.opacity)},`)
        lines.push(`    size       = ${rNum(ls.fontSize / 14)},`)
        lines.push(`    fontface   = ${rStr(face)},`)
        lines.push(`    shadow     = ${ls.haloWidth > 0 ? 'TRUE' : 'FALSE'},`)
        lines.push(`    shadow.col = ${rStr(ls.haloColor)}`)
        lines.push(`  ) +`)
      }

      // Blank line between layers for readability (unless last)
      if (!isLast || showCompass || annotations?.showScalebar) {
        lines.push('')
      }
    }

    // Fixed-color legend entries via tm_add_legend()
    const fixedFillEntries = fixedLegendEntries.filter(e => e.geomClass === 'fill')
    const fixedLineEntries = fixedLegendEntries.filter(e => e.geomClass === 'line')

    if (fixedFillEntries.length > 0) {
      const a = annotations
      const pos = useAnn && a
        ? tmapPos(a.legendExportPosition, a.legendExportPositionIn, a.legendExportJustification)
        : tmapPos(legendSettings.position, true)
      const legendTitle = (useAnn && a ? a.legendExportTitle.trim() : legendSettings.title) || ''
      const orientation = useAnn && a ? a.legendExportOrientation : 'portrait'
      const frame       = useAnn && a ? a.legendExportFrame : legendSettings.showBorder
      const bgColor     = useAnn && a ? a.legendExportBgColor : legendSettings.bgColor
      const bgAlpha     = useAnn && a ? a.legendExportBgAlpha : legendSettings.bgOpacity
      const titleSize   = useAnn && a ? rNum(a.legendExportTitleSize) : rNum(legendSettings.titleSize / 12)
      const textSize    = useAnn && a ? rNum(a.legendExportTextSize)  : rNum(legendSettings.itemFontSize / 12)
      lines.push(`  tm_add_legend(`)
      lines.push(`    type        = "polygons",`)
      lines.push(`    fill        = c(${fixedFillEntries.map(e => rStr(e.color)).join(', ')}),`)
      lines.push(`    labels      = c(${fixedFillEntries.map(e => rStr(e.name)).join(', ')}),`)
      if (legendTitle) lines.push(`    title       = ${rStr(legendTitle)},`)
      lines.push(`    title.size  = ${titleSize},`)
      lines.push(`    text.size   = ${textSize},`)
      lines.push(`    orientation = ${rStr(orientation)},`)
      lines.push(`    position    = ${pos},`)
      lines.push(`    frame       = ${frame ? 'TRUE' : 'FALSE'},`)
      lines.push(`    bg.color    = ${rStr(bgColor)},`)
      lines.push(`    bg.alpha    = ${rNum(bgAlpha)}`)
      lines.push(`  ) +`)
      lines.push('')
    }

    if (fixedLineEntries.length > 0) {
      const a = annotations
      const pos = useAnn && a
        ? tmapPos(a.legendExportPosition, a.legendExportPositionIn, a.legendExportJustification)
        : tmapPos(legendSettings.position, true)
      const orientation = useAnn && a ? a.legendExportOrientation : 'portrait'
      lines.push(`  tm_add_legend(`)
      lines.push(`    type        = "lines",`)
      lines.push(`    col         = c(${fixedLineEntries.map(e => rStr(e.color)).join(', ')}),`)
      lines.push(`    lwd         = c(${fixedLineEntries.map(e => rNum(e.lwd)).join(', ')}),`)
      lines.push(`    labels      = c(${fixedLineEntries.map(e => rStr(e.name)).join(', ')}),`)
      lines.push(`    orientation = ${rStr(orientation)},`)
      lines.push(`    position    = ${pos}`)
      lines.push(`  ) +`)
      lines.push('')
    }

    // North arrow
    if (showCompass) {
      if (useAnn) {
        const a = annotations!
        lines.push(`  tm_compass(`)
        lines.push(`    type        = ${rStr(a.compassExportType)},`)
        lines.push(`    position    = ${tmapPos(a.compassExportPosition, a.compassExportPositionIn, a.compassExportJustification)},`)
        lines.push(`    size        = ${rNum(a.compassExportSize)},`)
        lines.push(`    show.labels = ${a.compassExportShowLabels ? '1' : '0'},`)
        lines.push(`    text.size   = ${rNum(a.compassExportTextSize)},`)
        lines.push(`    color.dark  = ${rStr(a.compassExportColorDark)},`)
        lines.push(`    color.light = ${rStr(a.compassExportColorLight)}`)
        lines.push(`  ) +`)
      } else {
        const na = northArrowSettings
        lines.push(`  tm_compass(`)
        lines.push(`    type     = ${rStr(northArrowType(na.style))},`)
        lines.push(`    position = ${tmapPos(na.position, true)},`)
        lines.push(`    size     = ${rNum(na.size / 10)}`)
        lines.push(`  ) +`)
      }
      lines.push('')
    }

    // Scale bar
    if (annotations?.showScalebar) {
      const sb = annotations
      lines.push(`  tm_scalebar(`)
      if (sb.scalebarBreaks.trim())
        lines.push(`    breaks      = c(${sb.scalebarBreaks}),`)
      lines.push(`    position    = ${tmapPos(sb.scalebarPosition, sb.scalebarPositionIn, sb.scalebarJustification)},`)
      lines.push(`    text.size   = ${rNum(sb.scalebarTextSize)},`)
      lines.push(`    color.dark  = ${rStr(sb.scalebarColorDark)},`)
      lines.push(`    color.light = ${rStr(sb.scalebarColorLight)},`)
      lines.push(`    lwd         = ${rNum(sb.scalebarLwd)}`)
      lines.push(`  ) +`)
      lines.push('')
    }

    // Annotations (title, subtitle, caption, layout)
    if (annotations) {
      const ann = annotations

      if (ann.showTitle && ann.titleText.trim()) {
        const titlePos = ann.titlePosition === 'inside'
          ? `tm_pos_in(${alignToTmapPos(ann.titleAlign)}, "top")`
          : `tm_pos_out(${alignToTmapPos(ann.titleAlign)}, "top")`
        lines.push(`  tm_title(`)
        lines.push(`    ${rStr(ann.titleText.trim())},`)
        lines.push(`    size     = ${rNum(ann.titleSize / 12)},`)
        lines.push(`    fontface = ${rStr(ann.titleFace)},`)
        lines.push(`    col      = ${rStr(ann.titleColor)},`)
        lines.push(`    just     = c(${alignToTmapPos(ann.titleJust)}, "top"),`)
        lines.push(`    position = ${titlePos}`)
        lines.push(`  ) +`)
        lines.push('')
      }

      if (ann.showSubtitle && ann.subtitleText.trim()) {
        const topOffset = ann.showTitle ? rNum(ann.titleSize / 12 + 0.3) : '0'
        const subtitlePos = ann.subtitlePosition === 'inside'
          ? `tm_pos_in(${alignToTmapPos(ann.subtitleAlign)}, "top")`
          : `tm_pos_out(${alignToTmapPos(ann.subtitleAlign)}, "top")`
        lines.push(`  tm_title(`)
        lines.push(`    ${rStr(ann.subtitleText.trim())},`)
        lines.push(`    size     = ${rNum(ann.subtitleSize / 12)},`)
        lines.push(`    fontface = ${rStr(ann.subtitleFace)},`)
        lines.push(`    col      = ${rStr(ann.subtitleColor)},`)
        lines.push(`    just     = c(${alignToTmapPos(ann.subtitleJust)}, "top"),`)
        lines.push(`    position = ${subtitlePos},`)
        lines.push(`    margins  = c(0, 0, ${topOffset}, 0)`)
        lines.push(`  ) +`)
        lines.push('')
      }

      if (ann.showCaption && ann.captionText.trim()) {
        const captionPos = ann.captionPosition === 'outside'
          ? `tm_pos_out(${alignToTmapPos(ann.captionAlign)}, "bottom")`
          : `tm_pos_in(${alignToTmapPos(ann.captionAlign)}, "bottom")`
        lines.push(`  tm_credits(`)
        lines.push(`    ${rStr(ann.captionText.trim())},`)
        lines.push(`    size     = ${rNum(ann.captionSize / 12)},`)
        lines.push(`    col      = ${rStr(ann.captionColor)},`)
        lines.push(`    just     = c(${alignToTmapPos(ann.captionJust)}, "bottom"),`)
        lines.push(`    position = ${captionPos}`)
        lines.push(`  ) +`)
        lines.push('')
      }

      if (hasLayoutChanges(ann) && isStatic) {
        const hasOuterMargin = ann.outerMarginTop || ann.outerMarginRight || ann.outerMarginBottom || ann.outerMarginLeft
        const hasInnerMargin = ann.innerMarginTop || ann.innerMarginRight || ann.innerMarginBottom || ann.innerMarginLeft
        lines.push(`  tm_layout(`)
        lines.push(`    bg.color        = ${rStr(ann.bgColor)},`)
        lines.push(`    frame           = ${ann.showFrame ? 'TRUE' : 'FALSE'},`)
        if (ann.showFrame) {
          lines.push(`    frame.color     = ${rStr(ann.frameColor)},`)
          lines.push(`    frame.lwd       = ${rNum(ann.frameLwd)},`)
          if (ann.frameR > 0)
            lines.push(`    frame.r         = ${rNum(ann.frameR)},`)
        }
        if (hasOuterMargin) {
          const b = rNum(ann.outerMarginBottom / 100)
          const l = rNum(ann.outerMarginLeft   / 100)
          const t = rNum(ann.outerMarginTop    / 100)
          const r = rNum(ann.outerMarginRight  / 100)
          lines.push(`    outer.margins   = c(${b}, ${l}, ${t}, ${r}),`)
        }
        if (hasInnerMargin) {
          const b = rNum(ann.innerMarginBottom / 100)
          const l = rNum(ann.innerMarginLeft   / 100)
          const t = rNum(ann.innerMarginTop    / 100)
          const r = rNum(ann.innerMarginRight  / 100)
          lines.push(`    inner.margins   = c(${b}, ${l}, ${t}, ${r}),`)
        }
        if (ann.outerBgColor.trim())
          lines.push(`    outer.bg.color  = ${rStr(ann.outerBgColor)},`)
        lines.push(`    text.fontfamily = ${rStr(ann.fontFamily)},`)
        lines.push(`    fontsize        = ${ann.baseFontSize}`)
        lines.push(`  ) +`)
        lines.push('')
      }
    }

    // Finalize: view mode with bbox → v4 tm_view(bbox=); all other cases → strip trailing +
    if (!isStatic && viewBbox) {
      const [w, s, e, n] = viewBbox
      lines.push(`  tm_view(`)
      lines.push(`    bbox = sf::st_bbox(c(xmin = ${rNum(w)}, ymin = ${rNum(s)}, xmax = ${rNum(e)}, ymax = ${rNum(n)}), crs = sf::st_crs(4326))`)
      lines.push(`  )`)
    } else {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().endsWith(') +')) {
          lines[i] = lines[i].replace(new RegExp('\\) \\+$'), ')')
          break
        }
      }
    }

    lines.push('')
  }

  // ---- Print map ----
  lines.push('tm')
  lines.push('')

  // ---- Export ----
  if (exportOpts) {
    lines.push('tmap_save(tm,')
    lines.push(`  filename = ${exportOpts.projectFile ? projectPathCall(exportOpts.projectFile) : rStr(exportOpts.path)},`)
    lines.push(`  width    = ${exportOpts.width},`)
    lines.push(`  height   = ${exportOpts.height},`)
    lines.push(`  units    = ${rStr(exportOpts.units)},`)
    lines.push(`  dpi      = ${exportOpts.dpi}`)
    lines.push(')')
    // Project Files reports its own save; a path is quoted, never spliced raw.
    if (!exportOpts.projectFile) lines.push(`cat("Saved to:", ${rStr(exportOpts.path)}, "\\n")`)
  }

  return lines.join('\n').trimEnd()
}
