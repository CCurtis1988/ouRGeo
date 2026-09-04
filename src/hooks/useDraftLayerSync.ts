import { useEffect, useRef } from 'react'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import type { GeometryEditSession } from '@/store/geometryEdit'
import { useSpatialStore } from '@/store/spatial'
import { findMatchingLayer } from '@/lib/geometry-geojson'
import { draftToGeoJSON, draftIsEmpty } from '@/lib/draw/draft'

/**
 * Keeps the existing map layer in sync with the in-progress drawing draft.
 * When the object being edited is already shown as a layer, each vertex click
 * immediately updates that feature's geometry in the layer rather than using
 * a separate temporary overlay.
 *
 * When switching sessions, restores originalGeometry to the spatial layer for
 * whichever session's draft was active — so Session 1's in-progress edits don't
 * bleed through to Session 2's map view.
 */
export function useDraftLayerSync(enabled = true) {
  const session = useGeometryEditStore(selectActiveSession)
  const activeSessionId = useGeometryEditStore((s) => s.activeSessionId)
  const updateLayerFeature = useSpatialStore((s) => s.updateLayerFeature)

  // Track previous session state so we can restore when switching away
  const prevSessionIdRef = useRef<string | null>(null)
  const prevSessionRef = useRef<GeometryEditSession | null>(null)

  useEffect(() => {
    // Mounted once per Spatial Editor, but there is one draft and one set of
    // layers: a second copy would write the same geometry a second time and,
    // on a session switch, restore the original twice.
    if (!enabled) return
    const prevSessionId = prevSessionIdRef.current
    const prevSession = prevSessionRef.current
    prevSessionIdRef.current = activeSessionId
    prevSessionRef.current = session

    // When the active session changes, restore the previous session's original
    // geometry so its draft edits don't remain visible on the map.
    if (prevSessionId !== null && prevSessionId !== activeSessionId && prevSession) {
      const layers = useSpatialStore.getState().layers
      const layer = findMatchingLayer(layers, prevSession)
      if (layer) {
        updateLayerFeature(layer.id, prevSession.currentRow, prevSession.originalGeometry)
      }
    }

    // Sync current session's draft vertices to the map layer
    if (!session) return
    // No vertices yet — leave the original geometry visible until the user
    // starts placing points.
    if (draftIsEmpty(session.draft)) return

    // Read layers via getState() so this effect does NOT re-fire when the
    // layer data changes (which would happen after every updateLayerFeature call,
    // creating an infinite loop).
    const layers = useSpatialStore.getState().layers
    const layer = findMatchingLayer(layers, session)
    if (!layer) return

    const geometry = draftToGeoJSON(session.draft, session.geometryType, { lenient: true })
    updateLayerFeature(layer.id, session.currentRow, geometry)
  }, [session, activeSessionId, updateLayerFeature, enabled])
}
