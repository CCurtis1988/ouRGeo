import type { Position } from './types'
import { norm360, destination, inverse } from './cogo'
import { localFrame } from './local-frame'
import { curveGeometry, solveCurve, type TurnDirection } from './curve-cogo'

/**
 * The transition curve a road or a railway actually uses.
 *
 * A tangent cannot meet a circular curve directly: curvature would jump from
 * zero to 1/R at a point, and so would the lateral acceleration of anything
 * travelling along it. The Euler spiral — the clothoid — is the curve whose
 * curvature grows LINEARLY with distance along it, so the steering wheel turns
 * at a constant rate and the superelevation can be run in over a known length.
 * Every highway and rail plan-and-profile sheet is drawn with them.
 *
 *     κ(s) = s / A²        A² = R·Ls
 *     θ(s) = s² / (2A²)    θs = Ls / (2R)   — the spiral angle
 *
 * **It has no representation in any format ouRGeo can write.** ISO 19107
 * defines a clothoid abstractly; OGC WKT, GeoPackage, Shapefile and PostGIS do
 * not, so `sf` has nowhere to put one. Approximation is not a shortcut here, it
 * is the only thing available — and `arc-spline.ts` is where the choice of what
 * to approximate WITH is argued and measured. Circular arcs, by an order of
 * magnitude over straight segments, and eight of them hold a highway spiral
 * inside a millimetre while keeping it a real curve in the WKT.
 *
 * The plan quotes the spiral by its length and the radius it ends on, and every
 * other figure on the sheet — θs, the shift p, the tangent distances — follows
 * from those two. They are computed here so they can be CHECKED against the
 * sheet, which is the same reason the circular curve prints all of its elements.
 */

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/**
 * The spiral's plan offsets, as the series every route-surveying text gives.
 *
 * Both are the same integral in disguise. With θ(u) = θ·(u/s)²,
 *
 *     x = s∫₀¹cos(θv²)dv = s·Σ (−1)ⁿ θ^2n   / ((2n)!  (4n+1))
 *     y = s∫₀¹sin(θv²)dv = s·Σ (−1)ⁿ θ^2n+1 / ((2n+1)!(4n+3))
 *
 * which is where every coefficient below comes from, rather than from a table.
 *
 * A series and not numeric integration because this is evaluated per keystroke
 * while the ghost follows the fields, and again at every probe the arc-spline
 * fitter takes. It converges fast enough that the terms below are overkill for
 * anything real: at a spiral angle of 4.3° — an ordinary highway spiral — it
 * agrees with Simpson integration to a nanometre, and at 47.7°, ten times
 * sharper than any road, to a hundredth of a micrometre. `spiral.test.ts`
 * measures both.
 *
 * The y series carried one term fewer than x at first, and the asymmetry showed
 * up exactly where you would expect it to: nowhere that matters, and 2.8 µm out
 * at the absurd end. Balanced is cheaper to reason about than justified.
 */
export function spiralOffsets(s: number, aSq: number): { x: number; y: number } {
  if (s === 0) return { x: 0, y: 0 }
  const t = (s * s) / (2 * aSq)
  const t2 = t * t
  const t4 = t2 * t2
  const t6 = t4 * t2
  const t8 = t4 * t4
  const t10 = t8 * t2
  return {
    x: s * (1 - t2 / 10 + t4 / 216 - t6 / 9360 + t8 / 685440 - t10 / 76204800),
    y: s * (t / 3 - (t2 * t) / 42 + (t4 * t) / 1320 - (t6 * t) / 75600
      + (t8 * t) / 6894720 - (t10 * t) / 918086400),
  }
}

/** Heading turned through, in degrees, `s` along a spiral of parameter A². */
export function spiralAngleDeg(s: number, aSq: number): number {
  return ((s * s) / (2 * aSq)) * DEG
}

