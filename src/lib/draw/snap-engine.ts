import Flatbush from 'flatbush'
import type { SpatialLayer } from '@/store/spatial'
import type { GeometryEditSession, SnapTarget } from '@/store/geometryEdit'
import type { SnapSettings } from '@/store/spatialSettings'
import type { Position } from './types'
import { allPaths } from './draft'

/**
 * Spatial-indexed snapping over every visible layer plus the in-progress
 * draft. Each layer's segments go into a flatbush R-tree (rebuilt lazily when
 * its FeatureCollection identity changes); a query pulls the few segments
 * around the cursor and derives vertex / edge / midpoint / intersection
 * candidates in pixel space.
 *
 * Priority: vertex > intersection > midpoint > edge (closest wins per kind).
 */

interface SegmentIndex {
  /** [ax, ay, bx, by] per segment (degenerate a==b for points). */
  segs: Float64Array
  flat: Flatbush | null
}

interface LayerEntry {
  geojson: GeoJSON.FeatureCollection
  index: SegmentIndex
}

type Project = (lngLat: [number, number]) => { x: number; y: number }
type Unproject = (point: [number, number]) => { lng: number; lat: number }

function collectSegments(geojson: GeoJSON.FeatureCollection): Float64Array {
  const out: number[] = []
  const walkLine = (coords: number[][]) => {
    if (coords.length === 1) {
      out.push(coords[0][0], coords[0][1], coords[0][0], coords[0][1])
      return
    }
    for (let i = 0; i < coords.length - 1; i++) {
      out.push(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
    }
  }
  const walkGeom = (g: GeoJSON.Geometry) => {
    switch (g.type) {
      case 'Point':
        out.push(g.coordinates[0], g.coordinates[1], g.coordinates[0], g.coordinates[1])
        break
      case 'MultiPoint':
        for (const c of g.coordinates) out.push(c[0], c[1], c[0], c[1])
        break
      case 'LineString':
        walkLine(g.coordinates)
        break
      case 'MultiLineString':
        for (const line of g.coordinates) walkLine(line)
        break
      case 'Polygon':
        for (const ring of g.coordinates) walkLine(ring)
        break
      case 'MultiPolygon':
        for (const poly of g.coordinates) for (const ring of poly) walkLine(ring)
        break
      case 'GeometryCollection':
        for (const sub of g.geometries) walkGeom(sub)
        break
    }
  }
  for (const f of geojson.features) {
    if (f.geometry) walkGeom(f.geometry)
  }
  return new Float64Array(out)
}

function buildIndex(geojson: GeoJSON.FeatureCollection): SegmentIndex {
  const segs = collectSegments(geojson)
  const n = segs.length / 4
  if (n === 0) return { segs, flat: null }
  const flat = new Flatbush(n)
  for (let i = 0; i < n; i++) {
    const ax = segs[i * 4], ay = segs[i * 4 + 1], bx = segs[i * 4 + 2], by = segs[i * 4 + 3]
    flat.add(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by))
  }
  flat.finish()
  return { segs, flat }
}

interface PxSegment {
  ax: number; ay: number; bx: number; by: number
  aLng: number; aLat: number; bLng: number; bLat: number
}

function closestOnSegmentPx(px: number, py: number, s: PxSegment): { x: number; y: number; t: number } {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  if (dx === 0 && dy === 0) return { x: s.ax, y: s.ay, t: 0 }
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / (dx * dx + dy * dy)))
  return { x: s.ax + t * dx, y: s.ay + t * dy, t }
}

/** Intersection point of two segments in pixel space (null if none or shared endpoint). */
function segIntersectPx(s1: PxSegment, s2: PxSegment): { x: number; y: number } | null {
  const d1x = s1.bx - s1.ax, d1y = s1.by - s1.ay
  const d2x = s2.bx - s2.ax, d2y = s2.by - s2.ay
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-12) return null
  const t = ((s2.ax - s1.ax) * d2y - (s2.ay - s1.ay) * d2x) / denom
  const u = ((s2.ax - s1.ax) * d1y - (s2.ay - s1.ay) * d1x) / denom
  const EPS = 1e-6
  if (t < EPS || t > 1 - EPS || u < EPS || u > 1 - EPS) return null
  return { x: s1.ax + t * d1x, y: s1.ay + t * d1y }
}

const KIND_PRIORITY: Record<SnapTarget['type'], number> = {
  vertex: 0,
  intersection: 1,
  midpoint: 2,
  edge: 3
}

export class SnapEngine {
  private layers = new Map<string, LayerEntry>()

