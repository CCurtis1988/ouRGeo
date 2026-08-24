import type { GeometryType, GeometryEditSession } from '@/store/geometryEdit'
import type { DraftGeometry, DraftPart, DraftPath, PathRef, VertexRef, Position, SegmentKind } from './types'
import { densifyArc } from './arc'

/**
 * Pure operations on the DraftGeometry model. Every mutating op returns a
 * new draft (structural sharing where untouched); the store layers undo
 * snapshots on top of these.
 *
 * Path addressing: ring 0 = part exterior, ring n ≥ 1 = holes[n-1].
 */

// ── Construction ─────────────────────────────────────────────────────────────

export function emptyPath(): DraftPath {
  return { vertices: [], segments: [] }
}

export function emptyPart(): DraftPart {
  return { exterior: emptyPath(), holes: [] }
}

export function emptyDraft(): DraftGeometry {
  return { parts: [emptyPart()] }
}

function lineSegments(n: number): DraftPath['segments'] {
  return n > 1 ? Array.from({ length: n - 1 }, () => 'line' as const) : []
}

function pathFromCoords(coords: number[][], dropClosing: boolean): DraftPath {
  let pts = coords
  if (dropClosing && pts.length >= 2) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) pts = pts.slice(0, -1)
  }
  const vertices = pts.map((c) => [c[0], c[1]] as Position)
  return { vertices, segments: lineSegments(vertices.length) }
}

/** Convert an existing GeoJSON geometry into a draft for editing. */
export function geometryToDraft(geometry: GeoJSON.Geometry): DraftGeometry {
  switch (geometry.type) {
    case 'Point':
      return {
        parts: [{ exterior: pathFromCoords([geometry.coordinates], false), holes: [] }]
      }
    case 'MultiPoint':
      return { parts: [{ exterior: pathFromCoords(geometry.coordinates, false), holes: [] }] }
    case 'LineString':
      return { parts: [{ exterior: pathFromCoords(geometry.coordinates, false), holes: [] }] }
    case 'Polygon':
      return {
        parts: [
          {
            exterior: pathFromCoords(geometry.coordinates[0] ?? [], true),
            holes: geometry.coordinates.slice(1).map((r) => pathFromCoords(r, true))
          }
        ]
      }
    case 'MultiLineString':
      return {
        parts: geometry.coordinates.map((line) => ({
          exterior: pathFromCoords(line, false),
          holes: []
        }))
      }
    case 'MultiPolygon':
      return {
        parts: geometry.coordinates.map((poly) => ({
          exterior: pathFromCoords(poly[0] ?? [], true),
          holes: poly.slice(1).map((r) => pathFromCoords(r, true))
        }))
      }
    default:
      return emptyDraft()
  }
}

// ── Accessors ────────────────────────────────────────────────────────────────

export function getPath(draft: DraftGeometry, ref: PathRef): DraftPath | null {
  const part = draft.parts[ref.part]
  if (!part) return null
  if (ref.ring === 0) return part.exterior
  return part.holes[ref.ring - 1] ?? null
}

export function vertexPosition(draft: DraftGeometry, ref: VertexRef): Position | null {
  return getPath(draft, ref)?.vertices[ref.vertex] ?? null
}

export function draftIsEmpty(draft: DraftGeometry): boolean {
  return draft.parts.every(
    (p) => p.exterior.vertices.length === 0 && p.holes.every((h) => h.vertices.length === 0)
  )
}

/** Iterate every path in the draft with its ref. */
export function allPaths(draft: DraftGeometry): { ref: PathRef; path: DraftPath }[] {
  const out: { ref: PathRef; path: DraftPath }[] = []
  draft.parts.forEach((part, p) => {
    out.push({ ref: { part: p, ring: 0 }, path: part.exterior })
    part.holes.forEach((h, i) => out.push({ ref: { part: p, ring: i + 1 }, path: h }))
  })
  return out
}

// ── Mutations (pure) ─────────────────────────────────────────────────────────

function withPath(
  draft: DraftGeometry,
  ref: PathRef,
  updater: (path: DraftPath) => DraftPath
): DraftGeometry {
  return {
    parts: draft.parts.map((part, p) => {
      if (p !== ref.part) return part
      if (ref.ring === 0) return { ...part, exterior: updater(part.exterior) }
      return {
        ...part,
        holes: part.holes.map((h, i) => (i === ref.ring - 1 ? updater(h) : h))
      }
    })
  }
}