export interface SpiralElements {
  /** Length of the entry spiral. */
  lengthInM: number
  /** Length of the exit spiral — equal to the entry unless the plan says otherwise. */
  lengthOutM: number
  radiusM: number
  /** Clothoid parameter A, where A² = R·Ls. Some plans quote this instead. */
  parameterInM: number
  parameterOutM: number
  /** Spiral angle: how much heading each spiral absorbs. */
  thetaInDeg: number
  thetaOutDeg: number
  /** SCS only — what is left for the circular curve after both spirals. */
  curveDeltaDeg: number | null
  /** Total deflection of the whole course. */
  totalDeltaDeg: number
  /** Plan offsets at the end of the entry spiral. */
  xIn: number
  yIn: number
  /** The shift: how far the circular curve is thrown off the tangent. */
  shiftM: number
  /** Distance from the TS to the point the shifted curve's tangent would touch. */
  kM: number
  /** SCS only: tangent distance from the TS to the tangent intersection. */
  tangentM: number | null
  /** Ground length of the whole course, spirals plus any circular curve. */
  totalLengthM: number
}

export type SpiralForm = 'in' | 'out' | 'scs'

export interface SpiralInput {
  form: SpiralForm
  turn: TurnDirection
  radiusM: number
  lengthInM: number
  /** Defaults to `lengthInM`; a plan that specifies both is asymmetric. */
  lengthOutM?: number
  /** SCS only: the TOTAL deflection, both spirals and the curve together. */
  totalDeltaDeg?: number
}

export type SpiralResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Every figure the sheet quotes, from the length and the radius it ends on.
 *
 * The refusal that matters is the last one. An SCS's two spirals absorb
 * `θs(in) + θs(out)` of the total deflection between them, and if that is more
 * than Δ there is no circular curve left to put in the middle — the spirals
 * have already over-turned. A plan with that in it has a typo, and saying which
 * two numbers disagree is more use than a curve drawn with a negative arc.
 */
export function solveSpiral(input: SpiralInput): SpiralResult<SpiralElements> {
  const { form, radiusM } = input
  const lengthInM = input.lengthInM
  const lengthOutM = input.lengthOutM ?? input.lengthInM

  if (!(radiusM > 0)) return { ok: false, error: 'A spiral needs a radius greater than zero.' }
  if (!(lengthInM > 0)) return { ok: false, error: 'A spiral needs a length greater than zero.' }
  if (form === 'scs' && !(lengthOutM > 0)) {
    return { ok: false, error: 'The exit spiral needs a length greater than zero.' }
  }

  const aSqIn = radiusM * lengthInM
  const aSqOut = radiusM * lengthOutM
  const thetaInDeg = spiralAngleDeg(lengthInM, aSqIn)
  const thetaOutDeg = form === 'scs' ? spiralAngleDeg(lengthOutM, aSqOut) : 0

  if (thetaInDeg >= 180 || thetaOutDeg >= 180) {
    return {
      ok: false,
      error: 'That length turns the spiral more than half a circle before it reaches the radius. '
        + 'Check the length against the radius — the spiral angle is Ls ÷ 2R.',
    }
  }

  const { x: xIn, y: yIn } = spiralOffsets(lengthInM, aSqIn)
  const halfIn = thetaInDeg * RAD
  const shiftM = yIn - radiusM * (1 - Math.cos(halfIn))
  const kM = xIn - radiusM * Math.sin(halfIn)

  let curveDeltaDeg: number | null = null
  let totalDeltaDeg = thetaInDeg
  let tangentM: number | null = null
  let curveLengthM = 0

  if (form === 'scs') {
    const total = input.totalDeltaDeg
    if (total === undefined || !Number.isFinite(total) || total <= 0) {
      return { ok: false, error: 'A spiral–curve–spiral needs the total deflection Δ.' }
    }
    if (total >= 360) return { ok: false, error: 'A central angle has to be below 360°.' }
    curveDeltaDeg = total - thetaInDeg - thetaOutDeg
    if (curveDeltaDeg <= 0) {
      return {
        ok: false,
        error: `The two spirals already turn ${(thetaInDeg + thetaOutDeg).toFixed(4)}°, `
          + `which is more than the ${total}° total — there is no circular curve left between them. `
          + 'Either the spiral length is too long or the radius is too small for this Δ.',
      }
    }
    totalDeltaDeg = total
    curveLengthM = radiusM * curveDeltaDeg * RAD
    // Standard: Ts = k + (R + p)·tan(Δ/2). Only finite below a half turn.
    tangentM = total < 180
      ? kM + (radiusM + shiftM) * Math.tan((total * RAD) / 2)
      : null
  }

  return {
    ok: true,
    value: {
      lengthInM,
      lengthOutM: form === 'scs' ? lengthOutM : 0,
      radiusM,
      parameterInM: Math.sqrt(aSqIn),
      parameterOutM: Math.sqrt(aSqOut),
      thetaInDeg,
      thetaOutDeg,
      curveDeltaDeg,
      totalDeltaDeg,
      xIn,
      yIn,
      shiftM,
      kM,
      tangentM,
      totalLengthM: lengthInM + curveLengthM + (form === 'scs' ? lengthOutM : 0),
    },
  }
}