  /** Rebuild indexes lazily — only layers whose FeatureCollection identity changed. */
  updateLayers(layers: SpatialLayer[]) {
    const seen = new Set<string>()
    for (const l of layers) {
      if (!l.visible) continue
      seen.add(l.id)
      const entry = this.layers.get(l.id)
      if (!entry || entry.geojson !== l.geojson) {
        this.layers.set(l.id, { geojson: l.geojson, index: buildIndex(l.geojson) })
      }
    }
    for (const id of [...this.layers.keys()]) {
      if (!seen.has(id)) this.layers.delete(id)
    }
  }

  query(
    cursorPx: { x: number; y: number },
    project: Project,
    unproject: Unproject,
    settings: SnapSettings,
    session: GeometryEditSession | null
  ): SnapTarget | null {
    const { kinds, tolerancePx } = settings
    if (!kinds.vertex && !kinds.edge && !kinds.midpoint && !kinds.intersection) return null

    // Cursor bbox in geographic space (accounts for latitude scale + rotation)
    const corners = [
      unproject([cursorPx.x - tolerancePx, cursorPx.y - tolerancePx]),
      unproject([cursorPx.x + tolerancePx, cursorPx.y - tolerancePx]),
      unproject([cursorPx.x - tolerancePx, cursorPx.y + tolerancePx]),
      unproject([cursorPx.x + tolerancePx, cursorPx.y + tolerancePx])
    ]
    const minLng = Math.min(...corners.map((c) => c.lng))
    const maxLng = Math.max(...corners.map((c) => c.lng))
    const minLat = Math.min(...corners.map((c) => c.lat))
    const maxLat = Math.max(...corners.map((c) => c.lat))

    // Gather nearby segments (projected to px) from every indexed layer
    const candidates: PxSegment[] = []
    for (const entry of this.layers.values()) {
      const { segs, flat } = entry.index
      if (!flat) continue
      for (const i of flat.search(minLng, minLat, maxLng, maxLat)) {
        const aLng = segs[i * 4], aLat = segs[i * 4 + 1]
        const bLng = segs[i * 4 + 2], bLat = segs[i * 4 + 3]
        const a = project([aLng, aLat])
        const b = project([bLng, bLat])
        candidates.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, aLng, aLat, bLng, bLat })
      }
    }

    // Draft segments (small — linear pass, no index)
    if (session) {
      for (const { path } of allPaths(session.draft)) {
        const verts = path.vertices
        if (verts.length === 1) {
          candidates.push(this.toPxSegment(verts[0], verts[0], project))
        }
        for (let i = 0; i < verts.length - 1; i++) {
          candidates.push(this.toPxSegment(verts[i], verts[i + 1], project))
        }
      }
    }

    if (candidates.length === 0) return null

    let best: SnapTarget | null = null
    let bestPriority = Infinity
    let bestDist = tolerancePx

    const consider = (
      x: number,
      y: number,
      lngLat: { lng: number; lat: number } | null,
      type: SnapTarget['type']
    ) => {
      const dist = Math.hypot(x - cursorPx.x, y - cursorPx.y)
      if (dist > tolerancePx) return
      const priority = KIND_PRIORITY[type]
      if (priority < bestPriority || (priority === bestPriority && dist < bestDist)) {
        const ll = lngLat ?? unproject([x, y])
        best = { lng: ll.lng, lat: ll.lat, type }
        bestPriority = priority
        bestDist = dist
      }
    }

    for (const s of candidates) {
      if (kinds.vertex) {
        consider(s.ax, s.ay, { lng: s.aLng, lat: s.aLat }, 'vertex')
        consider(s.bx, s.by, { lng: s.bLng, lat: s.bLat }, 'vertex')
      }
      const degenerate = s.ax === s.bx && s.ay === s.by
      if (degenerate) continue
      if (kinds.midpoint) {
        consider((s.ax + s.bx) / 2, (s.ay + s.by) / 2, null, 'midpoint')
      }
      if (kinds.edge) {
        const p = closestOnSegmentPx(cursorPx.x, cursorPx.y, s)
        consider(p.x, p.y, null, 'edge')
      }
    }

    // Intersections among the handful of nearby segments (lazy, local only)
    if (kinds.intersection && candidates.length >= 2 && candidates.length <= 64) {
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const p = segIntersectPx(candidates[i], candidates[j])
          if (p) consider(p.x, p.y, null, 'intersection')
        }
      }
    }

    return best
  }

  private toPxSegment(a: Position, b: Position, project: Project): PxSegment {
    const pa = project(a)
    const pb = project(b)
    return {
      ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y,
      aLng: a[0], aLat: a[1], bLng: b[0], bLat: b[1]
    }
  }
}