export function appendVertex(
  draft: DraftGeometry,
  ref: PathRef,
  pos: Position,
  segment: SegmentKind = 'line'
): DraftGeometry {
  return withPath(draft, ref, (path) => ({
    vertices: [...path.vertices, pos],
    segments: path.vertices.length > 0 ? [...path.segments, segment] : path.segments
  }))
}

export function insertVertexAfter(
  draft: DraftGeometry,
  ref: PathRef,
  afterIdx: number,
  pos: Position
): DraftGeometry {
  return withPath(draft, ref, (path) => {
    const vertices = [...path.vertices]
    vertices.splice(afterIdx + 1, 0, pos)
    // Splitting an edge replaces one segment with two straight ones; the
    // closing edge (afterIdx = last vertex) only adds a segment.
    const segments = [...path.segments]
    if (afterIdx < path.segments.length) segments.splice(afterIdx, 1, 'line', 'line')
    else segments.push('line')
    return { vertices, segments }
  })
}

export function moveVertex(draft: DraftGeometry, ref: VertexRef, pos: Position): DraftGeometry {
  return withPath(draft, ref, (path) => ({
    ...path,
    vertices: path.vertices.map((v, i) => (i === ref.vertex ? pos : v))
  }))
}

function minVerticesFor(geometryType: GeometryType, ring: number): number {
  if (ring > 0) return 3 // holes are always rings
  switch (geometryType) {
    case 'POINT':
    case 'MULTIPOINT':
      return 1
    case 'LINESTRING':
    case 'MULTILINESTRING':
      return 2
    case 'POLYGON':
    case 'MULTIPOLYGON':
      return 3
  }
}

export function removeVertex(
  draft: DraftGeometry,
  ref: VertexRef,
  geometryType: GeometryType
): DraftGeometry {
  const path = getPath(draft, ref)
  if (!path || path.vertices.length <= minVerticesFor(geometryType, ref.ring)) return draft
  return withPath(draft, ref, (p) => ({
    vertices: p.vertices.filter((_, i) => i !== ref.vertex),
    segments: p.segments.length > 0 ? p.segments.slice(0, -1) : p.segments
  }))
}

export function removeLastVertex(draft: DraftGeometry, ref: PathRef): DraftGeometry {
  const path = getPath(draft, ref)
  if (!path || path.vertices.length === 0) return draft
  return withPath(draft, ref, (p) => ({
    vertices: p.vertices.slice(0, -1),
    segments: p.segments.slice(0, -1)
  }))
}

/** Append a new empty part; returns the draft and the new active path ref. */
export function startPart(draft: DraftGeometry): { draft: DraftGeometry; active: PathRef } {
  return {
    draft: { parts: [...draft.parts, emptyPart()] },
    active: { part: draft.parts.length, ring: 0 }
  }
}

/** Append a new empty hole to the given part; returns the new active path ref. */
export function startHole(
  draft: DraftGeometry,
  partIdx: number
): { draft: DraftGeometry; active: PathRef } {
  const part = draft.parts[partIdx]
  if (!part) return { draft, active: { part: partIdx, ring: 0 } }
  return {
    draft: {
      parts: draft.parts.map((p, i) =>
        i === partIdx ? { ...p, holes: [...p.holes, emptyPath()] } : p
      )
    },
    active: { part: partIdx, ring: part.holes.length + 1 }
  }
}

/** Drop an empty trailing hole/part (used when undoing out of one). */
export function dropEmptyPath(
  draft: DraftGeometry,
  ref: PathRef
): { draft: DraftGeometry; active: PathRef } {
  const path = getPath(draft, ref)
  if (!path || path.vertices.length > 0) return { draft, active: ref }
  if (ref.ring > 0) {
    return {
      draft: {
        parts: draft.parts.map((p, i) =>
          i === ref.part ? { ...p, holes: p.holes.filter((_, h) => h !== ref.ring - 1) } : p
        )
      },
      active: { part: ref.part, ring: 0 }
    }
  }
  if (ref.part > 0 && draft.parts.length > 1) {
    return {
      draft: { parts: draft.parts.filter((_, i) => i !== ref.part) },
      active: { part: ref.part - 1, ring: 0 }
    }
  }
  return { draft, active: ref }
}