/**
 * One piece of a spiral course, as a function of its own parameter.
 *
 * Three at most — spiral, curve, spiral — and each is fitted with arcs
 * separately rather than the whole course at once. The circular middle is
 * exactly an arc and wants one piece; the spirals want about eight. Fitting
 * them together would spend the spiral's piece count on the part that did not
 * need it.
 */
export interface CoursePart {
  at: (t: number) => Position
  end: Position
  lengthM: number
}

export interface SpiralRun {
  parts: CoursePart[]
  end: Position
  outAzimuthDeg: number
  elements: SpiralElements
}

/**
 * Lay a spiral's plan offsets down on the ground.
 *
 * The offsets are (along the tangent, out to the side), so they are rotated by
 * the tangent azimuth in the same local metric frame `arc.ts` uses — the
 * spiral is a local object by nature, a few hundred metres at most, which is
 * exactly where that frame is exact.
 */
function placeOffsets(
  origin: Position, tangentAzDeg: number, sign: number, x: number, y: number
): Position {
  const f = localFrame(origin)
  const az = tangentAzDeg * RAD
  const side = (tangentAzDeg + sign * 90) * RAD
  return f.fromLocal([
    x * Math.sin(az) + y * Math.sin(side),
    x * Math.cos(az) + y * Math.cos(side),
  ])
}

/**
 * Pin a part's ends to the points they are known to be.
 *
 * Each part is placed in the local frame of its own start, and consecutive
 * parts therefore use frames a few hundred metres apart. The difference is
 * microscopic in the middle of a part and would be exactly zero nowhere — so
 * the joins are pinned rather than left to agree by luck. A gap between the end
 * of the spiral and the start of the curve would become a gap in the geometry,
 * and the arc-spline fitter would faithfully reproduce it.
 */
function pinned(at: (t: number) => Position, from: Position, to: Position): (t: number) => Position {
  return (t: number) => (t <= 0 ? from : t >= 1 ? to : at(t))
}

/**
 * An EXIT spiral is an entry spiral walked backwards, and that is the whole
 * construction.
 *
 * Travelling from the sharp end (curvature 1/R) out to the tangent, curvature
 * falls to zero — which is an entry spiral seen from the other end, with the
 * direction of travel reversed and therefore the sense of the turn reversed
 * too. So the offsets are measured in a frame anchored at the FLAT end and
 * pointing back toward the sharp one, and the flat end is found by stepping
 * back from the sharp end through those same offsets.
 */
function exitSpiral(
  sharp: Position, sharpAzDeg: number, sign: number, lengthM: number, radiusM: number,
  thetaDeg: number
): { at: (t: number) => Position; end: Position; flatAzDeg: number } {
  const aSq = radiusM * lengthM
  const full = spiralOffsets(lengthM, aSq)
  const flatAzDeg = norm360(sharpAzDeg + sign * thetaDeg)
  // The frame at the flat end, pointing back along the spiral.
  const backAz = norm360(flatAzDeg + 180)
  const flat = placeOffsets(sharp, norm360(backAz + 180), -sign, full.x, full.y)
  const at = (t: number): Position => {
    const o = spiralOffsets(lengthM * (1 - t), aSq)
    return placeOffsets(flat, backAz, -sign, o.x, o.y)
  }
  return { at: pinned(at, sharp, flat), end: flat, flatAzDeg }
}

