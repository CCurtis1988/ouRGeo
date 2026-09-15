import type { Position } from './types'
import { localFrame } from './local-frame'

/**
 * Circular-arc math for digitizing. Arcs are defined by three points
 * (start, through/via, end) and densified into straight segments — symbolic in
 * the draft, so the WKT emitter can still write a real CIRCULARSTRING.
 *
 * **The densification happens in a local metric frame, not in lng/lat.** The
 * three points are degrees, but the circle they define is a circle on the
 * GROUND, which is not the same as a circle in the lng/lat plane — see
 * `local-frame.ts` for the measurements, the short version being that a 250 m
 * radius arc through 90° was 46.8 m out at latitude 60 before this. Getting
 * that right is what lets a curve be typed rather than eyeballed, and it fixes
 * every arc that was ever clicked as well.
 *
 * The three defining points are untouched by any of this: the frame changes how
 * the arc BETWEEN them is interpolated, never where they are, so geometry
 * already stored round-trips unchanged and only draws correctly now.
 */

export interface Circumcircle {
  cx: number
  cy: number
  r: number
}

/**
 * Circumcircle through three points in a plane; null when collinear.
 *
 * Deliberately plain planar arithmetic with no opinion about units — callers
 * hand it a local metric frame (see `densifyArc`). The degeneracy test is
 * RELATIVE to the input's own scale: an absolute epsilon is meaningless across
 * a function used at both 1 m and 200 km, and an absolute `1e-12` in degree²
 * units is exactly what put a 15 mm floor under the old arc code.
 */
export function circumcircle(a: Position, b: Position, c: Position): Circumcircle | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  const scale = Math.max(
    Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), Math.abs(c[0]), Math.abs(c[1]), 1
  )
  if (Math.abs(d) < 1e-12 * scale * scale) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  const r = Math.hypot(a[0] - cx, a[1] - cy)
  return { cx, cy, r }
}

/**
 * Positions along the ground arc start → via → end (exclusive of start,
 * inclusive of end), stepping at most `maxAngleStepDeg` per segment. Collinear
 * input degrades to a straight segment (just the end point).
 */
export function densifyArc(
  start: Position,
  via: Position,
  end: Position,
  maxAngleStepDeg = 4
): Position[] {
  const f = localFrame(start)
  const a = f.toLocal(start)
  const b = f.toLocal(via)
  const c = f.toLocal(end)
  const cc = circumcircle(a, b, c)
  if (!cc) return [end]

  const angleOf = (p: Position): number => Math.atan2(p[1] - cc.cy, p[0] - cc.cx)
  const a0 = angleOf(a)
  const aVia = angleOf(b)
  const a1 = angleOf(c)

  // Sweep from a0 to a1 passing through aVia: choose the direction (ccw/cw)
  // whose sweep contains the via angle.
  const norm = (x: number): number => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const ccwSweep = norm(a1 - a0)
  const ccwViaOffset = norm(aVia - a0)
  const goCcw = ccwViaOffset <= ccwSweep
  const sweep = goCcw ? ccwSweep : ccwSweep - 2 * Math.PI // negative = clockwise

  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((maxAngleStepDeg * Math.PI) / 180)))
  const out: Position[] = []
  for (let i = 1; i <= steps; i++) {
    const ang = a0 + (sweep * i) / steps
    out.push(f.fromLocal([cc.cx + cc.r * Math.cos(ang), cc.cy + cc.r * Math.sin(ang)]))
  }
  // Snap the final point exactly onto the clicked end
  out[out.length - 1] = end
  return out
}
