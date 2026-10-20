import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import { projectPathCall } from './project-file-code'
import type { SpatialLayer, LegendSettings, NorthArrowSettings, NorthArrowStyle, OverlayPosition } from '@/store/spatial'
import { getEffectiveSym } from '@/lib/layer-symbology'
import { getProviderInfo } from '@/lib/basemap-providers'
import type { MapAnnotations, GgplotCornerPos, GgplotNorthArrowStyle } from '@/lib/map-annotations'
import { alignToHjust, hasLayoutChanges } from '@/lib/map-annotations'
import {
  POINT_SHAPE_PCH, fontface, rStr, rNum, layerRef,
  rasterLimits, rasterRampVector, rasterBandName, rasterRgbExpr, rasterCategories,
} from '@/lib/codegen-shared'

export interface GgplotExportOpts {
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

export interface GgplotCodeParams {
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
  exportOpts?: GgplotExportOpts
  adjustedBbox?: [number, number, number, number] | null
  tileZoom?: number
}

// ---- Constant mappings ----

function northArrowStyle(style: NorthArrowStyle | GgplotNorthArrowStyle): string {
  switch (style) {
    case 'open':    return 'north_arrow_orienteering()'
    case 'simple':
    case 'dot':     return 'north_arrow_minimal()'
    case 'split':
    default:        return 'north_arrow_fancy_orienteering()'
  }
}

function northArrowLocation(position: OverlayPosition): string {
  switch (position) {
    case 'top-left':     return 'tl'
    case 'top-right':    return 'tr'
    case 'bottom-left':  return 'bl'
    case 'bottom-right': return 'br'
    default:             return 'tr'
  }
}

function ggCornerToLocation(pos: GgplotCornerPos): string {
  const m: Record<string, string> = {
    'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br',
  }
  return m[pos] ?? 'tr'
}

// ---- Main code generator ----

export function generateGgplotCode(params: GgplotCodeParams): string {
  const {
    layers, viewState, viewBbox, showLegend,
    showNorthArrow, northArrowSettings, basemapId, activeView,
    annotations, exportOpts, adjustedBbox, tileZoom,
  } = params

  const visibleLayers = layers.filter((l) => l.visible)
  const firstLayer = visibleLayers[0]
  const provider = getProviderInfo(basemapId)
  const mapBbox = adjustedBbox ?? viewBbox
  const zoom = tileZoom ?? Math.round(viewState.zoom)
  const isStatic = !activeView
  const hasBasemap = isStatic ? provider.maptiles !== null : false
  const useAnn = !!annotations

  const rasterLayers = visibleLayers.filter((l) => l.kind === 'raster' && l.raster)
  // ggplot allows one fill scale; when a singleband raster's gradient must
  // coexist with other fill users (vector fills or more rasters), each raster
  // scale is followed by ggnewscale::new_scale_fill().
  const singlebandRasterCount = rasterLayers.filter(
    (l) => l.raster!.symbology.mode !== 'rgb'
  ).length

  // ---- Pre-scan layers for legend strategy ----
  // hasBoundFill: any polygon/point layer has a data-bound fill
  // hasBoundColor: any line layer has a data-bound color
  const hasBoundFill = visibleLayers.some((l) => {
    const gt = l.geometryType.toUpperCase()
    return !familyIsLine(gt) && !!getEffectiveSym(l).fillColorBinding
  })
  const hasBoundColor = visibleLayers.some((l) => {
    const gt = l.geometryType.toUpperCase()
    return familyIsLine(gt) && !!getEffectiveSym(l).fillColorBinding
  })
  // Entries for scale_fill_manual / scale_color_manual (populated during layer loop)
  const fixedFillEntries: { name: string; color: string }[] = []
  const fixedColorEntries: { name: string; color: string }[] = []

  // Whether singleband raster gradients must coexist with other fill users.
  const vectorFillUsers = hasBoundFill || visibleLayers.some(
    (l) => l.kind !== 'raster' && !familyIsLine(l.geometryType.toUpperCase())
  )
  const needNewScaleFill =
    singlebandRasterCount > 0 && (singlebandRasterCount > 1 || vectorFillUsers)

  const lines: string[] = []

  // ---- Libraries ----
  lines.push('library(ggplot2)')
  lines.push('library(sf)')
  if (isStatic && hasBasemap && firstLayer) {
    lines.push('library(maptiles)')
    lines.push('library(tidyterra)')
  }
  if (rasterLayers.length > 0) {
    lines.push('library(terra)')
    if (!(isStatic && hasBasemap && firstLayer)) lines.push('library(tidyterra)')
    if (needNewScaleFill) lines.push('library(ggnewscale)')
  }
  const needsGgspatial = (useAnn ? annotations!.showNorthArrowExport : showNorthArrow)
                      || (useAnn && annotations!.showScalebarGgplot)
  if (needsGgspatial) lines.push('library(ggspatial)')
  if (useAnn && annotations!.ggplotLegendPos !== 'none' && annotations!.ggplotLegendBgAlpha < 1.0) {
    lines.push('library(scales)')
  }
  if (!isStatic) lines.push('library(plotly)')
  lines.push('')

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

  // ---- ggplot object ----
  lines.push('p <- ggplot() +')

  // Basemap raster
  if (isStatic && hasBasemap && firstLayer) {
    lines.push('  geom_spatraster_rgb(data = bg) +')
  }

  // Layer blocks
  for (const layer of visibleLayers) {
    // Raster layers: tidyterra geoms reproducing the on-map symbology
    // (band choice, stretch bounds, color ramp). Layer order is respected —
    // rasters drawn here sit under any vector layer listed after them.
    if (layer.kind === 'raster' && layer.raster) {
      const info = layer.raster
      const sym = info.symbology
      if (sym.mode === 'rgb') {
        lines.push(`  geom_spatraster_rgb(`)
        lines.push(`    data  = ${rasterRgbExpr(layer.name, info)},`)
        lines.push(`    alpha = ${rNum(layer.opacity)}`)
        lines.push(`  ) +`)
      } else if (sym.mode === 'categorical') {
        const band = sym.bands[0] ?? 1
        const cats = rasterCategories(info)
        lines.push(`  geom_spatraster(`)
        lines.push(`    data  = as.factor(${layer.name}[[${band}]]),`)
        lines.push(`    alpha = ${rNum(layer.opacity)}`)
        lines.push(`  ) +`)
        if (cats.length > 0) {
          const values = cats
            .map((c) => `${rStr(c.label || String(c.value))} = ${rStr(c.color)}`)
            .join(', ')
          lines.push(`  scale_fill_manual(values = c(${values}), na.value = NA, na.translate = FALSE, name = ${rStr(layer.name)}) +`)
        }
        if (needNewScaleFill) lines.push(`  ggnewscale::new_scale_fill() +`)
      } else {
        // Singleband pseudocolor / grayscale
        const band = sym.bands[0] ?? 1
        const limits = rasterLimits(info)
        const limitsArg = limits
          ? `, limits = c(${rNum(limits[0])}, ${rNum(limits[1])}), oob = scales::squish`
          : ''
        lines.push(`  geom_spatraster(`)
        lines.push(`    data  = ${layer.name}[[${band}]],`)
        lines.push(`    alpha = ${rNum(layer.opacity)}`)
        lines.push(`  ) +`)
        lines.push(`  scale_fill_gradientn(colours = ${rasterRampVector(info)}${limitsArg}, na.value = NA, name = ${rStr(rasterBandName(info))}) +`)
        if (needNewScaleFill) lines.push(`  ggnewscale::new_scale_fill() +`)
      }
      continue
    }

    const s = getEffectiveSym(layer)
    const gt = layer.geometryType.toUpperCase()

    if (familyIsPolygon(gt)) {
      let fillArg: string
      if (s.fillColorBinding) {
        fillArg = `aes(fill = ${s.fillColorBinding.column})`
      } else if (!hasBoundFill) {
        fillArg = `aes(fill = ${rStr(layer.name)})`
        fixedFillEntries.push({ name: layer.name, color: s.fillColor })
      } else {
        fillArg = `fill = ${rStr(s.fillColor)}`
      }
      lines.push(`  geom_sf(`)
      lines.push(`    data      = ${layerRef(layer, mapBbox)},`)
      lines.push(`    ${fillArg},`)
      lines.push(`    color     = ${rStr(s.borderColor)},`)
      lines.push(`    linewidth = ${rNum(s.borderWidth)},`)
      lines.push(`    alpha     = ${rNum(s.fillOpacity)}`)
      lines.push(`  ) +`)
    } else if (familyIsLine(gt)) {
      let colorArg: string
      if (s.fillColorBinding) {
        colorArg = `aes(color = ${s.fillColorBinding.column})`
      } else if (!hasBoundColor) {
        colorArg = `aes(color = ${rStr(layer.name)})`
        fixedColorEntries.push({ name: layer.name, color: s.fillColor })
      } else {
        colorArg = `color = ${rStr(s.fillColor)}`
      }
      lines.push(`  geom_sf(`)
      lines.push(`    data      = ${layerRef(layer, mapBbox)},`)
      lines.push(`    ${colorArg},`)
      lines.push(`    linewidth = ${rNum(s.lineWidth)},`)
      lines.push(`    linetype  = ${rStr(s.lineDash)},`)
      lines.push(`    alpha     = ${rNum(layer.opacity)}`)
      lines.push(`  ) +`)
    } else {
      // POINT
      let fillArg: string
      if (s.fillColorBinding) {
        fillArg = `aes(fill = ${s.fillColorBinding.column})`
      } else if (!hasBoundFill) {
        fillArg = `aes(fill = ${rStr(layer.name)})`
        fixedFillEntries.push({ name: layer.name, color: s.fillColor })
      } else {
        fillArg = `fill = ${rStr(s.fillColor)}`
      }
      const pch = POINT_SHAPE_PCH[s.pointShape] ?? 21
      lines.push(`  geom_sf(`)
      lines.push(`    data  = ${layerRef(layer, mapBbox)},`)
      lines.push(`    ${fillArg},`)
      lines.push(`    color = ${rStr(s.borderColor)},`)
      lines.push(`    size  = ${rNum(s.pointSize / 3)},`)
      lines.push(`    shape = ${pch},`)
      lines.push(`    alpha = ${rNum(layer.opacity)}`)
      lines.push(`  ) +`)
    }

    // Label
    if (layer.labelSettings?.enabled && layer.labelSettings.field.trim()) {
      const ls = layer.labelSettings
      const face = fontface(ls.bold, ls.italic)
      lines.push(`  geom_sf_text(`)
      lines.push(`    data     = ${layerRef(layer, mapBbox)},`)
      lines.push(`    aes(label = ${ls.field}),`)
      lines.push(`    color    = ${rStr(ls.color)},`)
      lines.push(`    size     = ${rNum(ls.fontSize / 4)},`)
      lines.push(`    fontface = ${rStr(face)}`)
      lines.push(`  ) +`)
    }

    lines.push('')
  }

  // North arrow
  const showArrow = useAnn ? annotations!.showNorthArrowExport : showNorthArrow
  if (showArrow && isStatic) {
    const loc    = useAnn ? ggCornerToLocation(annotations!.northArrowExportPos) : northArrowLocation(northArrowSettings.position)
    const style  = useAnn ? northArrowStyle(annotations!.northArrowExportStyle) : northArrowStyle(northArrowSettings.style)
    const sizeCm = useAnn ? rNum(annotations!.northArrowExportSize) : '1.5'
    lines.push(`  annotation_north_arrow(`)
    lines.push(`    location = "${loc}",`)
    lines.push(`    style    = ${style},`)
    lines.push(`    height   = unit(${sizeCm}, "cm"),`)
    lines.push(`    width    = unit(${sizeCm}, "cm")`)
    lines.push(`  ) +`)
    lines.push('')
  }

  // Scale bar
  if (useAnn && annotations!.showScalebarGgplot && isStatic) {
    const sb = annotations!
    lines.push(`  annotation_scale(`)
    lines.push(`    location      = "${ggCornerToLocation(sb.scalebarGgplotPos)}",`)
    lines.push(`    style         = "${sb.scalebarGgplotStyle}",`)
    lines.push(`    unit_category = "${sb.scalebarGgplotUnits}",`)
    lines.push(`    width_hint    = ${rNum(sb.scalebarGgplotWidthHint)},`)
    lines.push(`    text_cex      = ${rNum(sb.scalebarGgplotTextCex)}`)
    lines.push(`  ) +`)
    lines.push('')
  }

  // Coordinate limits + optional graticule datum
  const needsDatum = useAnn && annotations!.showGraticulesGgplot
  if (mapBbox || needsDatum) {
    lines.push(`  coord_sf(`)
    if (mapBbox) {
      const [w, s, e, n] = mapBbox
      lines.push(`    xlim   = c(${rNum(w)}, ${rNum(e)}),`)
      lines.push(`    ylim   = c(${rNum(s)}, ${rNum(n)}),`)
      lines.push(`    expand = FALSE${needsDatum ? ',' : ''}`)
    }
    if (needsDatum) {
      lines.push(`    datum  = sf::st_crs(4326)`)
    }
    lines.push(`  ) +`)
    lines.push('')
  }

  // Base theme
  const baseTheme = annotations?.ggplotTheme ?? 'void'
  lines.push(`  theme_${baseTheme}()`)

  // ---- Manual scales for fixed-color layers ----
  // Only emitted when no layer of that aesthetic uses a data binding
  // (mixing bound and unbound layers on the same aesthetic isn't possible with a single scale)
  const legendTitle = useAnn ? annotations!.ggplotLegendTitle.trim() : ''
  const legendVisible = useAnn ? annotations!.ggplotLegendPos !== 'none' : showLegend
  if (fixedFillEntries.length > 0 && legendVisible) {
    const vals = fixedFillEntries.map((e) => `      ${rStr(e.name)} = ${rStr(e.color)}`).join(',\n')
    lines.push('')
    lines.push('p <- p +')
    lines.push(`  scale_fill_manual(`)
    lines.push(`    values = c(`)
    lines.push(vals)
    lines.push(`    )${legendTitle ? ',' : ''}`)
    if (legendTitle) lines.push(`    name = ${rStr(legendTitle)}`)
    lines.push(`  )`)
  }
  if (fixedColorEntries.length > 0 && legendVisible) {
    const vals = fixedColorEntries.map((e) => `      ${rStr(e.name)} = ${rStr(e.color)}`).join(',\n')
    lines.push('')
    lines.push('p <- p +')
    lines.push(`  scale_color_manual(`)
    lines.push(`    values = c(`)
    lines.push(vals)
    lines.push(`    )${legendTitle ? ',' : ''}`)
    if (legendTitle) lines.push(`    name = ${rStr(legendTitle)}`)
    lines.push(`  )`)
  }

  // ---- Annotations (labs + theme overrides) ----
  if (annotations) {
    const ann = annotations
    const hasLabels = (ann.showTitle && ann.titleText.trim()) ||
                      (ann.showSubtitle && ann.subtitleText.trim()) ||
                      (ann.showCaption && ann.captionText.trim())
    const hasLayout = hasLayoutChanges(ann)

    const effectiveLegendPos = useAnn ? ann.ggplotLegendPos : (showLegend ? 'right' : 'none')

    const hasTheme = ann.showTitle || ann.showSubtitle || ann.showCaption
      || hasLayout
      || !showLegend
      || effectiveLegendPos !== 'right'
      // When legend is visible at the default 'right' position, theme_void() silences
      // legend text via its `text = element_blank()` override. Adding this condition
      // ensures we always emit legend.title/legend.text element_text overrides.
      // NOTE: combined with the line above this makes hasTheme always true — preserved
      // as-is for now (behavior unchanged); revisit during codegen cleanup (Phase 5).
      || (effectiveLegendPos as string) !== 'none'
      || ann.showPanelBorder
      || ann.showGraticulesGgplot

    if (hasLabels) {
      lines.push('')
      const labArgs: string[] = []
      if (ann.showTitle && ann.titleText.trim())
        labArgs.push(`  title    = ${rStr(ann.titleText.trim())}`)
      if (ann.showSubtitle && ann.subtitleText.trim())
        labArgs.push(`  subtitle = ${rStr(ann.subtitleText.trim())}`)
      if (ann.showCaption && ann.captionText.trim())
        labArgs.push(`  caption  = ${rStr(ann.captionText.trim())}`)
      lines.push('p <- p +')
      lines.push(`labs(`)
      lines.push(labArgs.join(',\n') + '')
      lines.push(`)`)
    }

    if (hasTheme) {
      lines.push('')
      const themeArgs: string[] = []

      // Title
      if (ann.showTitle && ann.titleText.trim()) {
        const hjust = rNum(alignToHjust(ann.titleAlign))
        themeArgs.push(`  plot.title    = element_text(size = ${ann.titleSize}, face = ${rStr(ann.titleFace)}, hjust = ${hjust}, color = ${rStr(ann.titleColor)})`)
      }
      // Subtitle
      if (ann.showSubtitle && ann.subtitleText.trim()) {
        const hjust = rNum(alignToHjust(ann.subtitleAlign))
        themeArgs.push(`  plot.subtitle = element_text(size = ${ann.subtitleSize}, face = ${rStr(ann.subtitleFace)}, hjust = ${hjust}, color = ${rStr(ann.subtitleColor)})`)
      }
      // Caption
      if (ann.showCaption && ann.captionText.trim()) {
        const hjust = rNum(alignToHjust(ann.captionAlign))
        themeArgs.push(`  plot.caption  = element_text(size = ${ann.captionSize}, face = ${rStr(ann.captionFace)}, hjust = ${hjust}, color = ${rStr(ann.captionColor)})`)
      }
      // Layout (background, font)
      if (hasLayout) {
        themeArgs.push(`  plot.background  = element_rect(fill = ${rStr(ann.bgColor)}, color = NA)`)
        themeArgs.push(`  panel.background = element_rect(fill = ${rStr(ann.bgColor)}, color = NA)`)
        themeArgs.push(`  text             = element_text(family = ${rStr(ann.fontFamily)}, size = ${ann.baseFontSize})`)
      }
      // Legend position
      if (effectiveLegendPos !== 'right') {
        themeArgs.push(`  legend.position = "${effectiveLegendPos}"`)
      }
      if (effectiveLegendPos !== 'none') {
        if (ann.ggplotLegendDir === 'horizontal') {
          themeArgs.push(`  legend.direction = "horizontal"`)
        }
        themeArgs.push(`  legend.title = element_text(size = ${ann.ggplotLegendTitleSize}, colour = ${rStr(ann.ggplotLegendTitleColor)})`)
        themeArgs.push(`  legend.text  = element_text(size = ${ann.ggplotLegendTextSize}, colour = ${rStr(ann.ggplotLegendTextColor)})`)
        const bgFill = ann.ggplotLegendBgAlpha < 1.0
          ? `scales::alpha(${rStr(ann.ggplotLegendBgColor)}, ${rNum(ann.ggplotLegendBgAlpha)})`
          : rStr(ann.ggplotLegendBgColor)
        const bgBorder = ann.ggplotLegendFrame ? rStr(ann.panelBorderColor) : 'NA'
        themeArgs.push(`  legend.background = element_rect(fill = ${bgFill}, color = ${bgBorder})`)
      }
      // Panel border
      if (ann.showPanelBorder) {
        themeArgs.push(`  panel.border = element_rect(color = ${rStr(ann.panelBorderColor)}, linewidth = ${rNum(ann.panelBorderLwd)}, fill = NA)`)
      }
      // Graticule line styling
      if (ann.showGraticulesGgplot) {
        const gratCol = ann.graticulesGgplotAlpha < 1.0
          ? `scales::alpha(${rStr(ann.graticulesGgplotColor)}, ${rNum(ann.graticulesGgplotAlpha)})`
          : rStr(ann.graticulesGgplotColor)
        themeArgs.push(`  panel.grid.major = element_line(color = ${gratCol}, linewidth = ${rNum(ann.graticulesGgplotLwd)})`)
      }

      lines.push('p <- p +')
      lines.push('theme(')
      lines.push(themeArgs.join(',\n') + '')
      lines.push(')')
    }

    // Legend title override for data-bound layers (fixed-color layers get title via scale_*_manual)
    if (ann.ggplotLegendTitle.trim() && effectiveLegendPos !== 'none') {
      const labParts: string[] = []
      if (hasBoundFill)  labParts.push(`  fill  = ${rStr(ann.ggplotLegendTitle.trim())}`)
      if (hasBoundColor) labParts.push(`  color = ${rStr(ann.ggplotLegendTitle.trim())}`)
      if (labParts.length > 0) {
        lines.push('')
        lines.push('p <- p +')
        lines.push('labs(')
        lines.push(labParts.join(',\n'))
        lines.push(')')
      }
    }
  } else if (!showLegend) {
    // Fallback when no annotations object: hide legend
    lines.push('')
    lines.push('p <- p +')
    lines.push('theme(legend.position = "none")')
  }

  lines.push('')

  // ---- Active view or print ----
  if (!isStatic) {
    lines.push('# Note: basemap tiles are not rendered in the interactive plotly view')
    lines.push('plotly::ggplotly(p)')
  } else {
    lines.push('p')
  }

  // ---- Export ----
  if (exportOpts && isStatic) {
    lines.push('')
    lines.push('ggplot2::ggsave(')
    lines.push(`  filename = ${exportOpts.projectFile ? projectPathCall(exportOpts.projectFile) : rStr(exportOpts.path)},`)
    lines.push(`  plot     = p,`)
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
