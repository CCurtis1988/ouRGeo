import { familyIsPolygon, familyIsLine } from '@/lib/geometry-family'
import React, { useRef, useCallback, useImperativeHandle, forwardRef, useMemo, useEffect, useState } from 'react'
import Map, { Source, Layer, MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import maplibregl from 'maplibre-gl'
import { useSpatialStore } from '@/store/spatial'
import { useSelectionStore, type PendingCandidate } from '@/store/selection'
import { candidateLabel } from '@/lib/selection-apply'
import { useIdentifyStore } from '@/store/identify'
import { buildIdentifyTargets, rasterBoundsHit, type RasterHit } from '@/lib/identify-targets'
import { generatePointIcon } from '@/lib/point-icons'
import { getEffectiveSym } from '@/lib/layer-symbology'
import { buildColorExpression } from '@/lib/color-scales'
import { parseFieldTemplate, resolveFont } from '@/lib/label-utils'
import { rasterTileUrl } from '@/lib/raster-layers'
import type { ColorBinding, SpatialLayer } from '@/store/spatial'
import { useGeometryEditStore, selectActiveSession, selectActiveSessionLayerIds, selectActiveSessionViewState } from '@/store/geometryEdit'
import { useThemeStore } from '@/store/theme'
import { useBasemapStore } from '@/store/basemap'
import { useApiKeysStore } from '@/store/apiKeys'
import { resolveBasemapStyle, themeDefaultBasemap } from '@/lib/basemaps'
import type { SnapType } from '@/store/geometryEdit'
import { useDrawInteractions } from '@/hooks/useDrawInteractions'
import { DrawingLayer } from './DrawingLayer'
import { SelectionHighlight } from './SelectionHighlight'
import { PendingEditsHighlight } from './PendingEditsHighlight'
import 'maplibre-gl/dist/maplibre-gl.css'

export interface MapViewHandle {
  fitBounds: (bbox: [number, number, number, number]) => void
  zoomIn: () => void
  zoomOut: () => void
  getMap: () => maplibregl.Map | null
}

// reserved for future external lasso point consumers
export type MapViewProps = object

// ── Lasso geometry helpers ────────────────────────────────────────────────────

/** Ray-casting point-in-polygon test. */
function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [px, py] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Collect all coordinate vertices from a geometry. */
function extractCoords(geometry: GeoJSON.Geometry): [number, number][] {
  const coords: [number, number][] = []
  function walk(c: unknown) {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') { coords.push([c[0] as number, c[1] as number]); return }
    for (const item of c) walk(item)
  }
  if ('coordinates' in geometry) walk(geometry.coordinates)
  else if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) coords.push(...extractCoords(g))
  }
  return coords
}

/** Returns true if any vertex of the feature geometry is inside the lasso polygon. */
function featureInLasso(geometry: GeoJSON.Geometry, lasso: [number, number][]): boolean {
  if (lasso.length < 3) return false
  const vertices = extractCoords(geometry)
  if (vertices.length === 0) return false
  // For polygons / lines: any vertex inside → selected
  return vertices.some(v => pointInPolygon(v, lasso))
}

// ── Point-select helpers ──────────────────────────────────────────────────────

/** Pixel half-width of the point-select hit box (tolerance for points/lines). */
const HIT_TOLERANCE_PX = 5

/** Render-layer id suffixes to hit-test, primary style layer per geometry. */
const HIT_SUFFIXES = ['fill', 'fill-line', 'circle', 'symbol'] as const

function visibleVectorEntries(layers: SpatialLayer[]): { accessPath: string; envName: string }[] {
  return layers
    .filter((l) => l.visible && l.kind !== 'raster')
    .map((l) => ({ accessPath: l.name, envName: l.envName }))
}

/**
 * Hit-test every visible vector layer's primary style layer(s) with a small
 * tolerance box around a screen point. Returns per-layer sorted row indices in
 * layer stacking order. Shared by point-select and identify. (Plain objects,
 * not `Map`/`Set` maps — the react-map-gl `Map` component shadows the global
 * `Map` constructor in this module.)
 */
