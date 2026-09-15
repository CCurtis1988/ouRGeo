import { describe, it, expect } from 'vitest'
import { circumcircle, densifyArc } from './arc'
import { destination, inverse } from './cogo'
import type { Position } from './types'

describe('circumcircle', () => {
  it('finds the circle through three points', () => {
    // Right triangle on the unit circle
    const cc = circumcircle([1, 0], [0, 1], [-1, 0])!
    expect(cc.cx).toBeCloseTo(0)
    expect(cc.cy).toBeCloseTo(0)
    expect(cc.r).toBeCloseTo(1)
  })

  it('returns null for collinear points', () => {
    expect(circumcircle([0, 0], [1, 1], [2, 2])).toBeNull()
  })

  // The degeneracy test has to be relative, because this function is used at
  // 1 m and at 200 km in the same session. An absolute `1e-12` in degree² units
  // is what used to make short arcs go singular, putting a 15 mm floor under
  // the whole arc pipeline that no amount of subdivision could get past.
  it('still finds a genuine arc at metre scale', () => {
    // A 1 m chord bulging by 1 mm — tiny, but a real arc.
    const cc = circumcircle([0, 0], [0.5, 0.001], [1, 0])
    expect(cc).not.toBeNull()
    expect(cc!.r).toBeGreaterThan(100) // ≈ 125 m
  })

  it('still finds a genuine arc at hundred-kilometre scale', () => {
    const cc = circumcircle([0, 0], [100_000, 10], [200_000, 0])
    expect(cc).not.toBeNull()
  })
})

describe('densifyArc', () => {
  it('passes near the via point and ends exactly at the end point', () => {
    const pts = densifyArc([1, 0], [0, 1], [-1, 0], 4)
    expect(pts[pts.length - 1]).toEqual([-1, 0])
    // Some sample must come close to the via point
    const nearVia = pts.some((p) => Math.hypot(p[0] - 0, p[1] - 1) < 0.05)
    expect(nearVia).toBe(true)
    // Half circle at ≤4°/step needs ≥ 45 segments
    expect(pts.length).toBeGreaterThanOrEqual(45)
  })

  it('takes the sweep through the via point, not the short way', () => {
    // via on the long way around: start (1,0) → end (0,1) via (0,-1)
    const pts = densifyArc([1, 0], [0, -1], [0, 1], 10)
    const nearVia = pts.some((p) => Math.hypot(p[0] - 0, p[1] + 1) < 0.1)
    expect(nearVia).toBe(true)
  })

  it('degrades to the end point for collinear input', () => {
    expect(densifyArc([0, 0], [1, 1], [2, 2])).toEqual([[2, 2]])
  })
})

/**
 * The arc is a circle on the GROUND, not in the lng/lat plane.
 *
 * This is the property the old implementation did not have and the reason a
 * typed curve is worth typing. Measured against true ground geometry, one
 * three-point arc stored the old way deviated by 24.6 m at latitude 45 and
 * 46.8 m at latitude 60 (R = 250 m, Δ = 90°), because a degree of longitude is
 * shorter than a degree of latitude by cos φ and a circle in that plane is an
 * ellipse on the ground. Subdivision could not fix it — the error bottomed out
 * near 15 mm and then climbed again.
 *
 * Each case below takes three points off a TRUE circle of constant geodesic
 * radius, densifies the arc through them, and asks how far every interpolated
 * point strays from that radius. The tolerances are ~40 000× tighter than the
 * old behaviour, so a regression here cannot be subtle.
 */
describe('densifyArc is circular on the ground', () => {
  const onCircle = (centre: Position, radiusM: number, azDeg: number): Position =>
    destination(centre, radiusM, azDeg)

  const worstRadiusErrorM = (centre: Position, radiusM: number, deltaDeg: number): number => {
    const start = onCircle(centre, radiusM, 0)
    const via = onCircle(centre, radiusM, deltaDeg / 2)
    const end = onCircle(centre, radiusM, deltaDeg)
    let worst = 0
    for (const p of densifyArc(start, via, end, 1)) {
      worst = Math.max(worst, Math.abs(inverse(centre, p).distanceM - radiusM))
    }
    return worst
  }

  it.each([
    // centre latitude, radius (m), sweep (deg), tolerance (m)
    [0, 250, 90, 0.002],
    [45, 50, 90, 0.002],
    [45, 250, 90, 0.005],
    [60, 50, 90, 0.002],
    [60, 250, 90, 0.005],
    [60, 250, 30, 0.002],
    [-60, 250, 90, 0.005],
  ])('lat %i, R=%im, Δ=%i° stays within %f m of the true radius', (lat, r, delta, tol) => {
    expect(worstRadiusErrorM([-122.4, lat], r, delta)).toBeLessThan(tol)
  })

  it('is millimetre-accurate where the old code was 46 m out', () => {
    // The headline case: R = 250 m through 90° at latitude 60.
    const worst = worstRadiusErrorM([-122.4, 60], 250, 90)
    expect(worst).toBeLessThan(0.005)
    expect(worst).toBeLessThan(46.8 / 1000) // four orders of magnitude better
  })

  it('survives an arc that spans the antimeridian', () => {
    const centre: Position = [179.9, 10]
    const worst = worstRadiusErrorM(centre, 2000, 90)
    expect(Number.isFinite(worst)).toBe(true)
    expect(worst).toBeLessThan(0.05)
    // and the output does not jump a full turn of longitude
    const pts = densifyArc(
      destination(centre, 2000, 0), destination(centre, 2000, 45), destination(centre, 2000, 90), 4
    )
    for (const p of pts) expect(Math.abs(p[0] - centre[0])).toBeLessThan(1)
  })
})
