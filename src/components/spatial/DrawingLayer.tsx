import React from 'react'
import { Source, Layer } from 'react-map-gl/maplibre'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { useTraverseStore } from '@/store/traverse'
import { resolveFont } from '@/lib/label-utils'
import { useSpatialStore } from '@/store/spatial'
import { useThemeStore } from '@/store/theme'
import { THEMES } from '@/lib/themes'
import { findMatchingLayer } from '@/lib/geometry-geojson'
import { allPaths, getPath, draftToGeoJSON, computeMidpointHandles, pathDisplayCoords } from '@/lib/draw/draft'
import type { FeatureCollection, Feature, Geometry } from 'geojson'

export function DrawingLayer(): React.ReactElement | null {
  const session = useGeometryEditStore(selectActiveSession)
  const activeToolId = useGeometryEditStore((s) => s.activeToolId)
  const selectedVertex = useGeometryEditStore((s) => s.selectedVertex)
  const draggingVertex = useGeometryEditStore((s) => s.draggingVertex)
  const snapTarget = useGeometryEditStore((s) => s.snapTarget)
  const previewCursor = useDrawPreviewStore((s) => s.cursor)
  const ghost = useDrawPreviewStore((s) => s.ghost)
  const legLabel = useTraverseStore((s) => s.legLabel)
  const layers = useSpatialStore((s) => s.layers)
  const currentTheme = useThemeStore((s) => s.current)
  const theme = THEMES[currentTheme] ?? THEMES.dark
  const { accent, success, muted } = theme.palette
  // The halo colour comes from the editor chrome rather than the palette: the
  // palette has no background, and a label over a basemap needs one.
  const haloColor = theme.editorChrome.bg

  if (!session && !snapTarget) return null

  const features: Feature[] = []

  if (session) {
    const isMapLayer = !!findMatchingLayer(layers, session)

    // In map-layer edit mode: only show vertex markers (geometry is updated in-place by useDraftLayerSync).
    // In DataViewer draw mode: show full draft overlay.
    const { draft, activePath, geometryType, committedFeatures } = session

    // Always show committed features — they are session-local (stored in
    // session.committedFeatures), regardless of whether the object is a map layer.
    features.push(...committedFeatures)

    const isPolygonType = geometryType === 'POLYGON' || geometryType === 'MULTIPOLYGON'
    const paths = allPaths(draft)
    const activePathData = getPath(draft, activePath)

    if (!isMapLayer) {
      // Polygon body (with holes) — lenient conversion renders whatever parts
      // are already closable while the user keeps digitizing.
      if (isPolygonType) {
        const g = draftToGeoJSON(draft, geometryType, { lenient: true })
        if (g) {
          features.push({ type: 'Feature', properties: { kind: 'draft-polygon' }, geometry: g })
        }
      }
      // Per-path outlines: in-progress rings/lines (anything with ≥ 2 vertices
      // that isn't already part of the closed polygon body).
      for (const { ref, path } of paths) {
        if (path.vertices.length < 2) continue
        const closable = path.vertices.length >= 3
        if (isPolygonType && closable) continue // covered by the polygon body
        const isActive = ref.part === activePath.part && ref.ring === activePath.ring
        features.push({
          type: 'Feature',
          properties: { kind: isActive ? 'draft-line' : 'completed-ring' },
          geometry: {
            type: 'LineString',
            coordinates: pathDisplayCoords(path)
          } as Geometry
        })
      }
    }

    // Rubber band — dashed preview from the last placed vertex to the cursor
    // while digitizing (plus a closing segment back to the ring start).
    const isLineLike =
      geometryType === 'LINESTRING' || geometryType === 'MULTILINESTRING' || isPolygonType
    const activeVerts = activePathData?.vertices ?? []
    if (activeToolId === 'draw' && isLineLike && previewCursor && activeVerts.length >= 1) {
      const last = activeVerts[activeVerts.length - 1]
      features.push({
        type: 'Feature',
        properties: { kind: 'rubber-band' },
        geometry: {
          type: 'LineString',
          coordinates: [[last[0], last[1]], [previewCursor[0], previewCursor[1]]]
        } as Geometry
      })
      // Closing preview for rings (exterior of polygons, or any hole)
      if ((isPolygonType || activePath.ring > 0) && activeVerts.length >= 2) {
        const first = activeVerts[0]
        features.push({
          type: 'Feature',
          properties: { kind: 'rubber-band' },
          geometry: {
            type: 'LineString',
            coordinates: [[previewCursor[0], previewCursor[1]], [first[0], first[1]]]
          } as Geometry
        })
      }
    }

    // Midpoint handles (edit-vertices tool) — drag one to insert a vertex.
    // Rendered before vertices so real vertices win hit-tests.
    if (activeToolId === 'edit-vertices' && !draggingVertex) {
      for (const h of computeMidpointHandles(session)) {
        features.push({
          type: 'Feature',
          properties: {
            kind: 'midpoint-handle',
            part: h.part,
            ring: h.ring,
            insertAfterIdx: h.insertAfterIdx
          },
          geometry: { type: 'Point', coordinates: [h.lng, h.lat] } as Geometry
        })
      }
    }

    // Vertex markers for every path. The first vertex of the active ring gets
    // the "close" styling once the ring is closable.
    for (const { ref, path } of paths) {
      const isActive = ref.part === activePath.part && ref.ring === activePath.ring
      for (let i = 0; i < path.vertices.length; i++) {
        const [lng, lat] = path.vertices[i]
        const isCloseVertex =
          isActive &&
          i === 0 &&
          (isPolygonType || ref.ring > 0) &&
          path.vertices.length >= 3 &&
          activeToolId === 'draw'
        features.push({
          type: 'Feature',
          id: `v-${ref.part}-${ref.ring}-${i}`,
          properties: {
            kind: isCloseVertex ? 'close-vertex' : 'vertex',
            part: ref.part,
            ring: ref.ring,
            vertex: i
          },
          geometry: { type: 'Point', coordinates: [lng, lat] } as Geometry
        })
      }
    }

    // Selected vertex highlight (Delete key target)
    if (selectedVertex && activeToolId === 'edit-vertices') {
      const pos = getPath(draft, selectedVertex)?.vertices[selectedVertex.vertex]
      if (pos) {
        features.push({
          type: 'Feature',
          properties: { kind: 'selected-vertex' },
          geometry: { type: 'Point', coordinates: [pos[0], pos[1]] } as Geometry
        })
      }
    }
  }

  // Ghost shape preview (rectangle/circle/freehand while dragging)
  if (ghost) {
    features.push({
      type: 'Feature',
      properties: { kind: ghost.type === 'Polygon' ? 'ghost-polygon' : 'ghost-line' },
      geometry: ghost
    })
  }

  // What the leg being typed measures, written on the leg itself. On a wide
  // map the entry strip is a long way from the geometry it is describing, and
  // the number you are checking is the one under your eyes.
  if (legLabel && ghost && ghost.type === 'LineString' && ghost.coordinates.length >= 2) {
    const [a, b] = [ghost.coordinates[0], ghost.coordinates[ghost.coordinates.length - 1]]
    features.push({
      type: 'Feature',
      properties: { kind: 'leg-label', label: legLabel },
      geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } as Geometry,
    })
  }

  // Snap indicator — shown at the current snap target position
  if (snapTarget) {
    features.push({
      type: 'Feature',
      properties: { kind: 'snap-indicator' },
      geometry: { type: 'Point', coordinates: [snapTarget.lng, snapTarget.lat] } as Geometry
    })
  }

  const geojson: FeatureCollection = { type: 'FeatureCollection', features }

  const isEditingVertices = activeToolId === 'edit-vertices'

  const vertexPaint = {
    'circle-radius': isEditingVertices ? 6 : 5,
    'circle-color': '#ffffff',
    'circle-stroke-color': accent,
    'circle-stroke-width': 2
  }

  return (
    <Source id="drawing-draft" type="geojson" data={geojson}>
      {/* Completed (inactive) paths — muted dashed */}
      <Layer
        id="drawing-completed-ring"
        type="line"
        filter={['==', ['get', 'kind'], 'completed-ring']}
        paint={{
          'line-color': muted,
          'line-width': 1.5,
          'line-dasharray': [4, 3]
        }}
      />
      {/* Active draft line */}
      <Layer
        id="drawing-draft-line"
        type="line"
        filter={['==', ['get', 'kind'], 'draft-line']}
        paint={{
          'line-color': accent,
          'line-width': 2,
          'line-dasharray': [4, 2]
        }}
      />
      {/* Draft polygon fill + outline (holes punched via lenient GeoJSON) */}
      <Layer
        id="drawing-draft-polygon-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'draft-polygon']}
        paint={{
          'fill-color': accent,
          'fill-opacity': 0.15
        }}
      />
      <Layer
        id="drawing-draft-polygon-line"
        type="line"
        filter={['==', ['get', 'kind'], 'draft-polygon']}
        paint={{
          'line-color': accent,
          'line-width': 2,
          'line-dasharray': [4, 2]
        }}
      />
      {/* Distance & Bearing: the pending leg's own numbers, on the leg. */}
      <Layer
        id="drawing-leg-label"
        type="symbol"
        filter={['==', ['get', 'kind'], 'leg-label']}
        layout={{
          'text-field': ['get', 'label'],
          'text-font': resolveFont('Noto Sans', false, false),
          'text-size': 11,
          'text-offset': [0, -0.9],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': accent,
          // A halo, because this sits over whatever the basemap is showing and
          // a number that cannot be read is worse than no number.
          'text-halo-color': haloColor,
          'text-halo-width': 1.5,
        }}
      />
      {/* Ghost shape (rectangle/circle/freehand preview) */}
      <Layer
        id="drawing-ghost-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'ghost-polygon']}
        paint={{
          'fill-color': accent,
          'fill-opacity': 0.1
        }}
      />
      <Layer
        id="drawing-ghost-line"
        type="line"
        filter={['in', ['get', 'kind'], ['literal', ['ghost-polygon', 'ghost-line']]]}
        paint={{
          'line-color': accent,
          'line-width': 1.5,
          'line-dasharray': [3, 2],
          'line-opacity': 0.8
        }}
      />
      {/* Rubber band — faint dashed segment following the cursor */}
      <Layer
        id="drawing-rubber-band"
        type="line"
        filter={['==', ['get', 'kind'], 'rubber-band']}
        paint={{
          'line-color': accent,
          'line-width': 1.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.7
        }}
      />
      {/* Midpoint handles — small hollow markers on each edge */}
      <Layer
        id="drawing-midpoints"
        type="circle"
        filter={['==', ['get', 'kind'], 'midpoint-handle']}
        paint={{
          'circle-radius': 4,
          'circle-color': 'rgba(255,255,255,0.55)',
          'circle-stroke-color': accent,
          'circle-stroke-width': 1.5
        }}
      />
      {/* Vertices */}
      <Layer
        id="drawing-vertices"
        type="circle"
        filter={['==', ['get', 'kind'], 'vertex']}
        paint={vertexPaint}
      />
      {/* Selected vertex — accent halo behind the marker */}
      <Layer
        id="drawing-selected-vertex"
        type="circle"
        filter={['==', ['get', 'kind'], 'selected-vertex']}
        paint={{
          'circle-radius': 9,
          'circle-color': 'transparent',
          'circle-stroke-color': accent,
          'circle-stroke-width': 2.5
        }}
      />
      {/* Close vertex — success color, click to close the ring */}
      <Layer
        id="drawing-close-vertex"
        type="circle"
        filter={['==', ['get', 'kind'], 'close-vertex']}
        paint={{
          'circle-radius': 6,
          'circle-color': success,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }}
      />
      {/* Committed points */}
      <Layer
        id="drawing-committed-point"
        type="circle"
        filter={['==', ['get', 'kind'], 'committed-point']}
        paint={{
          'circle-radius': 5,
          'circle-color': accent,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }}
      />
      {/* Committed lines */}
      <Layer
        id="drawing-committed-line"
        type="line"
        filter={['==', ['get', 'kind'], 'committed-line']}
        paint={{
          'line-color': accent,
          'line-width': 2
        }}
      />
      {/* Committed polygons — fill + outline */}
      <Layer
        id="drawing-committed-polygon-fill"
        type="fill"
        filter={['==', ['get', 'kind'], 'committed-polygon']}
        paint={{
          'fill-color': accent,
          'fill-opacity': 0.2
        }}
      />
      <Layer
        id="drawing-committed-polygon-line"
        type="line"
        filter={['==', ['get', 'kind'], 'committed-polygon']}
        paint={{
          'line-color': accent,
          'line-width': 2
        }}
      />
      {/* Snap indicator — yellow-gold ring at the current snap target */}
      <Layer
        id="snap-indicator"
        type="circle"
        filter={['==', ['get', 'kind'], 'snap-indicator']}
        paint={{
          'circle-radius': 8,
          'circle-color': 'transparent',
          'circle-stroke-color': '#f0c040',
          'circle-stroke-width': 2.5
        }}
      />
    </Source>
  )
}
