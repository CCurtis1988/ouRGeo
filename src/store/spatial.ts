import { create } from 'zustand'

export type PointShape = 'circle' | 'square' | 'triangle' | 'cross' | 'diamond'
export type LineDash = 'solid' | 'dashed' | 'dotted'

export interface ColorBinding {
  column: string
  type: 'numeric' | 'categorical'
  scale: string
}

export interface LayerSymbology {
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderWidth: number
  haloColor: string
  haloStrength: number
  pointSize: number
  pointShape: PointShape
  lineWidth: number
  lineDash: LineDash
  fillColorBinding?: ColorBinding
  borderColorBinding?: ColorBinding
  haloColorBinding?: ColorBinding
}

export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type NorthArrowStyle = 'split' | 'simple' | 'open' | 'dot' | 'compass'

export interface LegendSettings {
  position:      OverlayPosition
  offsetX:       number
  offsetY:       number
  title:         string
  showTitle:     boolean
  titleSize:     number
  bgColor:       string
  bgOpacity:     number
  showBorder:    boolean
  borderColor:   string
  borderWidth:   number
  borderRadius:  number
  itemFontSize:  number
  maxCategories: number
  catColumns:    1 | 2
  maxWidth:      number
  maxHeight:     number
}

export interface NorthArrowSettings {
  style:          NorthArrowStyle
  position:       OverlayPosition
  offsetX:        number
  offsetY:        number
  size:           number
  primaryColor:   string
  secondaryColor: string
  showLabel:      boolean
  labelColor:     string
  labelSize:      number
  opacity:        number
}

export const DEFAULT_LEGEND_SETTINGS: LegendSettings = {
  position: 'bottom-left', offsetX: 16, offsetY: 16,
  title: 'Legend', showTitle: true, titleSize: 11,
  bgColor: '#161b22', bgOpacity: 0.95,
  showBorder: true, borderColor: '#21262d', borderWidth: 1, borderRadius: 8,
  itemFontSize: 11, maxCategories: 8, catColumns: 1,
  maxWidth: 220, maxHeight: 288,
}

export const DEFAULT_NORTH_ARROW_SETTINGS: NorthArrowSettings = {
  style: 'split', position: 'top-right', offsetX: 16, offsetY: 16,
  size: 22, primaryColor: '#e6edf3', secondaryColor: '#0f1117',
  showLabel: true, labelColor: '#8b949e', labelSize: 9, opacity: 1,
}

export interface SpatialObjectInfo {
  name: string
  envName: string
  class: string
  geometryType: string
  nFeatures: number
  crs: string | null
  sfColumn?: string
  /** SpatRaster listings only. */
  nBands?: number
  dims?: [number, number]
}

// ---------------------------------------------------------------------------
// Raster layers — rendered as R-served XYZ tiles (see r/lib/handlers-raster.R)

export interface RasterBandInfo {
  index: number
  name: string
  min: number
  max: number
  mean: number
  sd: number
  q02: number
  q98: number
  categorical: boolean
  levels?: { value: number; label: string; color: string }[]
}

export interface RasterMeta {
  bands: RasterBandInfo[]
  nbands: number
  nrow: number
  ncol: number
  dtype: string
  crs: string | null
  nodata: number | null
  approx: boolean
}

export interface RasterStretch {
  type: 'minmax' | 'percent' | 'stddev' | 'custom'
  pLow: number
  pHigh: number
  nStd: number
  min?: number[]
  max?: number[]
}

/**
 * Mirrors the server symbology payload; `ramp` is a SEQUENTIAL_SCALES key the
 * renderer resolves into `colormap` hex stops before sending to R. Grayscale
 * is singleband with the built-in black→white ramp.
 */
export interface RasterSymbology {
  mode: 'singleband' | 'rgb' | 'categorical'
  bands: number[]                 // [b] or [r,g,b], 1-based
  stretch: RasterStretch
  ramp: string
  invertRamp: boolean
  categories?: { value: number; label: string; color: string }[]
  resampling: 'nearest' | 'bilinear'
  nodataTransparent: boolean
}

export const DEFAULT_RASTER_SYMBOLOGY: RasterSymbology = {
  mode: 'singleband',
  bands: [1],
  stretch: { type: 'percent', pLow: 2, pHigh: 98, nStd: 2 },
  ramp: 'viridis',
  invertRamp: false,
  resampling: 'nearest',
  nodataTransparent: true,
}