function collectVectorHits(
  map: maplibregl.Map,
  layers: SpatialLayer[],
  point: { x: number; y: number },
): { layer: SpatialLayer; indices: number[] }[] {
  const renderIdToLayer: Record<string, SpatialLayer> = {}
  for (const layer of layers) {
    if (!layer.visible || layer.kind === 'raster') continue
    for (const suffix of HIT_SUFFIXES) {
      const rid = `${layer.id}-${suffix}`
      if (map.getLayer(rid)) renderIdToLayer[rid] = layer
    }
  }
  const renderIds = Object.keys(renderIdToLayer)
  if (renderIds.length === 0) return []
  const hits = map.queryRenderedFeatures(
    [
      [point.x - HIT_TOLERANCE_PX, point.y - HIT_TOLERANCE_PX],
      [point.x + HIT_TOLERANCE_PX, point.y + HIT_TOLERANCE_PX],
    ],
    { layers: renderIds }
  )
  // Dedupe per layer (fill + line layers of one feature both hit); feature.id
  // is the row index (assigned on load in the spatial store).
  const perLayer: Record<string, Set<number>> = {}
  for (const f of hits) {
    const layer = renderIdToLayer[f.layer.id]
    if (!layer || typeof f.id !== 'number') continue
    ;(perLayer[layer.id] ??= new Set()).add(f.id)
  }
  const out: { layer: SpatialLayer; indices: number[] }[] = []
  for (const layer of layers) {
    const set = perLayer[layer.id]
    if (set) out.push({ layer, indices: [...set].sort((a, b) => a - b) })
  }
  return out
}

// Custom SVG cursor data URIs for snap feedback.
// Each is 24×24px with a black outer stroke (visibility on light bg) and white inner stroke.
const SNAP_CURSORS: Record<SnapType, string> = {
  'vertex': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='8' fill='none' stroke='black' stroke-width='3.5'/%3E%3Ccircle cx='12' cy='12' r='8' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`,
  'edge': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect x='4' y='4' width='16' height='16' fill='none' stroke='black' stroke-width='3.5'/%3E%3Crect x='4' y='4' width='16' height='16' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`,
  'midpoint': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpolygon points='12,2 22,22 2,22' fill='none' stroke='black' stroke-width='3.5'/%3E%3Cpolygon points='12,2 22,22 2,22' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`,
  'intersection': `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M4 4 L20 20 M20 4 L4 20' fill='none' stroke='black' stroke-width='3.5'/%3E%3Cpath d='M4 4 L20 20 M20 4 L4 20' fill='none' stroke='white' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`,
}


const DASH_ARRAYS: Record<string, number[] | undefined> = {
  solid:  undefined,
  dashed: [6, 3],
  dotted: [1.5, 3],
}

function resolveColor(
  binding: ColorBinding | undefined,
  fixedColor: string,
  features: GeoJSON.Feature[]
): string | unknown[] {
  if (!binding) return fixedColor
  return buildColorExpression(binding, features, fixedColor)
}

