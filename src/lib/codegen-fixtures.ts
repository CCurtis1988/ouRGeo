// Shared test fixtures for the ggplot2 / tmap code generators.
import type { SpatialLayer, LegendSettings, NorthArrowSettings, RasterSymbology } from '@/store/spatial'
import type { GgplotCodeParams } from '@/lib/ggplot-codegen'
import type { TmapCodeParams } from '@/lib/tmap-codegen'

export const makeLayer = (over: Partial<SpatialLayer> = {}): SpatialLayer => ({
  id: 'l1', name: 'roads', envName: '.GlobalEnv', geometryType: 'POLYGON',
  geojson: { type: 'FeatureCollection', features: [] },
  visible: true, color: '#3388ff', opacity: 1, colLib: 'sf', columnName: 'geometry',
  ...over,
})

export const makeRasterLayer = (
  symOver: Partial<RasterSymbology> = {},
  over: Partial<SpatialLayer> = {},
): SpatialLayer => ({
  id: 'r1', name: 'dem', envName: '.GlobalEnv', geometryType: 'RASTER',
  geojson: { type: 'FeatureCollection', features: [] },
  visible: true, color: '#3388ff', opacity: 1, colLib: 'sf', columnName: '',
  kind: 'raster',
  raster: {
    layerId: 'rl_test_1',
    version: 1,
    bounds: [5.7, 49.4, 6.5, 50.2],
    maxzoom: 12,
    meta: {
      bands: [
        { index: 1, name: 'elevation', min: 141, max: 547, mean: 348, sd: 90, q02: 200, q98: 503, categorical: false },
        { index: 2, name: 'nir', min: 0, max: 255, mean: 120, sd: 40, q02: 5, q98: 250, categorical: false },
        { index: 3, name: 'red', min: 0, max: 255, mean: 110, sd: 35, q02: 4, q98: 245, categorical: false },
      ],
      nbands: 3, nrow: 90, ncol: 95, dtype: 'INT2S', crs: 'EPSG:4326', nodata: null, approx: false,
    },
    symbology: {
      mode: 'singleband', bands: [1],
      stretch: { type: 'percent', pLow: 2, pHigh: 98, nStd: 2 },
      ramp: 'viridis', invertRamp: false,
      resampling: 'nearest', nodataTransparent: true,
      ...symOver,
    },
    stretchRange: { lo: [200], hi: [503] },
  },
  ...over,
})

const legendSettings: LegendSettings = {
  position: 'top-right', offsetX: 0, offsetY: 0, title: '', showTitle: false, titleSize: 12,
  bgColor: '#ffffff', bgOpacity: 1, showBorder: false, borderColor: '#000000', borderWidth: 1,
  borderRadius: 0, itemFontSize: 10, maxCategories: 10, catColumns: 1, maxWidth: 200, maxHeight: 300,
}

const northArrowSettings: NorthArrowSettings = {
  style: 'split', position: 'top-right', offsetX: 0, offsetY: 0, size: 40,
  primaryColor: '#000000', secondaryColor: '#ffffff', showLabel: false, labelColor: '#000000',
  labelSize: 12, opacity: 1,
}

const base = {
  viewState: { longitude: 0, latitude: 0, zoom: 5 },
  viewBbox: null,
  showLegend: false,
  legendSettings,
  showNorthArrow: false,
  northArrowSettings,
  basemapId: 'none',
  activeView: false,
}

export const makeGgplotParams = (over: Partial<GgplotCodeParams> = {}): GgplotCodeParams => ({
  layers: [makeLayer()], ...base, ...over,
})

export const makeTmapParams = (over: Partial<TmapCodeParams> = {}): TmapCodeParams => ({
  layers: [makeLayer()], ...base, ...over,
})
