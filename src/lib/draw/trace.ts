import type { Position } from './types'

/**
 * Boundary-following trace math: project a click onto a feature's linework,
 * then extract the run of vertices between two projected points (either way
 * around for closed rings).
 */

export interface TracePath {
  vertices: Position[]
  closed: boolean
}

export interface PathProjection {
  /** Segment index the projection falls on (vertices[segIdx] → [segIdx+1]). */
  segIdx: number
  /** Parameter along that segment, 0..1. */
  t: number
  point: Position
}

/** Every traceable path (rings and line parts) of a geometry. Rings keep their closing vertex trimmed. */
export function geometryTracePaths(geometry: GeoJSON.Geometry): TracePath[] {
  const ring = (coords: number[][]): TracePath => {
    let pts = coords
    if (pts.length >= 2) {
      const f = pts[0]
      const l = pts[pts.length - 1]
      if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1)
    }
    return { vertices: pts.map((c) => [c[0], c[1]] as Position), closed: true }
  }
  const line = (coords: number[][]): TracePath => ({
    vertices: coords.map((c) => [c[0], c[1]] as Position),
    closed: false
  })

  switch (geometry.type) {
    case 'LineString':
      return [line(geometry.coordinates)]
    case 'MultiLineString':
      return geometry.coordinates.map(line)
    case 'Polygon':
      return geometry.coordinates.map(ring)
    case 'MultiPolygon':
      return geometry.coordinates.flatMap((poly) => poly.map(ring))
    default:
      return []
  }
}

function segCount(path: TracePath): number {
  return path.closed ? path.vertices.length : path.vertices.length - 1
}

function segEnd(path: TracePath, i: number): Position {
  return path.vertices[(i + 1) % path.vertices.length]
}

/** Nearest point on the path to `pt` (planar lng/lat distance). */
export function projectOntoPath(path: TracePath, pt: Position): PathProjection | null {
  const n = segCount(path)
  if (n < 1) return null
  let best: PathProjection | null = null
  let bestDist = Infinity
  for (let i = 0; i < n; i++) {
    const a = path.vertices[i]
    const b = segEnd(path, i)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq))
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    const dist = Math.hypot(pt[0] - px, pt[1] - py)
    if (dist < bestDist) {
      bestDist = dist
      best = { segIdx: i, t, point: [px, py] }
    }
  }
  return best
}

/**
 * Vertices along the path from `from` to `to`, inclusive of both projected
 * endpoints. Open paths have one route; closed rings have two — `reverse`
 * picks the backward (decreasing index) direction.
 */
export function extractSubPath(
  path: TracePath,
  from: PathProjection,
  to: PathProjection,
  reverse: boolean
): Position[] {
  const n = segCount(path)
  if (n < 1) return [from.point, to.point]
  const sFrom = from.segIdx + from.t
  const sTo = to.segIdx + to.t

  if (!path.closed) {
    // Single route through the middle; emit it starting at `from`.
    const [lo, hi, flip] = sFrom <= sTo ? [from, to, false] : [to, from, true]
    const out: Position[] = [lo.point]
    for (let i = lo.segIdx + 1; i <= hi.segIdx; i++) out.push(path.vertices[i])
    out.push(hi.point)
    if (flip) out.reverse()
    return dedupe(out)
  }

  const count = path.vertices.length
  const out: Position[] = [from.point]
  if (!reverse) {
    // Forward: vertices from.segIdx+1, +2, … up to to.segIdx (wrapping)
    let k: number
    if (to.segIdx > from.segIdx) k = to.segIdx - from.segIdx
    else if (to.segIdx < from.segIdx) k = count - from.segIdx + to.segIdx
    else k = sTo >= sFrom ? 0 : count // same segment: ahead → direct, behind → full loop
    for (let step = 1; step <= k; step++) {
      out.push(path.vertices[(from.segIdx + step) % count])
    }
  } else {
    // Backward: vertices from.segIdx, -1, … down to to.segIdx+1 (wrapping)
    let k: number
    if (from.segIdx > to.segIdx) k = from.segIdx - to.segIdx
    else if (from.segIdx < to.segIdx) k = from.segIdx + count - to.segIdx
    else k = sTo <= sFrom ? 0 : count
    for (let step = 0; step < k; step++) {
      out.push(path.vertices[(from.segIdx - step + count) % count])
    }
  }
  out.push(to.point)
  return dedupe(out)
}

function dedupe(points: Position[]): Position[] {
  const out: Position[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.abs(last[0] - p[0]) > 1e-12 || Math.abs(last[1] - p[1]) > 1e-12) {
      out.push(p)
    }
  }
  return out
}
