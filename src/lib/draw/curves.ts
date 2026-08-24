import type { DraftPath, Position } from './types'
import { pathDisplayCoords } from './draft'

/**
 * Curve-construction math for the additional GIS segment types (Endpoint Arc,
 * Tangent Curve, Bézier). Like arc.ts these work in the lng/lat plane and feed
 * the existing symbolic `{ kind: 'arc'; via }` segment model — every curve type
 * ultimately commits as one or more circular arcs, so the WKT/sf pipeline is
 * unchanged. Bézier is approximated by an arc spline per the OGC CIRCULARSTRING
 * convention (consecutive point triples = arcs sharing endpoints).
 */

/** Cubic Bézier point at parameter t ∈ [0,1] (de Casteljau). */
export function cubicBezier(p0: Position, c1: Position, c2: Position, p3: Position, t: number): Position {
  const u = 1 - t
  const b0 = u * u * u
  const b1 = 3 * u * u * t
  const b2 = 3 * u * t * t
  const b3 = t * t * t
  return [
    b0 * p0[0] + b1 * c1[0] + b2 * c2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * c1[1] + b2 * c2[1] + b3 * p3[1]
  ]
}

/**
 * Dense polyline sample of a cubic Bézier (inclusive of both ends) for live
 * preview. `steps` line segments → `steps + 1` points.
 */
export function densifyBezier(
  p0: Position,
  c1: Position,
  c2: Position,
  p3: Position,
  steps = 32
): Position[] {
  const n = Math.max(1, Math.floor(steps))
  const out: Position[] = []
  for (let i = 0; i <= n; i++) out.push(cubicBezier(p0, c1, c2, p3, i / n))
  return out
}

/**
 * Approximate a cubic Bézier by a spline of circular arcs. Samples the curve at
 * `2*arcCount + 1` points; each consecutive triple (even, odd, even) becomes one
 * arc `{ via, end }` — the exact OGC CIRCULARSTRING point layout, so appending
 * these arc segments serializes to a real curve. Excludes the start point (it is
 * already the path's last vertex).
 */
export function bezierArcSpline(
  p0: Position,
  c1: Position,
  c2: Position,
  p3: Position,
  arcCount = 8
): { via: Position; end: Position }[] {
  const n = Math.max(1, Math.floor(arcCount))
  const samples: Position[] = []
  for (let i = 0; i <= 2 * n; i++) samples.push(cubicBezier(p0, c1, c2, p3, i / (2 * n)))
  const arcs: { via: Position; end: Position }[] = []
  for (let i = 0; i < n; i++) {
    arcs.push({ via: samples[2 * i + 1], end: samples[2 * i + 2] })
  }
  return arcs
}

/**
 * Through-point of the unique circular arc that starts at `start`, leaves it
 * tangent to unit direction `tangent`, and passes through `end`. Returns null
 * when the arc degenerates to a straight line (end lies along the tangent), so
 * the caller falls back to a straight segment.
 */
export function tangentArcVia(start: Position, end: Position, tangent: Position): Position | null {
  const tlen = Math.hypot(tangent[0], tangent[1])
  if (tlen < 1e-12) return null
  const t: Position = [tangent[0] / tlen, tangent[1] / tlen]
  // Normal to the tangent; pick the side toward `end`.
  const d: Position = [end[0] - start[0], end[1] - start[1]]
  let n: Position = [-t[1], t[0]]
  if (n[0] * d[0] + n[1] * d[1] < 0) n = [-n[0], -n[1]]
  const ndotd = n[0] * d[0] + n[1] * d[1]
  if (Math.abs(ndotd) < 1e-12) return null // end along the tangent → straight
  const R = (d[0] * d[0] + d[1] * d[1]) / (2 * ndotd)
  const cx = start[0] + n[0] * R
  const cy = start[1] + n[1] * R
  // Midpoint of the arc: bisector angle between start and end around the center,
  // on the sweep leaving `start` in direction `t`.
  const a0 = Math.atan2(start[1] - cy, start[0] - cx)
  const a1 = Math.atan2(end[1] - cy, end[0] - cx)
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  // Sweep direction is set by the sign of R (which side the center is on).
  const ccwSweep = norm(a1 - a0)
  const sweep = R >= 0 ? ccwSweep : ccwSweep - 2 * Math.PI
  const aMid = a0 + sweep / 2
  const r = Math.abs(R)
  return [cx + r * Math.cos(aMid), cy + r * Math.sin(aMid)]
}

/**
 * Unit direction of the path at its last vertex, taken from the last two
 * densified display points (so it reflects a preceding arc's end tangent as well
 * as a straight segment). Null when the path has fewer than two display points.
 */
export function incomingTangent(path: DraftPath): Position | null {
  const coords = pathDisplayCoords(path)
  if (coords.length < 2) return null
  const a = coords[coords.length - 2]
  const b = coords[coords.length - 1]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return null
  return [dx / len, dy / len]
}