export interface RasterLayerInfo {
  /** R-server registration id (session-scoped; refreshed on rehydration). */
  layerId: string
  /** Bumped by the server on every symbology change — tile cache-bust. */
  version: number
  /** 4326 [w, s, e, n]. */
  bounds: [number, number, number, number]
  maxzoom: number
  meta: RasterMeta
  symbology: RasterSymbology
  /** Resolved stretch lo/hi the server is currently rendering with. */
  stretchRange?: { lo: number[]; hi: number[] }
}

export interface LabelSettings {
  enabled: boolean
  field: string
  fontSize: number
  fontFamily: 'Open Sans' | 'Noto Sans' | 'Arial Unicode MS'
  bold: boolean
  italic: boolean
  color: string
  opacity: number
  haloColor: string
  haloWidth: number
  haloBlur: number
  anchor: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  offsetX: number
  offsetY: number
  overlapStrategy: 'never' | 'cooperative' | 'always'
  textTransform: 'none' | 'uppercase' | 'lowercase'
  letterSpacing: number
  maxWidth: number
  symbolSpacing: number
  minZoom: number
}

// When set, this layer is database-backed: features are streamed from
// /dataset/spatial-tile based on viewport bbox rather than loaded as a
// single GeoJSON dump. `geojson` then represents only the currently
// visible tile, refreshed on map move/zoom.
export interface SpatialTileSource {
  handle: string
  name: string
  geometryColumn: string
  pkColumn: string
  crs: string | null
  fullBbox?: [number, number, number, number] | null
  truncated?: boolean
}

export interface PendingGeometryEdit {
  /** DB groups: primary-key value. Memory groups: 0-based row index. */
  rowId: number
  /** 'geometry' = staged geometry change; 'row-add' = row already appended in R, tracked for undo/report. */
  kind?: 'geometry' | 'row-add'
  /** WKT written to the object: curve-preserving for memory sf groups, linearized for DB/geos. */
  wkt?: string
  /** DB groups only: exact curved WKT for the _rgeo_wkt_true companion column. */
  wktTrue?: string
  // Local copy of the edited geometry so we can re-apply it onto a tile that
  // was just refetched from the DB (which still holds pre-save data). Without
  // this, viewport refetches would clobber unsaved edits.
  geometry?: GeoJSON.Geometry
  // Pre-edit geometry captured the FIRST time this rowId enters the queue,
  // so Discard can revert the visible map without a refetch round-trip.
  originalGeometry?: GeoJSON.Geometry | null
  originalWkt?: string
}

/**
 * Identity of a pending-edit group: one edited object. Memory groups write
 * back as batched R on Save; database groups flush via /dataset/update-geometry.
 */
export interface PendingEditMeta {
  source: 'memory' | 'database'
  /** Set when the object is shown as a map layer (group key = layer id). */
  layerId?: string
  accessPath: string
  envName: string
  columnName: string
  colLib: 'sf' | 'geos'
}

/** Group key for staged edits: the layer id when on-map, else a synthetic memory key. */
export function pendingGroupKey(meta: { layerId?: string; accessPath: string; envName: string }): string {
  return meta.layerId ?? `mem::${meta.accessPath}::${meta.envName}`
}

export interface SpatialLayer {
  id: string
  name: string
  envName: string
  geometryType: string
  /**
   * Vector features. Raster layers carry an empty FeatureCollection so the
   * many `layer.geojson.features` consumers (lasso, legend column readers,
   * coordinate walkers) no-op naturally.
   */
  geojson: GeoJSON.FeatureCollection
  visible: boolean
  color: string
  opacity: number
  colLib: 'sf' | 'geos'
  columnName: string
  /** Defaults to 'vector' when absent (all pre-raster persisted layers). */
  kind?: 'vector' | 'raster'
  raster?: RasterLayerInfo
  symbology?: LayerSymbology
  labelSettings?: LabelSettings
  tileSource?: SpatialTileSource
}

/** Empty FeatureCollection used as the geojson of raster layers. */
export const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

export function isRasterLayer(l: SpatialLayer): boolean {
  return l.kind === 'raster'
}

const LAYER_COLORS = [
  '#4493f8', '#3fb950', '#f85149', '#d29922',
  '#a371f7', '#f778ba', '#79c0ff', '#56d364'
]