/**
 * One piece of a spiral course, as a function of its own parameter.
 *
 * Three at most — spiral, curve, spiral — and each is fitted with arcs
 * separately rather than the whole course at once. The circular middle is
 * exactly an arc and wants one piece; the spirals want about eight. Fitting
 * them together would spend the spiral's piece count on the part that did not
 * need it.
 */
export interface CoursePart {
  at: (t: number) => Position
  end: Position
  lengthM: number
}

export interface SpiralRun {
  parts: CoursePart[]
  end: Position
  outAzimuthDeg: number
  elements: SpiralElements
}

/**
 * The course on the ground: where it goes, where it ends, and the tangent it
 * hands to whatever comes next.
 */
export function spiralGeometry(
  start: Position, tangentAzDeg: number, elements: SpiralElements, form: SpiralForm,
  turn: TurnDirection
): SpiralRun {
  const sign = turn === 'right' ? 1 : -1

  if (form === 'out') {
    const ex = exitSpiral(
      start, tangentAzDeg, sign, elements.lengthInM, elements.radiusM, elements.thetaInDeg
    )
    return {
      parts: [{ at: ex.at, end: ex.end, lengthM: elements.lengthInM }],
      end: ex.end,
      outAzimuthDeg: ex.flatAzDeg,
      elements,
    }
  }

  // Entry spiral: tangent → curve.
  const aSqIn = elements.radiusM * elements.lengthInM
  const scEnd = placeOffsets(start, tangentAzDeg, sign, elements.xIn, elements.yIn)
  const parts: CoursePart[] = [{
    at: pinned(
      (t) => {
        const o = spiralOffsets(elements.lengthInM * t, aSqIn)
        return placeOffsets(start, tangentAzDeg, sign, o.x, o.y)
      },
      start, scEnd
    ),
    end: scEnd,
    lengthM: elements.lengthInM,
  }]
  let azimuth = norm360(tangentAzDeg + sign * elements.thetaInDeg)
  let cursor = scEnd

  if (form === 'scs' && elements.curveDeltaDeg !== null) {
    // The circular middle, tangent to the spiral that just ended — which is
    // what makes the join smooth rather than merely continuous.
    const solved = solveCurve({
      turn,
      a: { id: 'radius', value: elements.radiusM },
      b: { id: 'delta', value: elements.curveDeltaDeg },
    })
    if (solved.ok) {
      const g = curveGeometry(cursor, azimuth, solved.value)
      parts.push({ at: pinned(g.at, cursor, g.pt), end: g.pt, lengthM: solved.value.arcLengthM })
      cursor = g.pt
      azimuth = g.outAzimuthDeg
    }

    const ex = exitSpiral(
      cursor, azimuth, sign, elements.lengthOutM, elements.radiusM, elements.thetaOutDeg
    )
    parts.push({ at: ex.at, end: ex.end, lengthM: elements.lengthOutM })
    return { parts, end: ex.end, outAzimuthDeg: ex.flatAzDeg, elements }
  }

  return { parts, end: scEnd, outAzimuthDeg: azimuth, elements }
}

/**
 * How far the exit spiral's own geometry says it ended from where the elements
 * say it should — a self-check the tests use, since an exit spiral is the one
 * construction here built by running a curve backwards.
 */
export function spiralClosureM(run: SpiralRun): number {
  const last = run.parts[run.parts.length - 1]
  return inverse(last.at(1), run.end).distanceM
}

/** Where a course's straight continuation would go, for drawing the tangent. */
export function alongTangent(p: Position, azDeg: number, distanceM: number): Position {
  return destination(p, distanceM, azDeg)
}
