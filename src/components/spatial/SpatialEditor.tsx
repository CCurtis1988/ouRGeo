import React, { useRef, useCallback, useEffect } from 'react'
import { SpatialRibbon } from './SpatialRibbon'
import { MapView, MapViewHandle } from './MapView'
import { AddFeaturesDialog } from './AddFeaturesDialog'
import { GeometryEditRibbon } from './GeometryEditRibbon'
import { useSpatialStore } from '@/store/spatial'
import { useSelectionStore } from '@/store/selection'
import { useDraftLayerSync } from '@/hooks/useDraftLayerSync'
import { useDrawHotkeys } from '@/hooks/useDrawHotkeys'
import { MapControls } from './MapControls'
import { MapLegend } from './MapLegend'
import { NorthArrow } from './NorthArrow'
import { DbSpatialTileLoader } from './DbSpatialTileLoader'
import { DrawContextMenu } from './DrawContextMenu'
import { AttributePopover } from './AttributePopover'
import { SelectionPopup } from './SelectionPopup'
import { IdentifyPopup } from './IdentifyPopup'

export function SpatialEditor(): React.ReactElement {
  const mapRef = useRef<MapViewHandle>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const layers = useSpatialStore((s) => s.layers)
  const fitBoundsSignal = useSpatialStore((s) => s.fitBoundsSignal)
  const selections = useSelectionStore((s) => s.selections)
  const showLegend = useSpatialStore((s) => s.showLegend)
  const showNorthArrow = useSpatialStore((s) => s.showNorthArrow)
  useDraftLayerSync()
  useDrawHotkeys()

  // Guard against losing staged (unsaved) edits on window close.
  const hasPendingEdits = useSpatialStore(
    (s) => Object.keys(s.pendingGeometryEdits).length > 0
  )
  useEffect(() => {
    if (!hasPendingEdits) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasPendingEdits])

  const fitAllBounds = useCallback(() => {
    if (layers.length === 0) return

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    let hasCoords = false

    const hasAnySelection = layers.some(
      (l) => l.visible && (selections[`${l.name}::${l.envName}`]?.length ?? 0) > 0
    )

    for (const layer of layers) {
      if (!layer.visible) continue

      // Raster layers have no features — fit to their registered 4326 bounds.
      if (layer.kind === 'raster' && layer.raster) {
        const rb = layer.raster.bounds
        hasCoords = true
        if (rb[0] < minLng) minLng = rb[0]
        if (rb[1] < minLat) minLat = rb[1]
        if (rb[2] > maxLng) maxLng = rb[2]
        if (rb[3] > maxLat) maxLat = rb[3]
        continue
      }

      // Db-backed layer that hasn't streamed any tiles yet: fit to the
      // dataset's full bbox so the user lands on the data instead of the
      // default world view.
      const fb = layer.tileSource?.fullBbox
      if (fb && (!layer.geojson?.features || layer.geojson.features.length === 0)) {
        hasCoords = true
        if (fb[0] < minLng) minLng = fb[0]
        if (fb[1] < minLat) minLat = fb[1]
        if (fb[2] > maxLng) maxLng = fb[2]
        if (fb[3] > maxLat) maxLat = fb[3]
        continue
      }

      if (!layer.geojson?.features) continue

      const selectedIndices = selections[`${layer.name}::${layer.envName}`]
      const featuresToVisit = (hasAnySelection && selectedIndices?.length)
        ? selectedIndices.map((i) => layer.geojson.features[i]).filter(Boolean)
        : layer.geojson.features

      for (const feature of featuresToVisit) {
        visitCoords(feature.geometry, (lng, lat) => {
          hasCoords = true
          if (lng < minLng) minLng = lng
          if (lat < minLat) minLat = lat
          if (lng > maxLng) maxLng = lng
          if (lat > maxLat) maxLat = lat
        })
      }
    }

    if (hasCoords) {
      mapRef.current?.fitBounds([minLng, minLat, maxLng, maxLat])
    }
  }, [layers, selections])

  // Auto-fit when triggered externally (e.g. "Draw Geometry" from data editor).
  // The effect intentionally depends only on `fitBoundsSignal` — listing
  // `fitAllBounds` here would re-fire on every `layers` change (since the
  // callback's identity tracks layers), which loops with the db-tile fetcher.
  const fitAllBoundsRef = useRef<() => void>(() => {})
  fitAllBoundsRef.current = fitAllBounds
  useEffect(() => {
    if (fitBoundsSignal === 0) return
    fitAllBoundsRef.current()
  }, [fitBoundsSignal])

  // Fit to an explicit bbox pushed from the data viewer (zoom to row / selected
  // rows / layer extent). Reads the target at fire time so the effect only
  // needs to depend on the signal.
  const fitTargetSignal = useSpatialStore((s) => s.fitTargetSignal)
  useEffect(() => {
    if (fitTargetSignal === 0) return
    const bbox = useSpatialStore.getState().fitTarget
    if (bbox) mapRef.current?.fitBounds(bbox)
  }, [fitTargetSignal])

  const onLayersAdded = useCallback((bbox: [number, number, number, number] | null) => {
    if (bbox) {
      mapRef.current?.fitBounds(bbox)
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-geo-bg">
      <SpatialRibbon onFitBounds={fitAllBounds} mapContainerRef={mapContainerRef} />
      <div ref={mapContainerRef} className="flex-1 min-h-0 relative">
        <MapView ref={mapRef} />
        <div data-export-hide>
          <MapControls
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            onFitBounds={fitAllBounds}
          />
        </div>
        {showLegend && <MapLegend />}
        {showNorthArrow && <NorthArrow />}
        <AttributePopover />
        <SelectionPopup />
        <IdentifyPopup />
      </div>
      <GeometryEditRibbon />
      <DrawContextMenu />
      <AddFeaturesDialog onLayersAdded={onLayersAdded} />
      <DbSpatialTileLoader />
    </div>
  )
}

function visitCoords(geometry: GeoJSON.Geometry | null, fn: (lng: number, lat: number) => void) {
  if (!geometry) return

  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) visitCoords(g, fn)
    return
  }

  function walk(c: unknown) {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      fn(c[0] as number, c[1] as number)
    } else {
      for (const item of c) walk(item)
    }
  }

  if ('coordinates' in geometry) {
    walk(geometry.coordinates)
  }
}
