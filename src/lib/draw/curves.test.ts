import { describe, it, expect } from 'vitest'
import { cubicBezier, densifyBezier, bezierArcSpline, tangentArcVia, incomingTangent } from './curves'
import { densifyArc } from './arc'
import { localFrame } from './local-frame'
import { inverse, destination, norm360 } from './cogo'
import type { DraftPath, Position } from './types'

describe('cubicBezier', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const p0: Position = [0, 0]
    const c1: Position = [0, 1]
    const c2: Position = [1, 1]
    const p3: Position = [1, 0]
    expect(cubicBezier(p0, c1, c2, p3, 0)).toEqual([0, 0])
    expect(cubicBezier(p0, c1, c2, p3, 1)).toEqual([1, 0])
  })

  it('is symmetric at t=0.5 for a symmetric control net', () => {
    const mid = cubicBezier([0, 0], [0, 1], [2, 1], [2, 0], 0.5)
    expect(mid[0]).toBeCloseTo(1) // midway in x
    expect(mid[1]).toBeCloseTo(0.75) // peak of the bump
  })
})

describe('densifyBezier', () => {
  it('includes both endpoints and has steps+1 points', () => {
    const pts = densifyBezier([0, 0], [0, 1], [1, 1], [1, 0], 16)
    expect(pts).toHaveLength(17)
    expect(pts[0][0]).toBeCloseTo(0)
    expect(pts[0][1]).toBeCloseTo(0)
    expect(pts[pts.length - 1][0]).toBeCloseTo(1)
    expect(pts[pts.length - 1][1]).toBeCloseTo(0)
  })
})

/** Shortest distance from a point to a polyline, in metres. */
function distToPolyline(p: Position, poly: Position[]): number {
  const f = localFrame(p)
  const q = f.toLocal(p)
  let best = Infinity
  for (let i = 1; i < poly.length; i++) {
    const a = f.toLocal(poly[i - 1])
    const b = f.toLocal(poly[i])
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
    best = Math.min(best, Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]))
  }
  return best
}

describe('bezierArcSpline', () => {
  const p0: Position = [0, 0]
  const c1: Position = [0, 1]
  const c2: Position = [1, 1]
  const p3: Position = [1, 0]

  it('produces arcCount arcs whose endpoints track the Bézier samples', () => {
    const arcs = bezierArcSpline(p0, c1, c2, p3, 8)
    expect(arcs).toHaveLength(8)
    // Last arc ends exactly at the Bézier end point.
    expect(arcs[arcs.length - 1].end[0]).toBeCloseTo(p3[0])
    expect(arcs[arcs.length - 1].end[1]).toBeCloseTo(p3[1])
    // Each arc's end == the even sample, via == the odd sample — evaluated in
    // the same local metric frame the spline is built in, because that is the
    // plane the curve's shape is defined in.
    const f = localFrame(p0)
    const at = (t: number): Position =>
      f.fromLocal(cubicBezier(f.toLocal(p0), f.toLocal(c1), f.toLocal(c2), f.toLocal(p3), t))
    arcs.forEach((a, i) => {
      const end = at((2 * i + 2) / 16)
      const via = at((2 * i + 1) / 16)
      expect(a.end[0]).toBeCloseTo(end[0])
      expect(a.end[1]).toBeCloseTo(end[1])
      expect(a.via[0]).toBeCloseTo(via[0])
      expect(a.via[1]).toBeCloseTo(via[1])
    })
  })

  /**
   * The dashed preview and the committed arcs must describe the SAME curve.
   * They are computed by two different routines — `densifyBezier` samples the
   * Bézier directly, `bezierArcSpline` hands three-point triples to
   * `densifyArc` — so nothing but a test keeps them in step, and the symptom of
   * their drifting apart is a curve that jumps the instant it is placed.
   */
  it('commits the curve its own preview drew', () => {
    const s: Position = [-122.4, 45]
    const k1: Position = [-122.398, 45.003]
    const k2: Position = [-122.393, 45.003]
    const e: Position = [-122.391, 45]

    const preview = densifyBezier(s, k1, k2, e, 2048)
    const arcs = bezierArcSpline(s, k1, k2, e, 8)

    // Walk the committed arcs out the way the draft does, then ask how far any
    // committed point is from the previewed curve.
    let cursor = s
    const committed: Position[] = [s]
    for (const a of arcs) {
      for (const p of densifyArc(cursor, a.via, a.end, 1)) committed.push(p as Position)
      cursor = a.end
    }

    // Distance to the previewed CURVE, not to its nearest sample — a sample
    // set is a polyline, and measuring to its vertices would report its own
    // discretisation as if it were error.
    let worst = 0
    for (const c of committed) worst = Math.max(worst, distToPolyline(c, preview))
    expect(worst).toBeLessThan(0.07) // 6.3 cm over a ~700 m curve, at 8 arcs
  })

  /**
   * The gap above is the arc spline's own approximation error, and this is how
   * we know that is all it is: it falls by a factor of eight for every doubling
   * of the arc count — clean cubic convergence, measured at 460 mm / 63 mm /
   * 8.1 mm / 1.0 mm / 0.07 mm for 4, 8, 16, 32 and 64 arcs at latitude 45.
   *
   * A frame mismatch between the preview and the commit would NOT converge; it
   * would sit at a constant offset however finely the curve was cut. That is
   * the regression this guards, and it is why the assertion is on the ratio
   * rather than on either number.
   */
  it('converges — so the residual is approximation, not a frame mismatch', () => {
    const s: Position = [-122.4, 45]
    const k1: Position = [-122.398, 45.003]
    const k2: Position = [-122.393, 45.003]
    const e: Position = [-122.391, 45]
    const preview = densifyBezier(s, k1, k2, e, 8192)

    const errorAt = (arcCount: number): number => {
      let cursor = s
      const committed: Position[] = [s]
      for (const a of bezierArcSpline(s, k1, k2, e, arcCount)) {
        for (const p of densifyArc(cursor, a.via, a.end, 1)) committed.push(p as Position)
        cursor = a.end
      }
      let worst = 0
      for (const c of committed) worst = Math.max(worst, distToPolyline(c, preview))
      return worst
    }

    const e8 = errorAt(8)
    const e16 = errorAt(16)
    const e32 = errorAt(32)
    expect(e16).toBeLessThan(e8 / 4)
    expect(e32).toBeLessThan(e16 / 4)
    expect(e32).toBeLessThan(0.002)
  })
})