/** Replace a path's vertices wholesale (shape tools: rectangle/circle/freehand). */
export function setPathVertices(
  draft: DraftGeometry,
  ref: PathRef,
  vertices: Position[]
): DraftGeometry {
  return withPath(draft, ref, () => ({
    vertices,
    segments: vertices.length > 1 ? Array.from({ length: vertices.length - 1 }, () => 'line' as const) : []
  }))
}

/** Translate every vertex in the draft (move-feature tool). */
export function translateDraft(draft: DraftGeometry, dLng: number, dLat: number): DraftGeometry {
  const shift = (path: DraftPath): DraftPath => ({
    segments: path.segments.map((s) =>
      s === 'line' ? s : { kind: 'arc', via: [s.via[0] + dLng, s.via[1] + dLat] as Position }
    ),
    vertices: path.vertices.map(([x, y]) => [x + dLng, y + dLat] as Position)
  })
  return {
    parts: draft.parts.map((p) => ({ exterior: shift(p.exterior), holes: p.holes.map(shift) }))
  }
}

// ── GeoJSON conversion ───────────────────────────────────────────────────────

/**
 * Densify a path into coordinates: straight segments pass vertices through,
 * arc segments expand via their through-point at ≤ 4°/step.
 */
export function pathDisplayCoords(path: DraftPath): number[][] {
  if (path.vertices.length === 0) return []
  const out: number[][] = [[path.vertices[0][0], path.vertices[0][1]]]
  for (let i = 1; i < path.vertices.length; i++) {
    const seg = path.segments[i - 1] ?? 'line'
    if (seg === 'line') {
      out.push([path.vertices[i][0], path.vertices[i][1]])
    } else {
      for (const p of densifyArc(path.vertices[i - 1], seg.via, path.vertices[i])) {
        out.push([p[0], p[1]])
      }
    }
  }
  return out
}

/**
 * True when the path carries its own closing vertex (last ≡ first) — rings
 * parsed from WKT keep an explicit closure when the closing segment is an
 * arc; drawn rings close implicitly.
 */
export function isPathExplicitlyClosed(path: DraftPath): boolean {
  const n = path.vertices.length
  if (n < 3) return false
  const a = path.vertices[0]
  const b = path.vertices[n - 1]
  return Math.abs(a[0] - b[0]) <= 1e-12 && Math.abs(a[1] - b[1]) <= 1e-12
}

function pathCoords(path: DraftPath, close: boolean): number[][] {
  const coords = pathDisplayCoords(path)
  if (close && path.vertices.length >= 3 && !isPathExplicitlyClosed(path)) {
    coords.push([coords[0][0], coords[0][1]])
  }
  return coords
}

function validRing(path: DraftPath): boolean {
  return path.vertices.length >= 3
}

/**
 * Convert the draft to a GeoJSON geometry.
 *
 * `lenient` (display mode) silently drops incomplete parts/holes so the
 * overlay can render mid-draw; strict mode (commit) returns null when the
 * draft doesn't form a valid geometry of the session type.
 */
