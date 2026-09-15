import type { DraftPath, Position } from './types'
import { pathDisplayCoords } from './draft'
import { localFrame } from './local-frame'

/**
 * Curve-construction math for the additional GIS segment types (Endpoint Arc,
 * Tangent Curve, Bézier). Every curve type ultimately commits as one or more
 * circular arcs, so the WKT/sf pipeline is unchanged. Bézier is approximated by
 * an arc spline per the OGC CIRCULARSTRING convention (consecutive point
 * triples = arcs sharing endpoints).
 *
 * **All of it happens in a local metric frame**, like `arc.ts` — see
 * `local-frame.ts`. That is not tidiness, it is required: `densifyArc`
 * interpolates a three-point arc as a circle on the GROUND, so a `via` derived
 * in the lng/lat plane would describe a different curve from the one that gets
 * drawn. Two things would break visibly:
 *
 *   - a tangent curve would leave the previous segment with a kink, because the
 *     direction it was made tangent to is not the direction on the ground;
 *   - a Bézier's dashed preview (`densifyBezier`) and the arcs it commits
 *     (`bezierArcSpline`) would disagree, so the curve would shift the instant
 *     it was placed.
 *
 * The frame is always taken at the curve's START point, which is the path's
 * last vertex — so `incomingTangent` and `tangentArcVia` are speaking the same
 * local metres about the same origin, and the caller never has to think about it.
 */

/** Cubic Bézier point at parameter t ∈ [0,1] (de Casteljau). Plain planar
 *  arithmetic in whatever units it is handed; the frame is applied by callers. */
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
 * preview. `steps` line segments → `steps + 1` points. The control net is read
 * in the local metric frame of `p0`, so the curve has the shape it appears to
 * have on the ground rather than the shape it would have in a stretched plane.
 */
