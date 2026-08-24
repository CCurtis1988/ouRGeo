import type { Position } from './types'

/**
 * Circular-arc math for digitizing. Arcs are defined by three points
 * (start, through/via, end) and densified into straight segments in
 * geographic coordinate space — deterministic and view-independent
 * (GeoJSON/sf have no curve primitives).
 */

export interface Circumcircle {
  cx: number
  cy: number
  r: number
}

/** Circumcircle through three points in the lng/lat plane; null when collinear. */
export function circumcircle(a: Position, b: Position, c: Position): Circumcircle | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  const r = Math.hypot(a[0] - cx, a[1] - cy)
  return { cx, cy, r }
}

/**
 * Positions along the arc start → via → end (exclusive of start, inclusive
 * of end), stepping at most `maxAngleStepDeg` per segment. Collinear input
 * degrades to a straight segment (just the end point).
 */
export function densifyArc(
  start: Position,
  via: Position,
  end: Position,
  maxAngleStepDeg = 4
): Position[] {
  const cc = circumcircle(start, via, end)
  if (!cc) return [end]

  const angleOf = (p: Position) => Math.atan2(p[1] - cc.cy, p[0] - cc.cx)
  const a0 = angleOf(start)
  const aVia = angleOf(via)
  const a1 = angleOf(end)

  // Sweep from a0 to a1 passing through aVia: choose the direction (ccw/cw)
  // whose sweep contains the via angle.
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const ccwSweep = norm(a1 - a0)
  const ccwViaOffset = norm(aVia - a0)
  const goCcw = ccwViaOffset <= ccwSweep
  const sweep = goCcw ? ccwSweep : ccwSweep - 2 * Math.PI // negative = clockwise

  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((maxAngleStepDeg * Math.PI) / 180)))
  const out: Position[] = []
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps
    out.push([cc.cx + cc.r * Math.cos(a), cc.cy + cc.r * Math.sin(a)])
  }
  // Snap the final point exactly onto the clicked end
  out[out.length - 1] = end
  return out
}