interface SpatialState {
  isOpen: boolean
  layers: SpatialLayer[]
  selectedLayerId: string | null
  viewState: { longitude: number; latitude: number; zoom: number }
  isLoadingFeatures: boolean
  availableObjects: SpatialObjectInfo[]
  addFeaturesDialogOpen: boolean
  showLegend: boolean
  showNorthArrow: boolean
  legendSettings: LegendSettings
  northArrowSettings: NorthArrowSettings

  toggleOpen: () => void
  addLayer: (layer: Omit<SpatialLayer, 'id' | 'color' | 'opacity' | 'visible'>) => string
  updateRasterInfo: (id: string, raster: RasterLayerInfo) => void
  setLayerOpacity: (id: string, opacity: number) => void
  removeLayer: (id: string) => void
  toggleLayerVisibility: (id: string) => void
  setSelectedLayerId: (id: string | null) => void
  setViewState: (vs: { longitude: number; latitude: number; zoom: number }) => void
  setIsLoadingFeatures: (loading: boolean) => void
  setAvailableObjects: (objects: SpatialObjectInfo[]) => void
  /** Which map asked for the Add Features dialog. With two Spatial Editors
   *  mounted, a bare boolean opens the dialog in BOTH of them. */
  addFeaturesPanel: string | null
  setAddFeaturesDialogOpen: (open: boolean, panelId?: string) => void
  ensureOpen: () => void
  updateLayerFeature: (layerId: string, featureIndex: number, geometry: GeoJSON.Geometry | null) => void
  appendLayerFeature: (layerId: string, geometry: GeoJSON.Geometry) => void
  removeLayerFeatures: (layerId: string, indices: number[]) => void
  updateLayerSymbology: (id: string, symbology: LayerSymbology) => void
  updateLabelSettings: (layerId: string, settings: LabelSettings) => void
  reorderLayers: (orderedIds: string[]) => void
  fitBoundsSignal: number
  requestFitBounds: (panelId?: string) => void
  // Fit the map to an explicit 4326 bbox (data viewer "zoom to row/selection/
  // extent"). The signal bumps so SpatialEditor re-fits even to the same bbox.
  fitTarget: [number, number, number, number] | null
  fitTargetSignal: number
  /**
   * Which Spatial Editor the pending fit is aimed at; null means all of them.
   *
   * With one map this was a signal every map obeyed, which is the same thing.
   * With two it is not: sending a layer to the second map and having the FIRST
   * one jump to it is a move the user did not ask for, in a panel they were
   * not looking at, and it also loses wherever that map was pointed.
   */
  fitTargetPanel: string | null
  fitMapToBbox: (bbox: [number, number, number, number], panelId?: string) => void
  setShowLegend: (v: boolean) => void
  setShowNorthArrow: (v: boolean) => void
  setLegendSettings: (s: LegendSettings) => void
  setNorthArrowSettings: (s: NorthArrowSettings) => void
  viewBbox: [number, number, number, number] | null
  setViewBbox: (bbox: [number, number, number, number] | null) => void

  // Unified edit-session staging: geometry edits for BOTH in-memory R objects
  // and database-backed layers stage here until the user explicitly saves.
  // Memory groups write back as one batched R statement (echoed to console);
  // db groups flush through /dataset/update-geometry. Discarding restores
  // the originals. Keyed by pendingGroupKey(meta).
  pendingGeometryEdits: Record<string, PendingGeometryEdit[]>
  pendingEditMeta: Record<string, PendingEditMeta>
  addPendingGeometryEdit: (meta: PendingEditMeta, edit: PendingGeometryEdit) => void
  // Atomic stage-and-replace: queues a pending edit AND replaces the feature
  // geometry on the in-memory layer in a single store mutation. Subscribers
  // see one transition instead of two, avoiding cross-store interleavings
  // during the Complete Drawing click.
  commitGeometryEdit: (meta: PendingEditMeta, featureIndex: number, edit: PendingGeometryEdit) => void
  /** Undo support: put back the previous staged entry (or remove it) and restore the shown geometry. */
  restoreStagedEdit: (
    groupKey: string,
    rowId: number,
    prevPending: PendingGeometryEdit | null,
    prevGeometry: GeoJSON.Geometry | null
  ) => void
  /** Remove every staged entry for a rowId (used when a row-add is undone). */
  unstageRow: (groupKey: string, rowId: number) => void
  clearPendingGeometryEdits: (groupKey: string) => void
  discardPendingGeometryEdits: (groupKey: string) => void
  discardAllPendingGeometryEdits: () => void
  setLayerTileGeoJSON: (layerId: string, geojson: GeoJSON.FeatureCollection, truncated?: boolean) => void
  setLayerFullBbox: (layerId: string, bbox: [number, number, number, number]) => void
  // Bumped by the Save flush handler so subscribers (useDbSpatialTile) drop
  // their cached tile key and re-fetch from the DB now that pending edits
  // are committed.
  tileCacheVersion: Record<string, number>
  bumpTileCacheVersion: (layerId: string) => void
}

