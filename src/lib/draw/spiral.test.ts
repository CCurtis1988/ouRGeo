import { describe, it, expect } from 'vitest'
import {
  spiralOffsets, spiralAngleDeg, solveSpiral, spiralGeometry,
} from './spiral'
import { arcSplineFit } from './arc-spline'
import { densifyArc } from './arc'
import { localFrame } from './local-frame'
import { inverse, norm360, toMetres } from './cogo'
import type { Position } from './types'

const FT = (v: number): number => toMetres(v, 'ft')
const RAD = Math.PI / 180

/** The offsets by Simpson integration — slow, obvious, and independent of the
 *  series under test. If the two agree, the series is right. */
function offsetsByQuadrature(s: number, aSq: number, n = 20000): { x: number; y: number } {
  const h = s / n
  let x = 0
  let y = 0
  for (let i = 0; i < n; i++) {
    const u0 = i * h
    const u1 = u0 + h / 2
    const u2 = u0 + h
    const th = (u: number): number => (u * u) / (2 * aSq)
    x += (h / 6) * (Math.cos(th(u0)) + 4 * Math.cos(th(u1)) + Math.cos(th(u2)))
    y += (h / 6) * (Math.sin(th(u0)) + 4 * Math.sin(th(u1)) + Math.sin(th(u2)))
  }
  return { x, y }
}

describe('the clothoid series', () => {
  /**
   * The series is used because this runs per keystroke and at every probe the
   * arc-spline fitter takes; quadrature would be correct and far too slow. So
   * the series has to be checked against quadrature, at angles beyond anything
   * a road would use.
   */
  it.each([
    // Ls, R — the last two are far sharper than any highway spiral: θs is
    // 28.6° and 47.7° there, against the 5–10° a road actually uses.
    [100, 1000], [100, 250], [150, 500], [60, 150], [100, 100], [100, 60],
  ])('matches quadrature for Ls=%i R=%i', (ls, r) => {
    const aSq = r * ls
    for (const frac of [0.1, 0.25, 0.5, 0.75, 1]) {
      const s = ls * frac
      const series = spiralOffsets(s, aSq)
      const exact = offsetsByQuadrature(s, aSq)
      // A hundredth of a micrometre, and that is the WORST case in this list.
      // Five orders of magnitude finer than the millimetre the geometry is
      // committed to, at a spiral no road would ever contain.
      expect(Math.abs(series.x - exact.x)).toBeLessThan(1e-8)
      expect(Math.abs(series.y - exact.y)).toBeLessThan(1e-8)
    }
  })

  it('is far better than that at an angle a road would actually use', () => {
    // Ls = 150 ft on R = 1000 ft: θs = 4.3°, which is an ordinary highway
    // spiral. Nanometres.
    const aSq = 1000 * 150
    const series = spiralOffsets(150, aSq)
    const exact = offsetsByQuadrature(150, aSq)
    expect(Math.abs(series.x - exact.x)).toBeLessThan(1e-10)
    expect(Math.abs(series.y - exact.y)).toBeLessThan(1e-10)
  })

  it('turns the spiral angle the definition says', () => {
    // θs = Ls / 2R, the relation every plan sheet is built on.
    expect(spiralAngleDeg(100, 250 * 100)).toBeCloseTo((100 / (2 * 250)) / RAD, 9)
    expect(spiralAngleDeg(0, 100)).toBe(0)
  })

  it('degenerates to a straight line at zero length', () => {
    expect(spiralOffsets(0, 1000)).toEqual({ x: 0, y: 0 })
  })
})