export function densifyBezier(
  p0: Position,
  c1: Position,
  c2: Position,
  p3: Position,
  steps = 32
): Position[] {
  const f = localFrame(p0)
  const [q0, k1, k2, q3] = [f.toLocal(p0), f.toLocal(c1), f.toLocal(c2), f.toLocal(p3)]
  const n = Math.max(1, Math.floor(steps))
  const out: Position[] = []
  for (let i = 0; i <= n; i++) out.push(f.fromLocal(cubicBezier(q0, k1, k2, q3, i / n)))
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
  const f = localFrame(p0)
  const [q0, k1, k2, q3] = [f.toLocal(p0), f.toLocal(c1), f.toLocal(c2), f.toLocal(p3)]
  const n = Math.max(1, Math.floor(arcCount))
  const samples: Position[] = []
  for (let i = 0; i <= 2 * n; i++) samples.push(f.fromLocal(cubicBezier(q0, k1, k2, q3, i / (2 * n))))
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
 *
 * `tangent` is a direction in the LOCAL METRIC FRAME of `start` — which is what
 * `incomingTangent` returns for the same point.
 */
export function tangentArcVia(start: Position, end: Position, tangent: Position): Position | null {
  const tlen = Math.hypot(tangent[0], tangent[1])
  if (tlen < 1e-12) return null
  const f = localFrame(start)
  const s = f.toLocal(start)
  const e = f.toLocal(end)
  const t: Position = [tangent[0] / tlen, tangent[1] / tlen]
  // Normal to the tangent; pick the side toward `end`.
  const d: Position = [e[0] - s[0], e[1] - s[1]]
  let n: Position = [-t[1], t[0]]
  if (n[0] * d[0] + n[1] * d[1] < 0) n = [-n[0], -n[1]]
  const ndotd = n[0] * d[0] + n[1] * d[1]
  if (Math.abs(ndotd) < 1e-12) return null // end along the tangent → straight
  const R = (d[0] * d[0] + d[1] * d[1]) / (2 * ndotd)
  const cx = s[0] + n[0] * R
  const cy = s[1] + n[1] * R
  // Midpoint of the arc: bisector angle between start and end around the center,
  // on the sweep leaving `start` in direction `t`.
  const a0 = Math.atan2(s[1] - cy, s[0] - cx)
  const a1 = Math.atan2(e[1] - cy, e[0] - cx)
  const norm = (x: number): number => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  // Sweep direction is set by the sign of R (which side the center is on).
  const ccwSweep = norm(a1 - a0)
  const sweep = R >= 0 ? ccwSweep : ccwSweep - 2 * Math.PI
  const aMid = a0 + sweep / 2
  const r = Math.abs(R)
  return f.fromLocal([cx + r * Math.cos(aMid), cy + r * Math.sin(aMid)])
}

/**
 * Unit direction of the path at its last vertex, taken from the last two
 * densified display points (so it reflects a preceding arc's end tangent as well
 * as a straight segment). Null when the path has fewer than two display points.
 *
 * Expressed in the LOCAL METRIC FRAME of that last vertex — the frame
 * `tangentArcVia` takes for the same point, so the two compose without the
 * caller converting anything.
 */
export function incomingTangent(path: DraftPath): Position | null {
  const coords = pathDisplayCoords(path)
  if (coords.length < 2) return null
  const b = coords[coords.length - 1] as Position
  const a = coords[coords.length - 2] as Position
  const f = localFrame(b)
  const la = f.toLocal(a)
  const lb = f.toLocal(b)
  const dx = lb[0] - la[0]
  const dy = lb[1] - la[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return null
  return [dx / len, dy / len]
}

// ── A Bézier somebody typed ────────────────────────────────────────────────

export interface BezierRun {
  at: (t: number) => Position
  end: Position
  /** The two handles, for drawing them while the numbers are being typed. */
  controls: [Position, Position]
  /** The azimuth the curve arrives on — the one it was told to arrive on. */
  outAzimuthDeg: number
  /** Straight-line distance from start to end. */
  chordM: number
}

/**
 * The typed form of the draw tool's Bézier gesture.
 *
 * Clicking a Bézier is three points nobody could describe in words. Typing one
 * is a different question with the same answer: *leave here on this heading,
 * arrive there on that one, and bend smoothly in between* — which is what a
 * designed alignment, a stream centreline or a sketched boundary actually is.
 * So the entry is a destination and an arrival bearing, and the handles are
 * derived rather than asked for.
 *
 * `tension` scales them. A third of the chord is the standard choice for a
 * handle and gives the roundest curve between two headings; longer overshoots,
 * shorter tightens the bend toward the ends. It is one number with an obvious
 * default rather than two lengths nobody has on their page.
 *
 * Built in the local metric frame of the start, like everything else here — a
 * Bézier in the lng/lat plane would lean with the latitude.
 */
export function bezierCourse(
  start: Position, leaveAzDeg: number, end: Position, arriveAzDeg: number, tension = 1
): BezierRun {
  const f = localFrame(start)
  const p0 = f.toLocal(start)
  const p3 = f.toLocal(end)
  const chordM = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  const h = (Math.max(0, tension) * chordM) / 3

  const dir = (azDeg: number): Position => {
    const a = (azDeg * Math.PI) / 180
    return [Math.sin(a), Math.cos(a)]
  }
  const dLeave = dir(leaveAzDeg)
  const dArrive = dir(arriveAzDeg)
  const c1: Position = [p0[0] + h * dLeave[0], p0[1] + h * dLeave[1]]
  // The second handle points BACK along the arrival heading: a handle is where
  // the curve is coming from, not where it is going.
  const c2: Position = [p3[0] - h * dArrive[0], p3[1] - h * dArrive[1]]

  return {
    at: (t: number) => (t <= 0 ? start : t >= 1 ? end : f.fromLocal(cubicBezier(p0, c1, c2, p3, t))),
    end,
    controls: [f.fromLocal(c1), f.fromLocal(c2)],
    outAzimuthDeg: ((arriveAzDeg % 360) + 360) % 360,
    chordM,
  }
}