export const useSpatialStore = create<SpatialState>((set, get) => ({
  isOpen: false,
  layers: [],
  selectedLayerId: null,
  viewState: { longitude: 0, latitude: 20, zoom: 2 },
  isLoadingFeatures: false,
  availableObjects: [],
  addFeaturesDialogOpen: false,
  addFeaturesPanel: null,
  showLegend: false,
  showNorthArrow: false,
  legendSettings: DEFAULT_LEGEND_SETTINGS,
  northArrowSettings: DEFAULT_NORTH_ARROW_SETTINGS,
  viewBbox: null,
  pendingGeometryEdits: {},
  pendingEditMeta: {},
  tileCacheVersion: {},

  addPendingGeometryEdit: (meta, edit) =>
    set((s) => {
      const key = pendingGroupKey(meta)
      const existing = s.pendingGeometryEdits[key] ?? []
      const kind = edit.kind ?? 'geometry'
      let next: PendingGeometryEdit[]
      if (kind === 'row-add') {
        next = [...existing, { ...edit, kind }]
      } else {
        const prior = existing.find((e) => e.rowId === edit.rowId && (e.kind ?? 'geometry') === 'geometry')
        // Replace any prior geometry edit for the same rowId so we only write
        // the latest geometry per row when the user hits Save — but preserve
        // the first-captured originalGeometry so Discard always reverts to
        // the last-saved state, not an intermediate edit.
        const merged: PendingGeometryEdit = {
          ...edit,
          kind,
          originalGeometry: prior?.originalGeometry ?? edit.originalGeometry ?? null
        }
        next = [
          ...existing.filter((e) => !(e.rowId === edit.rowId && (e.kind ?? 'geometry') === 'geometry')),
          merged
        ]
      }
      return {
        pendingGeometryEdits: { ...s.pendingGeometryEdits, [key]: next },
        pendingEditMeta: { ...s.pendingEditMeta, [key]: meta }
      }
    }),

  commitGeometryEdit: (meta, featureIndex, edit) =>
    set((s) => {
      const key = pendingGroupKey(meta)
      const layers = s.layers.map((l) => {
        if (l.id !== meta.layerId) return l
        if (featureIndex < 0 || featureIndex >= l.geojson.features.length) return l
        const features = l.geojson.features.map((f, i) =>
          i === featureIndex ? { ...f, geometry: edit.geometry as GeoJSON.Geometry } : f
        )
        return { ...l, geojson: { ...l.geojson, features } }
      })
      const existing = s.pendingGeometryEdits[key] ?? []
      const prior = existing.find((e) => e.rowId === edit.rowId && (e.kind ?? 'geometry') === 'geometry')
      const merged: PendingGeometryEdit = {
        ...edit,
        kind: 'geometry',
        originalGeometry: prior?.originalGeometry ?? edit.originalGeometry ?? null
      }
      const nextEdits = [
        ...existing.filter((e) => !(e.rowId === edit.rowId && (e.kind ?? 'geometry') === 'geometry')),
        merged
      ]
      return {
        layers,
        pendingGeometryEdits: { ...s.pendingGeometryEdits, [key]: nextEdits },
        pendingEditMeta: { ...s.pendingEditMeta, [key]: meta }
      }
    }),

  restoreStagedEdit: (groupKey, rowId, prevPending, prevGeometry) =>
    set((s) => {
      const existing = s.pendingGeometryEdits[groupKey] ?? []
      const filtered = existing.filter(
        (e) => !(e.rowId === rowId && (e.kind ?? 'geometry') === 'geometry')
      )
      const nextEdits = prevPending ? [...filtered, prevPending] : filtered
      const meta = s.pendingEditMeta[groupKey]
      const layers = meta?.layerId
        ? s.layers.map((l) => {
            if (l.id !== meta.layerId) return l
            const idx = l.geojson.features.findIndex((f) => f.id === rowId)
            if (idx < 0) return l
            const features = l.geojson.features.map((f, i) =>
              i === idx ? { ...f, geometry: prevGeometry as GeoJSON.Geometry } : f
            )
            return { ...l, geojson: { ...l.geojson, features } }
          })
        : s.layers
      const pendingGeometryEdits = { ...s.pendingGeometryEdits }
      const pendingEditMeta = { ...s.pendingEditMeta }
      if (nextEdits.length > 0) pendingGeometryEdits[groupKey] = nextEdits
      else {
        delete pendingGeometryEdits[groupKey]
        delete pendingEditMeta[groupKey]
      }
      return { layers, pendingGeometryEdits, pendingEditMeta }
    }),

  unstageRow: (groupKey, rowId) =>
    set((s) => {
      const existing = s.pendingGeometryEdits[groupKey]
      if (!existing) return {}
      const nextEdits = existing.filter((e) => e.rowId !== rowId)
      const pendingGeometryEdits = { ...s.pendingGeometryEdits }
      const pendingEditMeta = { ...s.pendingEditMeta }
      if (nextEdits.length > 0) pendingGeometryEdits[groupKey] = nextEdits
      else {
        delete pendingGeometryEdits[groupKey]
        delete pendingEditMeta[groupKey]
      }
      return { pendingGeometryEdits, pendingEditMeta }
    }),

  clearPendingGeometryEdits: (groupKey) =>
    set((s) => {
      if (!(groupKey in s.pendingGeometryEdits)) return {}
      const nextEdits = { ...s.pendingGeometryEdits }
      const nextMeta = { ...s.pendingEditMeta }
      delete nextEdits[groupKey]
      delete nextMeta[groupKey]
      return { pendingGeometryEdits: nextEdits, pendingEditMeta: nextMeta }
    }),

  discardPendingGeometryEdits: (groupKey) => {
    const state = get()
    const pending = state.pendingGeometryEdits[groupKey]
    if (!pending?.length) return
    const meta = state.pendingEditMeta[groupKey]
    const layer = meta?.layerId ? state.layers.find((l) => l.id === meta.layerId) : undefined
    // Clear queue first to avoid setLayerTileGeoJSON re-applying the edit
    // on top of the restored geometry if a tile fetch lands concurrently.
    state.clearPendingGeometryEdits(groupKey)
    if (layer) {
      for (const e of pending) {
        if ((e.kind ?? 'geometry') !== 'geometry') continue
        const idx = layer.geojson.features.findIndex((f) => f.id === e.rowId)
        if (idx >= 0) state.updateLayerFeature(layer.id, idx, e.originalGeometry ?? null)
      }
      if (layer.tileSource) state.bumpTileCacheVersion(layer.id)
    }
  },

  discardAllPendingGeometryEdits: () => {
    const ids = Object.keys(get().pendingGeometryEdits)
    for (const id of ids) get().discardPendingGeometryEdits(id)
  },

  setLayerTileGeoJSON: (layerId, geojson, truncated) =>
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l
        const pkColumn = l.tileSource?.pkColumn
        const pending = s.pendingGeometryEdits[layerId] ?? []
        const editsById = new Map<number, PendingGeometryEdit>()
        for (const e of pending) {
          if ((e.kind ?? 'geometry') === 'geometry') editsById.set(e.rowId, e)
        }
        // Key features by their actual primary-key value (so update-geometry
        // can target the correct DB row), then re-apply any unsaved edits on
        // top of the freshly fetched tile so the user's in-progress work
        // doesn't snap back to pre-edit state on pan/zoom.
        const indexedFeatures = geojson.features.map((f, i) => {
          let featureId: number = i
          if (pkColumn) {
            const props = (f.properties ?? {}) as Record<string, unknown>
            const pkVal = props[pkColumn]
            const asNum = typeof pkVal === 'number' ? pkVal : Number(pkVal)
            if (Number.isFinite(asNum)) featureId = asNum
          }
          const edit = editsById.get(featureId)
          const geometry = edit?.geometry ?? f.geometry
          return { ...f, id: featureId, geometry }
        })
        const tileSource = l.tileSource
          ? { ...l.tileSource, truncated: truncated ?? false }
          : l.tileSource
        return {
          ...l,
          geojson: { ...geojson, features: indexedFeatures },
          tileSource
        }
      })
    })),

  setLayerFullBbox: (layerId, bbox) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id !== layerId || !l.tileSource
          ? l
          : { ...l, tileSource: { ...l.tileSource, fullBbox: bbox } }
      )
    })),

  bumpTileCacheVersion: (layerId) =>
    set((s) => ({
      tileCacheVersion: {
        ...s.tileCacheVersion,
        [layerId]: (s.tileCacheVersion[layerId] ?? 0) + 1
      }
    })),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),

  addLayer: (layer) => {
    const colorIndex = get().layers.length % LAYER_COLORS.length
    const indexedFeatures = layer.geojson.features.map((f, i) => ({ ...f, id: i }))
    const newId = `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newLayer: SpatialLayer = {
      ...layer,
      geojson: { ...layer.geojson, features: indexedFeatures },
      id: newId,
      color: LAYER_COLORS[colorIndex],
      // Rasters render at full strength by default; vectors stay translucent
      // so overlapping features read.
      opacity: layer.kind === 'raster' ? 1 : 0.7,
      visible: true
    }
    set((s) => ({ layers: [...s.layers, newLayer] }))
    return newId
  },

  updateRasterInfo: (id, raster) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, raster } : l))
    })),

  setLayerOpacity: (id, opacity) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l))
    })),

  removeLayer: (id) =>
    set((s) => {
      const nextPending = { ...s.pendingGeometryEdits }
      delete nextPending[id]
      const nextCache = { ...s.tileCacheVersion }
      delete nextCache[id]
      return {
        layers: s.layers.filter((l) => l.id !== id),
        selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
        pendingGeometryEdits: nextPending,
        tileCacheVersion: nextCache
      }
    }),

  toggleLayerVisibility: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    })),

  setSelectedLayerId: (id) => set({ selectedLayerId: id }),
  setViewState: (viewState) => set({ viewState }),
  setIsLoadingFeatures: (isLoadingFeatures) => set({ isLoadingFeatures }),
  setAvailableObjects: (availableObjects) => set({ availableObjects }),
  setAddFeaturesDialogOpen: (addFeaturesDialogOpen, panelId) =>
    set({ addFeaturesDialogOpen, addFeaturesPanel: panelId ?? null }),
  ensureOpen: () => set((s) => s.isOpen ? {} : { isOpen: true }),

  updateLayerFeature: (layerId, featureIndex, geometry) =>
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l
        if (featureIndex < 0 || featureIndex >= l.geojson.features.length) return l
        const features = l.geojson.features.map((f, i) =>
          i === featureIndex ? { ...f, geometry: geometry as GeoJSON.Geometry } : f
        )
        return { ...l, geojson: { ...l.geojson, features } }
      })
    })),

  appendLayerFeature: (layerId, geometry) =>
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l
        const newFeature: GeoJSON.Feature = {
          type: 'Feature',
          id: l.geojson.features.length,
          properties: {},
          geometry
        }
        return { ...l, geojson: { ...l.geojson, features: [...l.geojson.features, newFeature] } }
      })
    })),

  removeLayerFeatures: (layerId, indices) =>
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l
        const toRemove = new Set(indices)
        const remaining = l.geojson.features.filter((_, i) => !toRemove.has(i))
        const reindexed = remaining.map((f, i) => ({ ...f, id: i }))
        return { ...l, geojson: { ...l.geojson, features: reindexed } }
      })
    })),

  updateLayerSymbology: (id, symbology) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, symbology } : l))
    })),

  updateLabelSettings: (layerId, settings) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === layerId ? { ...l, labelSettings: settings } : l))
    })),

  reorderLayers: (orderedIds) =>
    set((s) => {
      const byId = Object.fromEntries(s.layers.map((l) => [l.id, l]))
      return { layers: orderedIds.filter((id) => byId[id]).map((id) => byId[id]) }
    }),

  fitBoundsSignal: 0,
  requestFitBounds: (panelId) =>
    set((s) => ({ fitBoundsSignal: s.fitBoundsSignal + 1, fitTargetPanel: panelId ?? null })),
  fitTarget: null,
  fitTargetSignal: 0,
  fitTargetPanel: null,
  fitMapToBbox: (bbox, panelId) => set((s) => ({
    fitTarget: bbox, fitTargetSignal: s.fitTargetSignal + 1, fitTargetPanel: panelId ?? null,
  })),
  setShowLegend: (showLegend) => set({ showLegend }),
  setShowNorthArrow: (showNorthArrow) => set({ showNorthArrow }),
  setLegendSettings: (legendSettings) => set({ legendSettings }),
  setNorthArrowSettings: (northArrowSettings) => set({ northArrowSettings }),
  setViewBbox: (viewBbox) => set({ viewBbox }),
}))