describe('solveSpiral', () => {
  /**
   * A worked highway spiral: Ls = 100 ft, R = 400 ft.
   *   θs = Ls/2R = 100/800 rad = 7.16197°
   *   p  = Y − R(1 − cos θs)
   *   k  = X − R sin θs
   */
  it('reproduces the figures a plan sheet quotes', () => {
    const res = solveSpiral({ form: 'in', turn: 'right', radiusM: FT(400), lengthInM: FT(100) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const e = res.value
    expect(e.thetaInDeg).toBeCloseTo(7.161972, 5)
    // A² = R·Ls, so A = sqrt(400 × 100) = 200 ft.
    expect(e.parameterInM).toBeCloseTo(FT(200), 6)
    // The shift is small and positive — the curve is thrown OFF the tangent.
    // The textbook approximation is p ≈ Ls²/24R = 10000/9600 = 1.0417 ft, and
    // the exact value sits just under it.
    expect(e.shiftM).toBeGreaterThan(0)
    expect(e.shiftM / FT(1)).toBeCloseTo(1.0411, 3)
    expect(e.shiftM / FT(1)).toBeLessThan((100 * 100) / (24 * 400))
    // k is very nearly half the spiral length, which is the check a surveyor
    // does in their head.
    expect(e.kM / FT(1)).toBeCloseTo(49.99, 1)
  })

  it('shares the deflection out between the spirals and the curve', () => {
    const res = solveSpiral({
      form: 'scs', turn: 'right', radiusM: FT(1000), lengthInM: FT(150),
      totalDeltaDeg: 45.5,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const e = res.value
    expect(e.thetaInDeg + e.thetaOutDeg + (e.curveDeltaDeg ?? 0)).toBeCloseTo(45.5, 9)
    expect(e.thetaInDeg).toBeCloseTo(e.thetaOutDeg, 9)
    // Ts = k + (R + p)·tan(Δ/2)
    expect(e.tangentM).not.toBeNull()
    expect(e.tangentM!).toBeCloseTo(
      e.kM + (e.radiusM + e.shiftM) * Math.tan((45.5 * RAD) / 2), 9
    )
  })

  it('takes two different spiral lengths', () => {
    const res = solveSpiral({
      form: 'scs', turn: 'left', radiusM: FT(800), lengthInM: FT(200), lengthOutM: FT(120),
      totalDeltaDeg: 60,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.thetaInDeg).toBeGreaterThan(res.value.thetaOutDeg)
    expect(res.value.lengthOutM).toBeCloseTo(FT(120), 9)
  })

  /**
   * The refusal that earns its place: two spirals can absorb more deflection
   * than the curve has to give, and then there is no circular arc left to put
   * between them. A plan with that in it has a typo.
   */
  it('refuses spirals that turn more than the whole deflection', () => {
    const res = solveSpiral({
      form: 'scs', turn: 'right', radiusM: FT(200), lengthInM: FT(300), totalDeltaDeg: 20,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/no circular curve left/)
      expect(res.error).toMatch(/85\.9/)  // what the spirals actually turn
    }
  })

  it('refuses the impossible and the missing', () => {
    expect(solveSpiral({ form: 'in', turn: 'right', radiusM: 0, lengthInM: 100 }).ok).toBe(false)
    expect(solveSpiral({ form: 'in', turn: 'right', radiusM: 100, lengthInM: 0 }).ok).toBe(false)
    const noDelta = solveSpiral({ form: 'scs', turn: 'right', radiusM: 100, lengthInM: 10 })
    expect(noDelta.ok).toBe(false)
    if (!noDelta.ok) expect(noDelta.error).toMatch(/total deflection/)
    // A spiral that turns more than a half circle before reaching its radius.
    const wild = solveSpiral({ form: 'in', turn: 'right', radiusM: 10, lengthInM: 400 })
    expect(wild.ok).toBe(false)
    if (!wild.ok) expect(wild.error).toMatch(/more than half a circle/)
  })
})

describe('spiralGeometry', () => {
  const origin: Position = [-122.4, 45]

  const elementsFor = (form: 'in' | 'out' | 'scs', turn: 'left' | 'right', total?: number) => {
    const r = solveSpiral({
      form, turn, radiusM: FT(1000), lengthInM: FT(150), totalDeltaDeg: total,
    })
    if (!r.ok) throw new Error(r.error)
    return r.value
  }

  it.each(['right', 'left'] as const)('leaves the tangent straight — %s', (turn) => {
    // The point of a spiral: it starts with ZERO curvature, so it leaves the
    // tangent along the tangent and only bends later.
    const el = elementsFor('in', turn)
    const run = spiralGeometry(origin, 30, el, 'in', turn)
    const justAfter = run.parts[0].at(0.001)
    expect(Math.abs(norm360(inverse(origin, justAfter).initialAzimuth - 30 + 180) - 180))
      .toBeLessThan(0.01)
  })

  it.each(['right', 'left'] as const)('arrives having turned the spiral angle — %s', (turn) => {
    const el = elementsFor('in', turn)
    const run = spiralGeometry(origin, 30, el, 'in', turn)
    const expected = norm360(30 + (turn === 'right' ? 1 : -1) * el.thetaInDeg)
    expect(Math.abs(norm360(run.outAzimuthDeg - expected + 180) - 180)).toBeLessThan(1e-6)
  })

  it('walks the length it says it does', () => {
    const el = elementsFor('in', 'right')
    const run = spiralGeometry(origin, 30, el, 'in', 'right')
    let walked = 0
    let prev = run.parts[0].at(0)
    for (let i = 1; i <= 4000; i++) {
      const p = run.parts[0].at(i / 4000)
      walked += inverse(prev, p).distanceM
      prev = p
    }
    expect(Math.abs(walked - el.lengthInM)).toBeLessThan(0.001)
  })

  /**
   * An exit spiral is the one construction here built by running a curve
   * backwards, so it gets its own check: it must start exactly where it was
   * told and leave on a tangent, curvature having fallen to zero.
   */
  it.each(['right', 'left'] as const)('runs an exit spiral back to a tangent — %s', (turn) => {
    const el = elementsFor('out', turn)
    const run = spiralGeometry(origin, 30, el, 'out', turn)
    const part = run.parts[0]

    expect(inverse(part.at(0), origin).distanceM).toBeLessThan(1e-6)
    // Straight at the END, where the curvature has gone: the last sliver of the
    // spiral lies along the outgoing tangent.
    const justBefore = part.at(0.999)
    const leaving = inverse(justBefore, part.end).initialAzimuth
    expect(Math.abs(norm360(leaving - run.outAzimuthDeg + 180) - 180)).toBeLessThan(0.05)

    // And it walks its own length.
    let walked = 0
    let prev = part.at(0)
    for (let i = 1; i <= 4000; i++) {
      const p = part.at(i / 4000)
      walked += inverse(prev, p).distanceM
      prev = p
    }
    expect(Math.abs(walked - el.lengthInM)).toBeLessThan(0.001)
  })

  it('joins a spiral–curve–spiral without a gap', () => {
    const el = elementsFor('scs', 'right', 45.5)
    const run = spiralGeometry(origin, 30, el, 'scs', 'right')
    expect(run.parts).toHaveLength(3)
    for (let i = 1; i < run.parts.length; i++) {
      // The joins are pinned rather than left to agree by luck: consecutive
      // parts are placed in local frames a few hundred metres apart.
      expect(inverse(run.parts[i - 1].end, run.parts[i].at(0)).distanceM).toBe(0)
    }
    const total = run.parts.reduce((t, p) => t + p.lengthM, 0)
    expect(total).toBeCloseTo(el.totalLengthM, 6)

    // The plan's arithmetic says the course arrives on az + Δ. The GROUND says
    // az + Δ plus the meridian convergence across the figure, and the circular
    // middle measures its arrival rather than assuming it — the same reason
    // `traverseIncoming` reads the arrival azimuth of a straight leg off the
    // geometry instead of reusing its departure azimuth. Over this curve that
    // is about a thousandth of a degree, and it is not an error: a following
    // deflection has to turn from where the course actually ended.
    const expected = norm360(30 + el.totalDeltaDeg)
    const drift = Math.abs(norm360(run.outAzimuthDeg - expected + 180) - 180)
    expect(drift).toBeGreaterThan(0)
    expect(drift).toBeLessThan(0.01)
  })

  /**
   * The curvature is continuous, which is the entire reason a spiral exists —
   * so the heading must be too. A kink at either join would mean the spiral had
   * been built pointing the wrong way, and the geometry would still LOOK
   * plausible at a glance.
   */
  it('has no kink where the spiral meets the curve', () => {
    const el = elementsFor('scs', 'right', 45.5)
    const run = spiralGeometry(origin, 30, el, 'scs', 'right')
    const headingInto = (p: { at: (t: number) => Position; end: Position }): number =>
      inverse(p.at(0.999), p.end).initialAzimuth
    const headingOutOf = (p: { at: (t: number) => Position }): number =>
      inverse(p.at(0), p.at(0.001)).initialAzimuth
    for (let i = 1; i < run.parts.length; i++) {
      const gap = Math.abs(norm360(headingInto(run.parts[i - 1]) - headingOutOf(run.parts[i]) + 180) - 180)
      expect(gap).toBeLessThan(0.1)
    }
  })

  it('commits as arcs within a millimetre', () => {
    const el = elementsFor('scs', 'right', 45.5)
    const run = spiralGeometry(origin, 30, el, 'scs', 'right')
    for (const part of run.parts) {
      const fit = arcSplineFit(part.at, { toleranceM: 0.001 })
      expect(fit.truncated).toBe(false)
      // Check what is actually drawn, not just what the fitter believed.
      let cursor = part.at(0)
      const drawn: Position[] = [cursor]
      for (const piece of fit.pieces) {
        for (const q of densifyArc(cursor, piece.via, piece.end, 0.05)) drawn.push(q as Position)
        cursor = piece.end
      }
      let worst = 0
      for (let i = 0; i <= 300; i++) {
        const p = part.at(i / 300)
        const f = localFrame(p)
        const q = f.toLocal(p)
        let near = Infinity
        for (let j = 1; j < drawn.length; j++) {
          const a = f.toLocal(drawn[j - 1])
          const b = f.toLocal(drawn[j])
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const l2 = dx * dx + dy * dy
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
          near = Math.min(near, Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]))
        }
        worst = Math.max(worst, near)
      }
      expect(worst).toBeLessThan(0.0015)
    }
  })
})
