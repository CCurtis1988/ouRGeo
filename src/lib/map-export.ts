// The map that is on screen, as R code.
//
// `mapCodeParams()` was private to markdown/chunk-codegen.ts, which needed it to
// write a map into an .Rmd. The AI assistant needs the same snapshot for its
// `map.exportCode` action, and both must agree with the Spatial Editor's Export
// dialogs — one map on screen, one piece of generated code, whichever surface
// asks for it.
//
// Deliberately reads the live stores rather than taking arguments: "the current
// map" is not something a caller should have to assemble, and assembling it in
// three places is how the three surfaces drift apart.

import { useSpatialStore } from '@/store/spatial'
import { useBasemapStore } from '@/store/basemap'
import { useThemeStore } from '@/store/theme'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { THEME_DEFAULT_BASEMAPS } from '@/lib/basemaps'
import { generateTmapCode } from '@/lib/tmap-codegen'
import { generateGgplotCode } from '@/lib/ggplot-codegen'

export type MapEngine = 'tmap' | 'ggplot'

/**
 * Snapshot of everything the map generators read, taken from the live stores.
 *
 * Mirrors ExportCodeDialog's `codeParams`, minus the dialog-only overrides:
 * `annotations` is left undefined so both generators fall back to the spatial
 * store's own legend/north-arrow settings — i.e. what is drawn on screen.
 */
export function mapCodeParams(): Parameters<typeof generateTmapCode>[0] {
  const s = useSpatialStore.getState()
  const overrideId = useBasemapStore.getState().overrideBasemapId
  const theme = useThemeStore.getState().current
  return {
    layers: s.layers,
    viewState: s.viewState,
    viewBbox: s.viewBbox,
    showLegend: s.showLegend,
    legendSettings: s.legendSettings,
    showNorthArrow: s.showNorthArrow,
    northArrowSettings: s.northArrowSettings,
    basemapId: overrideId ?? THEME_DEFAULT_BASEMAPS[theme] ?? 'carto-dark-matter',
    // Static output: a knitted document or a saved figure can't host a Leaflet
    // view, and the point is a figure.
    activeView: false,
    tileZoom: Math.max(1, Math.min(18, Math.round(s.viewState.zoom))),
  }
}

/** True when the map has something worth generating code for. */
export function hasVisibleLayers(): boolean {
  return useSpatialStore.getState().layers.some((l) => l.visible)
}

/** Which generator the user last reached for in the Export dropdown. */
export function lastExportEngine(): MapEngine {
  return useSpatialSettingsStore.getState().lastExportMode
}

export interface MapExportOptions {
  engine: MapEngine
  /** Also emit the generator's own save call, writing the figure to `path`. */
  exportOpts?: Parameters<typeof generateTmapCode>[0]['exportOpts']
}

/** The current map as standalone R. Returns null when the map is empty. */
export function generateMapCode({ engine, exportOpts }: MapExportOptions): string | null {
  if (!hasVisibleLayers()) return null
  const params = exportOpts ? { ...mapCodeParams(), exportOpts } : mapCodeParams()
  return (engine === 'tmap' ? generateTmapCode(params) : generateGgplotCode(params)).trimEnd()
}
