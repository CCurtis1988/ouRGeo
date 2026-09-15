import { describe, it, expect } from 'vitest'
import { arcSpline, arcSplineFit, arcSplineFromSamples } from './arc-spline'
import { densifyArc } from './arc'
import { localFrame } from './local-frame'
import { solveCurve, curveGeometry } from './curve-cogo'
import { destination, inverse, toMetres } from './cogo'
import type { Position } from './types'

const FT = (v: number): number => toMetres(v, 'ft')

/** Walk the committed pieces out the way the draft does. */
function walk(start: Position, pieces: { via: Position; end: Position }[]): Position[] {
  let cursor = start
  const out: Position[] = [start]
  for (const p of pieces) {
    // 0.05° per step: the polyline's own sagitta is then ~12 micrometres, so
    // what this measures is the spline's error and not the ruler's.
    for (const q of densifyArc(cursor, p.via, p.end, 0.05)) out.push(q as Position)
    cursor = p.end
  }
  return out
}

function distToPolylineM(p: Position, poly: Position[]): number {
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

/** Worst distance from the true curve to what the pieces actually draw. */
function fitError(at: (t: number) => Position, pieces: { via: Position; end: Position }[]): number {
  const drawn = walk(at(0), pieces)
  let worst = 0
  for (let i = 0; i <= 400; i++) worst = Math.max(worst, distToPolylineM(at(i / 400), drawn))
  return worst
}

describe('arcSpline on a circular curve', () => {
  const curveAt = (radiusFt: number, deltaDeg: number): ((t: number) => Position) => {
    const el = solveCurve({
      turn: 'right',
      a: { id: 'radius', value: FT(radiusFt) },
      b: { id: 'delta', value: deltaDeg },
    })
    if (!el.ok) throw new Error(el.error)
    return curveGeometry([-122.4, 45], 30, el.value).at
  }

  /**
   * A circular curve IS an arc, so one piece should very nearly do it. This is
   * the cheapest possible check that the spline and `densifyArc` agree about
   * what a three-point arc means — if they disagreed, the simplest case in the
   * world would need subdividing.
   */
  it('needs a single piece for an ordinary curve', () => {
    const fit = arcSplineFit(curveAt(400, 60), { toleranceM: 0.001 })
    expect(fit.pieces).toHaveLength(1)
    expect(fit.errorM).toBeLessThan(0.001)
    expect(fit.truncated).toBe(false)
  })

  it.each([
    [400, 30], [400, 60], [400, 120], [250, 45.5], [1000, 90], [60, 200], [400, 350],
  ])('holds a millimetre on R=%ift Δ=%i°', (r, delta) => {
    const at = curveAt(r, delta)
    const fit = arcSplineFit(at, { toleranceM: 0.001 })
    expect(fit.truncated).toBe(false)
    expect(fitError(at, fit.pieces)).toBeLessThan(0.0015)
  })

  it('ends exactly where the curve ends', () => {
    const at = curveAt(400, 120)
    const pieces = arcSpline(at)
    const last = pieces[pieces.length - 1].end
    expect(inverse(last, at(1)).distanceM).toBeLessThan(1e-6)
  })

  it('reports when it ran out of pieces instead of pretending', () => {
    // An impossible tolerance: the fit comes back as the best available AND
    // flagged, because silently returning a worse curve than was asked for is
    // the one thing a tolerance parameter must not do.
    const fit = arcSplineFit(curveAt(400, 350), { toleranceM: 1e-12, maxPieces: 4 })
    expect(fit.truncated).toBe(true)
    expect(fit.pieces.length).toBeLessThanOrEqual(4)
    expect(fit.errorM).toBeGreaterThan(0)
  })
})

describe('arcSpline on a curve that is not circular', () => {
  /**
   * An Euler spiral — curvature growing linearly with length, which is what a
   * road actually uses to get from a tangent onto a curve. It has no
   * representation in OGC WKT at all, so an arc spline is not an optimisation
   * here, it is the only way to store the thing as a curve.
   */
  const clothoidAt = (lengthM: number, endRadiusM: number, origin: Position, az0: number) => {
    const A2 = endRadiusM * lengthM
    return (t: number): Position => {
      // Integrate the heading along the spiral: θ(s) = s²/(2A²).
      const n = 600
      const s = lengthM * t
      const h = s / n
      let east = 0
      let north = 0
      for (let i = 0; i < n; i++) {
        const u = h * (i + 0.5)
        const th = (u * u) / (2 * A2)
        east += h * Math.sin(th)
        north += h * Math.cos(th)
      }
      // Lay the local offsets down on the ground along the start heading.
      const along = destination(origin, north, az0)
      return east === 0 ? along : destination(along, east, az0 + 90)
    }
  }

  it('fits a highway spiral inside a millimetre with few pieces', () => {
    const at = clothoidAt(100, 250, [-122.4, 45], 30)
    const fit = arcSplineFit(at, { toleranceM: 0.001 })
    expect(fit.truncated).toBe(false)
    // Measured at 8; the assertion is loose enough to survive a tolerance tweak
    // and tight enough to catch the spline degenerating into densification.
    expect(fit.pieces.length).toBeLessThanOrEqual(16)
    expect(fitError(at, fit.pieces)).toBeLessThan(0.0015)
  })

  /**
   * The claim that justifies arcs over straight segments. Same piece count,
   * same curve: the arc spline should be more than an order of magnitude
   * closer, because an arc already matches the curve's curvature where a chord
   * matches nothing.
   */
  it('beats straight segments by more than an order of magnitude', () => {
    const at = clothoidAt(100, 250, [-122.4, 45], 30)
    const n = 8
    const arcs = arcSplineFit(at, { toleranceM: 0, maxPieces: n, minPieces: n })
    const arcErr = fitError(at, arcs.pieces)

    const chords: Position[] = []
    for (let i = 0; i <= n; i++) chords.push(at(i / n))
    let chordErr = 0
    for (let i = 0; i <= 400; i++) chordErr = Math.max(chordErr, distToPolylineM(at(i / 400), chords))

    expect(arcErr * 10).toBeLessThan(chordErr)
  })

  it('honours minPieces, so a closed curve is never one degenerate arc', () => {
    // A full circle's start and end coincide, and three points two of which are
    // the same define no circle at all.
    const el = solveCurve({
      turn: 'right', a: { id: 'radius', value: FT(400) }, b: { id: 'delta', value: 359.999 },
    })
    expect(el.ok).toBe(true)
    if (!el.ok) return
    const at = curveGeometry([-122.4, 45], 0, el.value).at
    const fit = arcSplineFit(at, { toleranceM: 0.001, minPieces: 2 })
    expect(fit.pieces.length).toBeGreaterThanOrEqual(2)
    expect(fitError(at, fit.pieces)).toBeLessThan(0.0015)
  })
})

describe('arcSplineFromSamples', () => {
  /** A curve sampled at exact parameters, the way R returns a grid curve. */
  const sampled = (deltaDeg: number, radiusFt: number, n: number): Position[] => {
    const el = solveCurve({
      turn: 'right', a: { id: 'radius', value: FT(radiusFt) }, b: { id: 'delta', value: deltaDeg },
    })
    if (!el.ok) throw new Error(el.error)
    const at = curveGeometry([-122.4, 45], 30, el.value).at
    return Array.from({ length: n + 1 }, (_, i) => at(i / n))
  }

  it('fits the samples it was given, with no interpolation', () => {
    const samples = sampled(90, 400, 128)
    const fit = arcSplineFromSamples(samples, { toleranceM: 0.001 })
    expect(fit.truncated).toBe(false)
    // Every via and end must BE one of the samples — interpolating between two
    // of them is what this function exists to avoid.
    for (const p of fit.pieces) {
      expect(samples.some((s) => s[0] === p.via[0] && s[1] === p.via[1])).toBe(true)
      expect(samples.some((s) => s[0] === p.end[0] && s[1] === p.end[1])).toBe(true)
    }
    expect(fit.pieces[fit.pieces.length - 1].end).toEqual(samples[samples.length - 1])
  })

  it('subdivides when one arc will not do', () => {
    // A grid circle and the geodesic circle through three of its points agree
    // to 0.03 mm at R = 250 m over 30° and diverge to 31 mm at R = 1000 m over
    // 180°, so the piece count has to answer to the measurement, not a constant.
    const gentle = arcSplineFromSamples(sampled(30, 250, 128), { toleranceM: 0.001 })
    const severe = arcSplineFromSamples(sampled(340, 4000, 128), { toleranceM: 0.001 })
    expect(gentle.pieces.length).toBeLessThan(severe.pieces.length)
  })

  it('degrades gracefully when there is almost nothing to fit', () => {
    const two = arcSplineFromSamples([[0, 0], [0.001, 0.001]])
    expect(two.pieces).toHaveLength(1)
    expect(two.pieces[0].end).toEqual([0.001, 0.001])
  })
})
