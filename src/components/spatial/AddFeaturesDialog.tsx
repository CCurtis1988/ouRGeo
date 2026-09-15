import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { addSpatialLayers } from '@/lib/add-spatial-layer'
import { useSpatialStore, SpatialObjectInfo } from '@/store/spatial'

interface AddFeaturesDialogProps {
  onLayersAdded: (bbox: [number, number, number, number] | null) => void
}

export function AddFeaturesDialog({ onLayersAdded }: AddFeaturesDialogProps): React.ReactElement {
  const open = useSpatialStore((s) => s.addFeaturesDialogOpen)
  const setOpen = useSpatialStore((s) => s.setAddFeaturesDialogOpen)
  const availableObjects = useSpatialStore((s) => s.availableObjects)
  const setAvailableObjects = useSpatialStore((s) => s.setAvailableObjects)

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

    setLoading(true)
    setError(null)
    // The add itself lives in src/lib/add-spatial-layer.ts, so the AI
    // assistant adds layers through exactly this path.
    const { failures, bbox } = await addSpatialLayers(toAdd)
    setLoading(false)

    // Surface failures instead of silently doing nothing; keep the dialog open
    // when nothing could be added so the user sees why.
    if (failures.length > 0) {
      setError(`Could not add ${failures.length === 1 ? 'layer' : 'layers'}: ${failures.join('; ')}`)
      if (failures.length === toAdd.length) return
    }

    setOpen(false)
    onLayersAdded(bbox)
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
                        {/* The separator is the CHARACTER, not `&middot;`. JSX
                            decodes an entity written as text, but not one inside
                            a string or template literal — and this line mixed
                            both, so the CRS arrived on screen reading
                            "1 feature &middot; EPSG:4326". Using the character
                            throughout removes the two ways to write it. */}
                        {obj.class === 'SpatRaster' ? (
                          <>
                            {obj.envName} · Raster · {obj.nBands ?? 1} band
                            {(obj.nBands ?? 1) !== 1 ? 's' : ''}
                            {obj.dims ? ` · ${obj.dims[0]}×${obj.dims[1]}` : ''}
                            {obj.crs ? ` · ${obj.crs}` : ''}
                          </>
                        ) : (
                          <>
                            {obj.envName} · {obj.geometryType} · {obj.nFeatures} feature
                            {obj.nFeatures !== 1 ? 's' : ''}
                            {obj.crs ? ` · ${obj.crs}` : ''}
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