describe('tangentArcVia', () => {
  /**
   * The claim is about the ground, not about the lng/lat plane: the arc must
   * LEAVE the start point on the given heading once it is drawn. Asserting the
   * circumcircle's centre in degrees (which is what this test used to do) would
   * pass just as happily for a curve that kinks visibly at the join.
   */
  it('leaves the start point on the tangent heading, on the ground', () => {
    const start: Position = [-122.4, 45]
    // Due east in the local metric frame — geodesic azimuth 90 at `start`.
    const tangent: Position = [1, 0]
    const end = destination(destination(start, 400, 90), 400, 0) // north-east of start
    const via = tangentArcVia(start, end, tangent)
    expect(via).not.toBeNull()

    // A fine step, so the first chord's azimuth is the tangent to within half
    // a step rather than half a segment.
    const pts = densifyArc(start, via!, end, 0.05)
    const leaving = inverse(start, pts[0] as Position).initialAzimuth
    expect(Math.abs(norm360(leaving - 90 + 180) - 180)).toBeLessThan(0.1)

    // …and it still arrives exactly where it was asked to.
    expect(inverse(pts[pts.length - 1] as Position, end).distanceM).toBeLessThan(1e-6)
  })

  it('returns null when the end lies along the tangent (straight)', () => {
    expect(tangentArcVia([0, 0], [2, 0], [1, 0])).toBeNull()
  })
})

describe('incomingTangent', () => {
  it('is the unit direction of the last straight segment', () => {
    const path: DraftPath = { vertices: [[0, 0], [2, 0]], segments: ['line'] }
    const t = incomingTangent(path)!
    expect(t[0]).toBeCloseTo(1)
    expect(t[1]).toBeCloseTo(0)
  })

  /**
   * A diagonal is what tells the two frames apart. One degree east by one
   * degree north is 45° in the lng/lat plane at every latitude — and at
   * latitude 60 it is 26.6° on the ground, because that degree of longitude is
   * half as long. The ground answer is the one a tangent curve needs.
   */
  it('reads the direction on the ground, not in the lng/lat plane', () => {
    const path: DraftPath = { vertices: [[0, 60], [1, 61]], segments: ['line'] }
    const t = incomingTangent(path)!
    expect(Math.hypot(t[0], t[1])).toBeCloseTo(1)
    // The frame is taken at the path's LAST vertex, so these are the metres
    // per degree at latitude 61: 54 107 east against 111 429 north.
    expect(t[0]).toBeCloseTo(0.4368, 3)
    expect(t[1]).toBeCloseTo(0.8995, 3)
    // Emphatically not the 0.7071 / 0.7071 the lng/lat plane would have given.
    expect(Math.abs(t[0] - Math.SQRT1_2)).toBeGreaterThan(0.2)
  })

  it('is null when the path has fewer than two points', () => {
    expect(incomingTangent({ vertices: [[0, 0]], segments: [] })).toBeNull()
  })
})