export function draftToGeoJSON(
  draft: DraftGeometry,
  geometryType: GeometryType,
  opts: { lenient?: boolean } = {}
): GeoJSON.Geometry | null {
  const lenient = opts.lenient === true

  switch (geometryType) {
    case 'POINT': {
      const v = draft.parts[0]?.exterior.vertices[0]
      return v ? { type: 'Point', coordinates: [v[0], v[1]] } : null
    }
    case 'MULTIPOINT': {
      const verts = draft.parts.flatMap((p) => p.exterior.vertices)
      if (verts.length === 0) return null
      return { type: 'MultiPoint', coordinates: verts.map(([x, y]) => [x, y]) }
    }
    case 'LINESTRING': {
      const path = draft.parts[0]?.exterior
      if (!path || path.vertices.length < 2) return null
      return { type: 'LineString', coordinates: pathCoords(path, false) }
    }
    case 'POLYGON': {
      const part = draft.parts[0]
      if (!part || !validRing(part.exterior)) return null
      const holes = part.holes.filter(validRing)
      if (!lenient && holes.length !== part.holes.length) {
        // strict commit refuses drafts with malformed holes only when they
        // have vertices; empty holes are just abandoned "Start hole" actions
        const bad = part.holes.some((h) => h.vertices.length > 0 && !validRing(h))
        if (bad) return null
      }
      return {
        type: 'Polygon',
        coordinates: [pathCoords(part.exterior, true), ...holes.map((h) => pathCoords(h, true))]
      }
    }
    case 'MULTILINESTRING': {
      const lines = draft.parts
        .map((p) => p.exterior)
        .filter((p) => p.vertices.length >= 2)
      if (lines.length === 0) return null
      if (!lenient) {
        const bad = draft.parts.some(
          (p) => p.exterior.vertices.length === 1 // a stray single-vertex part
        )
        if (bad) return null
      }
      return { type: 'MultiLineString', coordinates: lines.map((l) => pathCoords(l, false)) }
    }
    case 'MULTIPOLYGON': {
      const parts = draft.parts.filter((p) => validRing(p.exterior))
      if (parts.length === 0) return null
      if (!lenient) {
        const bad = draft.parts.some(
          (p) =>
            (p.exterior.vertices.length > 0 && !validRing(p.exterior)) ||
            p.holes.some((h) => h.vertices.length > 0 && !validRing(h))
        )
        if (bad) return null
      }
      return {
        type: 'MultiPolygon',
        coordinates: parts.map((p) => [
          pathCoords(p.exterior, true),
          ...p.holes.filter(validRing).map((h) => pathCoords(h, true))
        ])
      }
    }
  }
}

// ── Session-level predicates ─────────────────────────────────────────────────

export function canComplete(session: GeometryEditSession): boolean {
  return draftToGeoJSON(session.draft, session.geometryType) !== null
}

/** Whether "Start next part" is available (MULTI* with a finishable active part). */
export function canStartNextPart(session: GeometryEditSession): boolean {
  const { geometryType, draft, activePath } = session
  const isMulti = geometryType === 'MULTILINESTRING' || geometryType === 'MULTIPOLYGON'
  if (!isMulti) return false
  const path = getPath(draft, activePath)
  if (!path) return false
  const min = geometryType === 'MULTILINESTRING' ? 2 : 3
  return path.vertices.length >= min
}

/** Whether "Start hole" is available (polygon with a closable active ring). */
export function canStartHole(session: GeometryEditSession): boolean {
  const { geometryType, draft, activePath } = session
  if (geometryType !== 'POLYGON' && geometryType !== 'MULTIPOLYGON') return false
  const exterior = getPath(draft, { part: activePath.part, ring: 0 })
  if (!exterior || exterior.vertices.length < 3) return false
  // Only start a new hole when the current path is complete
  const current = getPath(draft, activePath)
  return current !== null && (activePath.ring === 0 || current.vertices.length >= 3)
}

// ── Midpoint handles ─────────────────────────────────────────────────────────

export interface MidpointHandle {
  lng: number
  lat: number
  part: number
  ring: number
  insertAfterIdx: number
}

export function computeMidpointHandles(session: GeometryEditSession): MidpointHandle[] {
  const isPolygon =
    session.geometryType === 'POLYGON' || session.geometryType === 'MULTIPOLYGON'
  const handles: MidpointHandle[] = []

  for (const { ref, path } of allPaths(session.draft)) {
    const verts = path.vertices
    for (let i = 0; i < verts.length - 1; i++) {
      handles.push({
        lng: (verts[i][0] + verts[i + 1][0]) / 2,
        lat: (verts[i][1] + verts[i + 1][1]) / 2,
        part: ref.part,
        ring: ref.ring,
        insertAfterIdx: i
      })
    }
    // Closing edge for rings (explicitly closed rings already covered above)
    if ((isPolygon || ref.ring > 0) && verts.length >= 3 && !isPathExplicitlyClosed(path)) {
      const a = verts[verts.length - 1]
      const b = verts[0]
      handles.push({
        lng: (a[0] + b[0]) / 2,
        lat: (a[1] + b[1]) / 2,
        part: ref.part,
        ring: ref.ring,
        insertAfterIdx: verts.length - 1
      })
    }
  }
  return handles
}
