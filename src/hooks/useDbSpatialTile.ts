import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { rClient } from '@/lib/r-client'
import { useSpatialStore } from '@/store/spatial'

const DEBOUNCE_MS = 200
const MAX_FEATURES = 5000

// Quantise a bbox + zoom into a cache key. Small pans within the same
// quantised bbox skip the round-trip; only meaningful viewport changes fire
// a refetch.
function tileKey(bbox: [number, number, number, number], zoom: number): string {
  const z = Math.floor(zoom * 2) / 2
  const grid = Math.pow(2, Math.max(0, 14 - z)) * 0.001
  const q = (v: number) => Math.round(v / grid) * grid
  return `${z}|${q(bbox[0])}|${q(bbox[1])}|${q(bbox[2])}|${q(bbox[3])}`
}

// Subscribe to viewBbox / zoom changes for one db-backed layer; fetches
// /dataset/spatial-tile and pushes the result into the spatial store.
//
// The hook reads its layer fields with primitive selectors (handle, name,
// visible) so the effect does NOT re-fire on every `s.layers` mutation.
// Without this, every call to `setLayerTileGeoJSON` rebuilds the layer
// object and would retrigger the effect we're trying to debounce.
export function useDbSpatialTile(layerId: string) {
  const layerInfo = useSpatialStore(
    useShallow((s) => {
      const l = s.layers.find((x) => x.id === layerId)
      if (!l?.tileSource) return null
      return {
        handle: l.tileSource.handle,
        name: l.tileSource.name,
        visible: l.visible
      }
    })
  )
  const viewBbox = useSpatialStore((s) => s.viewBbox)
  const zoom = useSpatialStore((s) => s.viewState.zoom)
  const setLayerTileGeoJSON = useSpatialStore((s) => s.setLayerTileGeoJSON)
  // Subscribed for invalidation: when DbSpatialTileLoader bumps this after
  // a successful Save flush, drop our cached tile key so the next viewport
  // fetch re-pulls truth from the DB.
  const cacheVersion = useSpatialStore((s) => s.tileCacheVersion[layerId] ?? 0)
  const lastKey = useRef<string | null>(null)
  const lastVersion = useRef<number>(0)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef(false)

  useEffect(() => {
    if (!layerInfo || !layerInfo.visible) return
    if (!viewBbox) return
    if (cacheVersion !== lastVersion.current) {
      lastKey.current = null
      lastVersion.current = cacheVersion
    }
    const key = tileKey(viewBbox, zoom)
    if (key === lastKey.current) return

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(async () => {
      if (inflight.current) return
      inflight.current = true
      try {
        const res = await rClient.datasetSpatialTile(
          { handle: layerInfo.handle, name: layerInfo.name },
          { bbox: viewBbox, zoom, limit: MAX_FEATURES }
        )
        if (res.success && res.geojson) {
          setLayerTileGeoJSON(layerId, res.geojson, res.truncated)
          lastKey.current = key
        }
      } finally {
        inflight.current = false
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [layerId, layerInfo, viewBbox, zoom, cacheVersion, setLayerTileGeoJSON])
}
