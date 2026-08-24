import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { createRasterLayerInfo, rasterLayerDraft } from '@/lib/raster-layers'
import { useSpatialStore, SpatialObjectInfo } from '@/store/spatial'
import { useGeometryEditStore } from '@/store/geometryEdit'

interface AddFeaturesDialogProps {
  onLayersAdded: (bbox: [number, number, number, number] | null) => void
}

export function AddFeaturesDialog({ onLayersAdded }: AddFeaturesDialogProps): React.ReactElement {
  const open = useSpatialStore((s) => s.addFeaturesDialogOpen)
  const setOpen = useSpatialStore((s) => s.setAddFeaturesDialogOpen)
  const availableObjects = useSpatialStore((s) => s.availableObjects)
  const setAvailableObjects = useSpatialStore((s) => s.setAvailableObjects)
  const addLayer = useSpatialStore((s) => s.addLayer)
  const addLayerToActiveSession = useGeometryEditStore((s) => s.addLayerToActiveSession)
  const createNamedSession = useGeometryEditStore((s) => s.createNamedSession)
  const activeSessionId = useGeometryEditStore((s) => s.activeSessionId)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [listing, setListing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setError(null)
    setListing(true)

    rClient
      .listSpatialObjects()
      .then((res) => {
        if (res.success) {
          setAvailableObjects(res.objects)
        } else {
          setError('Failed to list spatial objects')
        }
      })
      .catch(() => setError('Failed to connect to R server'))
      .finally(() => setListing(false))
  }, [open, setAvailableObjects])

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const objectKey = (obj: SpatialObjectInfo) => `${obj.envName}::${obj.name}`

  const handleAdd = async () => {
    const toAdd = availableObjects.filter((o) => selected.has(objectKey(o)))
    if (toAdd.length === 0) return

    if (!activeSessionId) {
      createNamedSession('Default')
    }

    setLoading(true)
    setError(null)
    let combinedBbox: [number, number, number, number] | null = null
    const failures: string[] = []

    for (const obj of toAdd) {
      try {
        let bbox: [number, number, number, number] | null = null

        if (obj.class === 'SpatRaster') {
          // Raster path: register with the tile engine — no GeoJSON, no
          // geometry-edit session (rasters are not editable features).
          const info = await createRasterLayerInfo(obj.name, obj.envName)
          addLayer(rasterLayerDraft(obj.name, obj.envName, info))
          bbox = info.bounds
        } else {
          const res = await rClient.getSpatialGeoJSON(obj.name, obj.envName)
          if (!res.success || !res.geojson) {
            failures.push(`${obj.name}: ${res.error ?? 'no geometry returned'}`)
            continue
          }

          const geojson =
            typeof res.geojson === 'string' ? JSON.parse(res.geojson) : res.geojson

          const newLayerId = addLayer({
            name: obj.name,
            envName: obj.envName,
            geometryType: obj.geometryType,
            geojson,
            colLib: (obj.class === 'sf' || obj.class === 'sfc' || obj.class === 'sfg') ? 'sf' : 'geos',
            columnName: obj.sfColumn ?? 'geometry'
          })
          addLayerToActiveSession(newLayerId)
          bbox = computeBbox(geojson)
        }

        if (bbox) {
          if (!combinedBbox) {
            combinedBbox = [...bbox]
          } else {
            combinedBbox[0] = Math.min(combinedBbox[0], bbox[0])
            combinedBbox[1] = Math.min(combinedBbox[1], bbox[1])
            combinedBbox[2] = Math.max(combinedBbox[2], bbox[2])
            combinedBbox[3] = Math.max(combinedBbox[3], bbox[3])
          }
        }
      } catch (e) {
        failures.push(`${obj.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    setLoading(false)

    // Surface failures instead of silently doing nothing; keep the dialog open
    // when nothing could be added so the user sees why.
    if (failures.length > 0) {
      setError(`Could not add ${failures.length === 1 ? 'layer' : 'layers'}: ${failures.join('; ')}`)
      if (failures.length === toAdd.length) return
    }

    setOpen(false)
    onLayersAdded(combinedBbox)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[480px] max-h-[70vh] bg-geo-panel border border-geo-border rounded-lg shadow-xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-geo-border">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Add Spatial Features
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-geo-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {listing && (
              <div className="flex items-center justify-center py-8 text-geo-muted">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Scanning environments...
              </div>
            )}

            {error && <p className="text-geo-error text-sm">{error}</p>}

            {!listing && !error && availableObjects.length === 0 && (
              <p className="text-geo-muted text-sm py-4">
                No spatial objects found. Load sf data in the R console first.
              </p>
            )}

            {!listing &&
              availableObjects.map((obj) => {
                const key = objectKey(obj)
                return (
                  <label
                    key={key}
                    className="flex items-start gap-3 py-2 px-2 rounded hover:bg-geo-bg cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleSelect(key)}
                      className="mt-0.5 accent-geo-accent"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{obj.name}</div>
                      <div className="text-xs text-geo-muted">
                        {obj.class === 'SpatRaster' ? (
                          <>
                            {obj.envName} &middot; Raster &middot; {obj.nBands ?? 1} band
                            {(obj.nBands ?? 1) !== 1 ? 's' : ''}
                            {obj.dims ? ` · ${obj.dims[0]}×${obj.dims[1]}` : ''}
                            {obj.crs ? ` · ${obj.crs}` : ''}
                          </>
                        ) : (
                          <>
                            {obj.envName} &middot; {obj.geometryType} &middot; {obj.nFeatures} feature
                            {obj.nFeatures !== 1 ? 's' : ''}
                            {obj.crs ? ` &middot; ${obj.crs}` : ''}
                          </>
                        )}
                      </div>
                    </div>
                  </label>
                )
              })}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              size="sm"
              disabled={selected.size === 0 || loading}
              onClick={handleAdd}
              className="bg-geo-accent hover:bg-geo-accent/80 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Loading...
                </>
              ) : (
                `Add ${selected.size > 0 ? `(${selected.size})` : ''}`
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function computeBbox(
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry
): [number, number, number, number] | null {
  const coords: number[][] = []

  function extractCoords(obj: unknown) {
    if (!obj || typeof obj !== 'object') return
    const g = obj as Record<string, unknown>
    if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
      for (const f of g.features) extractCoords(f)
    } else if (g.type === 'Feature' && g.geometry) {
      extractCoords(g.geometry)
    } else if (g.coordinates) {
      flattenCoords(g.coordinates as unknown)
    } else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const gg of g.geometries) extractCoords(gg)
    }
  }

  function flattenCoords(c: unknown) {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      coords.push(c as number[])
    } else {
      for (const item of c) flattenCoords(item)
    }
  }

  extractCoords(geojson)
  if (coords.length === 0) return null

  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }

  return [minLng, minLat, maxLng, maxLat]
}