function layerStyle(layer: SpatialLayer): React.ReactElement[] {
  const gt = layer.geometryType.toUpperCase()
  const s = getEffectiveSym(layer)
  const els: React.ReactElement[] = []
  const id = layer.id
  const feats = layer.geojson.features

  const fillColor  = resolveColor(s.fillColorBinding,   s.fillColor,   feats)
  const borderColor = resolveColor(s.borderColorBinding, s.borderColor, feats)
  const haloColor  = resolveColor(s.haloColorBinding,   s.haloColor,   feats)

  if (familyIsPolygon(gt)) {
    // 1. fill
    els.push(
      <Layer key={`${id}-fill`} id={`${id}-fill`} type="fill"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paint={{ 'fill-color': fillColor as any, 'fill-opacity': s.fillOpacity }} />
    )
    // 2. halo (rendered before border so border sits on top)
    if (s.haloStrength > 0) {
      els.push(
        <Layer key={`${id}-halo-line`} id={`${id}-halo-line`} type="line"
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'line-color': haloColor as any,
            'line-width': s.borderWidth + s.haloStrength * 2,
            'line-blur': 4,
            'line-opacity': 0.5,
          }} />
      )
    }
    // 3. border
    els.push(
      <Layer key={`${id}-border-line`} id={`${id}-border-line`} type="line"
        paint={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'line-color': borderColor as any,
          'line-width': s.borderWidth,
          'line-opacity': layer.opacity,
        }} />
    )
  } else if (familyIsLine(gt)) {
    // 1. halo
    if (s.haloStrength > 0) {
      els.push(
        <Layer key={`${id}-halo-line`} id={`${id}-halo-line`} type="line"
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'line-color': haloColor as any,
            'line-width': s.lineWidth + s.haloStrength * 2,
            'line-blur': 4,
            'line-opacity': 0.5,
          }} />
      )
    }
    // 2. border/casing
    if (s.borderWidth > 0) {
      els.push(
        <Layer key={`${id}-border-line`} id={`${id}-border-line`} type="line"
          paint={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'line-color': borderColor as any,
            'line-width': s.lineWidth + s.borderWidth * 2,
            'line-opacity': layer.opacity,
          }} />
      )
    }
    // 3. fill line
    const dashArray = DASH_ARRAYS[s.lineDash]
    els.push(
      <Layer key={`${id}-fill-line`} id={`${id}-fill-line`} type="line"
        paint={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'line-color': fillColor as any,
          'line-width': s.lineWidth,
          'line-opacity': layer.opacity,
          ...(dashArray ? { 'line-dasharray': dashArray } : {}),
        }} />
    )
  } else {
    // POINT
    // 1. halo
    if (s.haloStrength > 0) {
      els.push(
        <Layer key={`${id}-halo-circle`} id={`${id}-halo-circle`} type="circle"
          paint={{
            'circle-radius': s.pointSize + s.haloStrength,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'circle-color': haloColor as any,
            'circle-blur': 0.8,
            'circle-opacity': 0.55,
          }} />
      )
    }
    if (s.pointShape === 'circle') {
      // 2a. native circle — supports data-driven colors via expressions
      els.push(
        <Layer key={`${id}-circle`} id={`${id}-circle`} type="circle"
          paint={{
            'circle-radius': s.pointSize,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'circle-color': fillColor as any,
            'circle-opacity': layer.opacity,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'circle-stroke-color': borderColor as any,
            'circle-stroke-width': s.borderWidth,
          }} />
      )
    } else {
      // 2b. symbol with canvas-generated icon — data-driven color not supported
      els.push(
        <Layer key={`${id}-symbol`} id={`${id}-symbol`} type="symbol"
          layout={{
            'icon-image': `icon-${id}`,
            'icon-size': Math.max(0.1, s.pointSize / 16),
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }} />
      )
    }
  }

  // --- Label layer ---
  const ls = layer.labelSettings
  if (ls?.enabled && ls.field.trim()) {
    const isLine = familyIsLine(gt) && !familyIsPolygon(gt)
    els.push(
      <Layer
        key={`${id}-labels`}
        id={`${id}-labels`}
        type="symbol"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layout={{
          'text-field': parseFieldTemplate(ls.field) as any,
          'text-font': resolveFont(ls.fontFamily, ls.bold, ls.italic),
          'text-size': ls.fontSize,
          'text-anchor': isLine ? 'center' : ls.anchor,
          'text-offset': isLine ? [0, 0] : [ls.offsetX, ls.offsetY],
          'text-max-width': ls.maxWidth,
          'text-letter-spacing': ls.letterSpacing,
          'text-transform': ls.textTransform,
          'text-overlap': ls.overlapStrategy,
          'text-optional': true,
          'symbol-placement': isLine ? 'line' : 'point',
          ...(isLine ? { 'symbol-spacing': ls.symbolSpacing } : {}),
        } as any}
        paint={{
          'text-color': ls.color,
          'text-opacity': ls.opacity,
          'text-halo-color': ls.haloColor,
          'text-halo-width': ls.haloWidth,
          'text-halo-blur': ls.haloBlur,
        }}
        minzoom={ls.minZoom}
      />
    )
  }

  return els
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(_props, ref) {
  const mapRef = useRef<MapRef>(null)
  const allLayers = useSpatialStore((s) => s.layers)
  const sessionLayerIds = useGeometryEditStore(selectActiveSessionLayerIds)
  const session = useGeometryEditStore(selectActiveSession)
  // Show all layers whenever there's no active draw session. Filtering only
  // when a session is in-flight prevents the layer from unmounting for one
  // frame the instant Complete Drawing flips session→null (which used to
  // tear down the maplibre <Source> mid-commit and amplify churn).
  const layers = (sessionLayerIds === null || session === null)
    ? allLayers
    : allLayers.filter((l) => sessionLayerIds.includes(l.id))
  const overrideId = useBasemapStore((s) => s.overrideBasemapId)
  const currentTheme = useThemeStore((s) => s.current)
  const apiKeys = useApiKeysStore((s) => s.keys)
  // `themeRevision` moves when a user theme's contents change under a stable
  // id — the Theme Studio's basemap dropdown would otherwise take effect only
  // after switching themes and back.
  const themeRevision = useThemeStore((s) => s.revision)
  const mapStyle = useMemo(() => {
    const id = overrideId ?? themeDefaultBasemap(currentTheme)
    return resolveBasemapStyle(id, apiKeys)
    // `themeRevision` is a signal — `themeDefaultBasemap` reads the live theme
    // registry, so the closure has no visible dependency on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideId, currentTheme, apiKeys, themeRevision])
  const globalViewState = useSpatialStore((s) => s.viewState)
  const globalSetViewState = useSpatialStore((s) => s.setViewState)
  const sessionViewState = useGeometryEditStore(selectActiveSessionViewState)
  const setActiveSessionViewState = useGeometryEditStore((s) => s.setActiveSessionViewState)
  const viewState = sessionViewState ?? globalViewState
  const setViewState = sessionViewState !== null ? setActiveSessionViewState : globalSetViewState
  const isEditMode = useGeometryEditStore((s) => s.isEditMode)
  const draggingVertex = useGeometryEditStore((s) => s.draggingVertex)
  const snapTarget = useGeometryEditStore((s) => s.snapTarget)
  const selectMode = useSelectionStore((s) => s.selectMode)
  const isSelectActive = useSelectionStore((s) => s.isSelectActive)
  const setPending = useSelectionStore((s) => s.setPending)
  const applyPicksFn = useSelectionStore((s) => s.applyPicks)
  const isLassoArmed = isSelectActive && selectMode === 'lasso'
  const openIdentify = useIdentifyStore((s) => s.openIdentify)
  const closeIdentify = useIdentifyStore((s) => s.closeIdentify)
  // Idle = navigate/info mode: no select tool, no draw/edit session.
  const isIdle = !isSelectActive && session === null && !isEditMode
  // Pending single-click identify (debounced so a double-click-to-zoom cancels it).
  const identifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // All drawing/editing interaction is dispatched to the active tool
  const {
    handleClick: drawClick,
    handleDblClick: drawDblClick,
    handleMouseDown: drawMouseDown,
    handleMouseMove: drawMouseMove,
    handleMouseUp: drawMouseUp,
    handleMouseLeave: drawMouseLeave,
    handleContextMenu: drawContextMenu,
    cursor: drawCursor,
    suppressDoubleClickZoom
  } = useDrawInteractions(mapRef, layers)

  // Lasso state (transient, local only)
  const [isLassoing, setIsLassoing] = useState(false)
  const [lassoPoints, setLassoPoints] = useState<[number, number][]>([])
  const lassoRef = useRef<[number, number][]>([])
  const lassoMoveCount = useRef(0)

  // Interaction locks while a select tool is armed. Lasso needs the drag for
  // drawing; point select keeps pan but drops boxZoom so Shift (= add to
  // selection) can't trigger a shift-drag box zoom.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    if (isSelectActive) {
      if (selectMode === 'lasso') map.dragPan.disable()
      else map.dragPan.enable()
      map.boxZoom.disable()
    } else {
      map.dragPan.enable()
      map.boxZoom.enable()
      useSelectionStore.getState().setPending(null)
    }
    if (!isSelectActive || selectMode !== 'lasso') {
      setIsLassoing(false)
      setLassoPoints([])
      lassoRef.current = []
      lassoMoveCount.current = 0
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectActive, selectMode])

  // Register / update canvas-generated icons for non-circle point layers
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !map.loaded()) return
    for (const layer of layers) {
      const gt = layer.geometryType.toUpperCase()
      if (familyIsPolygon(gt) || familyIsLine(gt)) continue
      const s = getEffectiveSym(layer)
      if (s.pointShape === 'circle') continue
      const iconId = `icon-${layer.id}`
      const imageData = generatePointIcon(s)
      if (map.hasImage(iconId)) map.updateImage(iconId, imageData)
      else map.addImage(iconId, imageData)
    }
  }, [layers])

  useImperativeHandle(ref, () => ({
    fitBounds: (bbox: [number, number, number, number]) => {
      mapRef.current?.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]]
        ],
        { padding: 40, duration: 500 }
      )
    },
    zoomIn: () => mapRef.current?.zoomIn({ duration: 300 }),
    zoomOut: () => mapRef.current?.zoomOut({ duration: 300 }),
    getMap: () => mapRef.current?.getMap() ?? null,
  }))

  const onMove = useCallback(
    (evt: { viewState: { longitude: number; latitude: number; zoom: number } }) => {
      setViewState(evt.viewState)
      useSpatialStore.getState().setViewState(evt.viewState)
      const bounds = mapRef.current?.getBounds()
      if (bounds) {
        useSpatialStore.getState().setViewBbox([
          bounds.getWest(), bounds.getSouth(),
          bounds.getEast(), bounds.getNorth(),
        ])
      }
    },
    [setViewState]
  )

  // Identify (info) — hit-test vectors + rasters under the click and open the
  // info popup. Runs after the debounce in scheduleIdentify.
  const runIdentify = useCallback(
    (point: { x: number; y: number }, lngLat: { lng: number; lat: number }) => {
      const map = mapRef.current?.getMap()
      if (!map) return
      const vhits = collectVectorHits(map, allLayers, point).map(({ layer, indices }) => ({
        layerId: layer.id,
        layerName: layer.name,
        envName: layer.envName,
        indices,
      }))
      const rhits: RasterHit[] = []
      for (const layer of allLayers) {
        if (!layer.visible || layer.kind !== 'raster' || !layer.raster) continue
        if (rasterBoundsHit(lngLat.lng, lngLat.lat, layer.raster.bounds)) {
          rhits.push({ layerId: layer.id, layerName: layer.name, envName: layer.envName })
        }
      }
      const targets = buildIdentifyTargets(vhits, rhits)
      if (targets.length === 0) {
        closeIdentify() // clicking empty map dismisses the popup
        return
      }
      openIdentify({ targets, index: 0, anchor: point, lngLat })
    },
    [allLayers, openIdentify, closeIdentify]
  )

  const scheduleIdentify = useCallback(
    (e: MapLayerMouseEvent) => {
      if (e.originalEvent.shiftKey) return // Shift+drag is box-zoom, not identify
      if (identifyTimerRef.current) clearTimeout(identifyTimerRef.current)
      const point = { x: e.point.x, y: e.point.y }
      const lngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat }
      identifyTimerRef.current = setTimeout(() => {
        identifyTimerRef.current = null
        runIdentify(point, lngLat)
      }, 250)
    },
    [runIdentify]
  )

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (isSelectActive) {
        // Lasso mode selects on mouseup, not click
        if (selectMode !== 'point') return
        const map = mapRef.current?.getMap()
        if (!map) return
        setPending(null) // a new capture cancels an open popup
        const shift = e.originalEvent.shiftKey
        const visible = visibleVectorEntries(allLayers)

        const candidates: PendingCandidate[] = []
        for (const { layer, indices } of collectVectorHits(map, allLayers, e.point)) {
          for (const idx of indices) {
            candidates.push({
              accessPath: layer.name,
              envName: layer.envName,
              layerId: layer.id,
              featureIndex: idx,
              label: candidateLabel(layer.geojson.features[idx]?.properties ?? null, idx),
            })
          }
        }

        if (candidates.length === 0) {
          if (!shift) applyPicksFn([], false, visible) // empty click clears
        } else if (candidates.length === 1) {
          const c = candidates[0]
          applyPicksFn(
            [{ accessPath: c.accessPath, envName: c.envName, indices: [c.featureIndex] }],
            shift,
            visible
          )
        } else {
          setPending({
            candidates,
            checked: candidates.map(() => true),
            merge: shift,
            anchor: { x: e.point.x, y: e.point.y },
          })
        }
        return
      }
      if (isIdle) {
        scheduleIdentify(e)
        return
      }
      drawClick(e)
    },
    [isSelectActive, selectMode, allLayers, setPending, applyPicksFn, isIdle, scheduleIdentify, drawClick]
  )

  const handleDblClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Cancel the pending single-click identify and drop any open popup so it
      // doesn't stay anchored to a stale pixel while the map zooms.
      if (identifyTimerRef.current) {
        clearTimeout(identifyTimerRef.current)
        identifyTimerRef.current = null
      }
      closeIdentify()
      drawDblClick(e)
    },
    [closeIdentify, drawDblClick]
  )

  // Clear any pending identify timer on unmount.
  useEffect(() => () => {
    if (identifyTimerRef.current) clearTimeout(identifyTimerRef.current)
  }, [])

  const handleMouseDown = useCallback(
    (e: MapLayerMouseEvent) => {
      if (isSelectActive) {
        if (selectMode === 'lasso') {
          setPending(null) // starting a new lasso discards an open popup
          setIsLassoing(true)
          lassoRef.current = [[e.lngLat.lng, e.lngLat.lat]]
          lassoMoveCount.current = 0
          setLassoPoints([[e.lngLat.lng, e.lngLat.lat]])
        }
        return
      }
      drawMouseDown(e)
    },
    [isSelectActive, selectMode, setPending, drawMouseDown]
  )

  const handleMouseMove = useCallback(
    (e: MapLayerMouseEvent) => {
      // Lasso drawing: accumulate points and throttle setState for performance
      if (isLassoing) {
        lassoRef.current.push([e.lngLat.lng, e.lngLat.lat])
        lassoMoveCount.current++
        if (lassoMoveCount.current % 4 === 0) {
          setLassoPoints([...lassoRef.current])
        }
        return
      }
      drawMouseMove(e)
    },
    [isLassoing, drawMouseMove]
  )

  const handleMouseUp = useCallback(
    (e: MapLayerMouseEvent) => {
      if (isLassoing) {
        setIsLassoing(false)
        setLassoPoints([])
        const pts = lassoRef.current
        lassoRef.current = []
        lassoMoveCount.current = 0

        // Collect candidates from all visible vector layers; the popup lets
        // the user confirm which of them become the selection.
        if (pts.length >= 3) {
          const shift = e.originalEvent.shiftKey
          const candidates: PendingCandidate[] = []
          for (const layer of allLayers) {
            if (!layer.visible || layer.kind === 'raster') continue
            for (let i = 0; i < layer.geojson.features.length; i++) {
              const feature = layer.geojson.features[i]
              if (feature?.geometry && featureInLasso(feature.geometry, pts)) {
                candidates.push({
                  accessPath: layer.name,
                  envName: layer.envName,
                  layerId: layer.id,
                  featureIndex: i,
                  label: candidateLabel(feature.properties ?? null, i),
                })
              }
            }
          }
          if (candidates.length > 0) {
            setPending({
              candidates,
              checked: candidates.map(() => true),
              merge: shift,
              anchor: { x: e.point.x, y: e.point.y },
            })
          } else if (!shift) {
            applyPicksFn([], false, visibleVectorEntries(allLayers)) // empty lasso clears
          }
        }
        return
      }
      drawMouseUp(e)
    },
    [isLassoing, allLayers, setPending, applyPicksFn, drawMouseUp]
  )

  const cursor = isSelectActive
    ? 'crosshair'
    : snapTarget
    ? SNAP_CURSORS[snapTarget.type]
    : drawCursor

  return (
    <Map
      ref={mapRef}
      {...viewState}
      onMove={onMove}
      onClick={handleMapClick}
      onError={(e) => {
        // Map/WebGL errors (notably context loss after system resume) must not
        // bubble to the React ErrorBoundary — that would blow away all UI state.
        console.warn('[MapView] map error (recoverable):', e?.error?.message ?? e)
      }}
      onLoad={() => {
        const map = mapRef.current?.getMap()
        if (!map) return
        // WebGL contexts are dropped when the GPU resets on sleep/resume.
        // preventDefault() on 'webglcontextlost' is required for the browser to
        // fire 'webglcontextrestored' and rebuild the context in place, so the
        // map recovers without a reload.
        const canvas = map.getCanvas()
        canvas.addEventListener('webglcontextlost', (ev) => {
          ev.preventDefault()
          console.warn('[MapView] WebGL context lost — awaiting restore')
        })
        canvas.addEventListener('webglcontextrestored', () => {
          console.log('[MapView] WebGL context restored')
          try { map.triggerRepaint() } catch { /* map may be gone */ }
        })
        for (const layer of layers) {
          if (layer.kind === 'raster') continue
          const gt = layer.geometryType.toUpperCase()
          if (familyIsPolygon(gt) || familyIsLine(gt)) continue
          const s = getEffectiveSym(layer)
          if (s.pointShape === 'circle') continue
          const iconId = `icon-${layer.id}`
          const imageData = generatePointIcon(s)
          if (!map.hasImage(iconId)) map.addImage(iconId, imageData)
        }
        // Capture initial bbox and zoom for code generators
        const bounds = map.getBounds()
        if (bounds) {
          useSpatialStore.getState().setViewBbox([
            bounds.getWest(), bounds.getSouth(),
            bounds.getEast(), bounds.getNorth(),
          ])
        }
        const center = map.getCenter()
        useSpatialStore.getState().setViewState({
          longitude: center.lng,
          latitude: center.lat,
          zoom: map.getZoom(),
        })
      }}
      onDblClick={handleDblClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={drawMouseLeave}
      onContextMenu={drawContextMenu}
      cursor={cursor}
      dragPan={!draggingVertex && !isLassoArmed}
      doubleClickZoom={!suppressDoubleClickZoom}
      mapStyle={mapStyle as maplibregl.StyleSpecification | string}
      preserveDrawingBuffer={true}
      antialias={false}
      fadeDuration={0}
      trackResize={true}
      attributionControl={false}
      style={{ width: '100%', height: '100%' }}
    >
      {layers
        .filter((l) => l.visible)
        .map((layer) =>
          layer.kind === 'raster' && layer.raster ? (
            // R-served XYZ tiles; the version in the key remounts the source
            // on symbology change so MapLibre re-requests every tile.
            <Source
              key={`${layer.id}-v${layer.raster.version}`}
              id={layer.id}
              type="raster"
              tiles={[rasterTileUrl(layer.raster)]}
              tileSize={256}
              minzoom={0}
              maxzoom={layer.raster.maxzoom}
              bounds={layer.raster.bounds}
            >
              <Layer
                key={`${layer.id}-raster`}
                id={`${layer.id}-raster`}
                type="raster"
                paint={{
                  'raster-opacity': layer.opacity,
                  'raster-resampling':
                    layer.raster.symbology.resampling === 'bilinear' ? 'linear' : 'nearest',
                }}
              />
            </Source>
          ) : (
            <Source key={layer.id} id={layer.id} type="geojson" data={layer.geojson} tolerance={0.5} buffer={64}>
              {layerStyle(layer)}
            </Source>
          )
        )}
      <PendingEditsHighlight />
      {(session || isEditMode) && <DrawingLayer />}
      <SelectionHighlight lassoPoints={lassoPoints} />
    </Map>
  )
})
