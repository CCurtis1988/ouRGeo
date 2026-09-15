import type { Position } from './types'
import { destination, inverse, norm360, type ParseResult } from './cogo'

/**
 * The circular curve a plat is written in.
 *
 * A deed does not say "arc through these three points"; it says *"along a curve
 * to the right having a radius of 250.00 feet, a central angle of 45°30'00", an
 * arc length of 198.54 feet, chord bearing S22°45'00"W"*. Every one of those
 * numbers describes the same curve, and different plans quote different subsets
 * — so the tool has to accept whichever two the page in front of the user
 * happens to give, and print all the rest back for checking.
 *
 * **The uniform structure that makes this one solver instead of twenty-eight.**
 * Given the turn direction and the incoming tangent, a circular curve has two
 * degrees of freedom, and every element except the central angle is the radius
 * times a function of that angle alone:
 *
 *     L = R·Δ          C = R·2sin(Δ/2)      T = R·tan(Δ/2)
 *     E = R·(sec(Δ/2)−1)                    M = R·(1−cos(Δ/2))
 *
 * (R itself is the trivial member, f ≡ 1.) So for ANY two of them the ratio
 * depends only on Δ — one root-find gets the angle, and the radius falls out.
 * Degree of curve is not a seventh freedom at all: it is a restatement of the
 * radius, which is why quoting both is refused rather than averaged.
 *
 * **Some pairs genuinely describe two curves**, and the solver counts its roots
 * rather than assuming one. That is not caution for its own sake — an
 * assumption of monotonicity here would have been wrong and invisible:
 *
 *   - A radius and a chord fit the minor arc AND its reflex partner. R = 400 ft
 *     with a 400 ft chord is a 60° curve or a 300° one.
 *   - A tangent length and a mid-ordinate fit a shallow curve and a sharp one:
 *     T/M falls to a minimum near Δ = 138° and rises again, so both roots are
 *     ordinary sub-180° curves.
 *
 * The two cases deserve different answers, and the rule is **exactly one
 * ordinary curve wins**. Where one root is at or below a half turn and the rest
 * are reflex, the ordinary one is taken — a deed quoting a radius and a chord
 * means the arc you would draw, and refusing the second most common pair on a
 * plat would make the tool feel broken. Where two ORDINARY curves fit, only the
 * surveyor knows which, so it is refused by name with both angles listed.
 *
 * What makes the first half of that safe is the readout: every element is
 * printed back, Δ included, so a user who wanted the reflex curve sees 60°
 * where they expected 300° and types the delta instead. A silent choice the
 * user cannot see would be a different thing entirely.
 */

export type TurnDirection = 'left' | 'right'

export type CurveElementId =
  | 'radius'
  | 'delta'
  | 'arcLength'
  | 'chord'
  | 'tangent'
  | 'external'
  | 'midOrdinate'
  | 'degreeOfCurve'

/** Degree of curve is defined two ways and they disagree; the plan says which. */
export type DegreeDefinition = 'arc' | 'chord'

export interface CurveElementDef {
  id: CurveElementId
  /** What the plat calls it. */
  label: string
  /** The one-or-two letter symbol plans use. */
  symbol: string
  /** A length in the entry unit, or an angle in degrees. */
  quantity: 'length' | 'angle'
  hint: string
}

export const CURVE_ELEMENTS: Record<CurveElementId, CurveElementDef> = {
  radius: { id: 'radius', label: 'Radius', symbol: 'R', quantity: 'length', hint: 'Radius of the curve.' },
  delta: { id: 'delta', label: 'Delta', symbol: 'Δ', quantity: 'angle', hint: 'Central angle — the total deflection, which is also the angle subtended at the centre.' },
  arcLength: { id: 'arcLength', label: 'Arc length', symbol: 'L', quantity: 'length', hint: 'Length measured along the curve.' },
  chord: { id: 'chord', label: 'Chord', symbol: 'C', quantity: 'length', hint: 'Straight line from the start of the curve to its end (the long chord).' },
  tangent: { id: 'tangent', label: 'Tangent', symbol: 'T', quantity: 'length', hint: 'From the start of the curve to the point where the two tangents meet. Only defined below Δ = 180°.' },
  external: { id: 'external', label: 'External', symbol: 'E', quantity: 'length', hint: 'From the tangent intersection to the middle of the curve. Only defined below Δ = 180°.' },
  midOrdinate: { id: 'midOrdinate', label: 'Mid-ordinate', symbol: 'M', quantity: 'length', hint: 'From the middle of the long chord to the middle of the curve.' },
  degreeOfCurve: { id: 'degreeOfCurve', label: 'Degree of curve', symbol: 'D', quantity: 'angle', hint: 'The central angle subtended by one station. A restatement of the radius, so it cannot be combined with one.' },
}

export const CURVE_ELEMENT_IDS = Object.keys(CURVE_ELEMENTS) as CurveElementId[]

/** Every element of the curve, whichever two were typed. Lengths in metres. */
export interface CurveElements {
  turn: TurnDirection
  radiusM: number
  deltaDeg: number
  arcLengthM: number
  chordM: number
  /** Null above Δ = 180°, where the tangents diverge and there is no intersection. */
  tangentM: number | null
  externalM: number | null
  midOrdinateM: number
  degreeOfCurveArc: number
  degreeOfCurveChord: number
}

export interface CurveSolveInput {
  turn: TurnDirection
  a: { id: CurveElementId; value: number }
  b: { id: CurveElementId; value: number }
  /** One station, in metres. US plans use 100 ft; pass `toMetres(100, unit)`. */
  stationM?: number
  degreeDefinition?: DegreeDefinition
}

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

/** R·f(Δ) for each length element; `null` for the ones that are not of that family. */
function shapeFn(id: CurveElementId): ((deltaRad: number) => number) | null {
  switch (id) {
    case 'radius': return () => 1
    case 'arcLength': return (d) => d
    case 'chord': return (d) => 2 * Math.sin(d / 2)
    case 'tangent': return (d) => Math.tan(d / 2)
    case 'external': return (d) => 1 / Math.cos(d / 2) - 1
    case 'midOrdinate': return (d) => 1 - Math.cos(d / 2)
    default: return null
  }
}

/** Tangent and external run to infinity at Δ = 180° and are meaningless past it. */
function maxDeltaRad(ids: CurveElementId[]): number {
  const bounded = ids.some((i) => i === 'tangent' || i === 'external')
  return bounded ? Math.PI - 1e-6 : 2 * Math.PI - 1e-6
}

export function radiusFromDegreeOfCurve(
  degree: number, stationM: number, def: DegreeDefinition
): number | null {
  if (!(degree > 0)) return null
  if (def === 'chord') {
    const s = Math.sin((degree * RAD) / 2)
    return s <= 0 ? null : stationM / 2 / s
  }
  return (stationM * DEG) / degree
}

export function degreeOfCurveFromRadius(
  radiusM: number, stationM: number, def: DegreeDefinition
): number {
  if (def === 'chord') return 2 * Math.asin(Math.min(1, stationM / 2 / radiusM)) * DEG
  return (stationM * DEG) / radiusM
}

/** Every root of `va·fb(Δ) − vb·fa(Δ)` in (0, max], found by scanning for sign
 *  changes and then bisecting each one. Written as a difference rather than a
 *  ratio so a zero denominator is not a special case. */
function rootsFor(
  fa: (d: number) => number, va: number,
  fb: (d: number) => number, vb: number,
  max: number
): number[] {
  const resid = (d: number): number => va * fb(d) - vb * fa(d)
  const STEPS = 4000
  const lo = 1e-7
  const out: number[] = []
  let prev = resid(lo)
  for (let i = 1; i <= STEPS; i++) {
    const d = lo + ((max - lo) * i) / STEPS
    const cur = resid(d)
    if (Number.isFinite(prev) && Number.isFinite(cur) && ((prev <= 0 && cur >= 0) || (prev >= 0 && cur <= 0))) {
      let a = lo + ((max - lo) * (i - 1)) / STEPS
      let b = d
      for (let k = 0; k < 90; k++) {
        const m = (a + b) / 2
        const rm = resid(m)
        if ((resid(a) <= 0 && rm >= 0) || (resid(a) >= 0 && rm <= 0)) b = m
        else a = m
      }
      const root = (a + b) / 2
      if (root > 1e-6 && !out.some((r) => Math.abs(r - root) < 1e-7)) out.push(root)
    }
    prev = cur
  }
  return out
}

function elementsFrom(turn: TurnDirection, radiusM: number, deltaDeg: number, stationM: number): CurveElements {
  const d = deltaDeg * RAD
  const half = d / 2
  const finiteTangent = deltaDeg < 180 - 1e-9
  return {
    turn,
    radiusM,
    deltaDeg,
    arcLengthM: radiusM * d,
    chordM: 2 * radiusM * Math.sin(half),
    tangentM: finiteTangent ? radiusM * Math.tan(half) : null,
    externalM: finiteTangent ? radiusM * (1 / Math.cos(half) - 1) : null,
    midOrdinateM: radiusM * (1 - Math.cos(half)),
    degreeOfCurveArc: degreeOfCurveFromRadius(radiusM, stationM, 'arc'),
    degreeOfCurveChord: degreeOfCurveFromRadius(radiusM, stationM, 'chord'),
  }
}

/**
 * The whole curve from any two of its elements.
 *
 * Refusals name what is missing or what is contradictory, rather than
 * complaining about a number — the habit `parseBearing` already has, and the
 * difference between a user who fixes their entry and one who concludes the
 * tool is broken.
 */
export function solveCurve(input: CurveSolveInput): ParseResult<CurveElements> {
  const stationM = input.stationM ?? 100
  const degDef = input.degreeDefinition ?? 'arc'

  // Degree of curve is the radius wearing a different hat. Convert it, then the
  // rest of the solver never has to know it existed.
  const normalise = (e: { id: CurveElementId; value: number }): ParseResult<{ id: CurveElementId; value: number }> => {
    if (e.id !== 'degreeOfCurve') return { ok: true, value: e }
    const r = radiusFromDegreeOfCurve(e.value, stationM, degDef)
    if (r === null) return { ok: false, error: 'A degree of curve has to be greater than zero.' }
    return { ok: true, value: { id: 'radius', value: r } }
  }

  const na = normalise(input.a)
  if (!na.ok) return na
  const nb = normalise(input.b)
  if (!nb.ok) return nb
  const a = na.value
  const b = nb.value

  if (a.id === b.id) {
    const was = [input.a.id, input.b.id]
    if (was.includes('degreeOfCurve') && was.includes('radius')) {
      return { ok: false, error: 'A degree of curve IS a radius, so those two say the same thing. Give a delta, an arc length or a chord as the second element.' }
    }
    return { ok: false, error: `Two different elements are needed — ${CURVE_ELEMENTS[a.id].label.toLowerCase()} was given twice.` }
  }
  for (const e of [a, b]) {
    if (!Number.isFinite(e.value) || e.value <= 0) {
      return { ok: false, error: `${CURVE_ELEMENTS[e.id].label} has to be a positive number.` }
    }
  }

  // Delta is the one element that is not R·f(Δ), so a pair containing it is a
  // direct substitution rather than a search.
  const deltaSide = a.id === 'delta' ? a : b.id === 'delta' ? b : null
  if (deltaSide) {
    const other = deltaSide === a ? b : a
    const deltaDeg = deltaSide.value
    if (deltaDeg <= 0 || deltaDeg >= 360) {
      return { ok: false, error: 'A central angle has to be between 0° and 360°.' }
    }
    const f = shapeFn(other.id)
    if (!f) return { ok: false, error: 'Those two elements do not describe a curve.' }
    if ((other.id === 'tangent' || other.id === 'external') && deltaDeg >= 180) {
      return { ok: false, error: `At Δ = ${deltaDeg}° the two tangents never meet, so there is no ${CURVE_ELEMENTS[other.id].label.toLowerCase()}. Use an arc length, a chord or a mid-ordinate.` }
    }
    const fv = f(deltaDeg * RAD)
    if (!Number.isFinite(fv) || fv <= 0) {
      return { ok: false, error: `A curve with Δ = ${deltaDeg}° has no ${CURVE_ELEMENTS[other.id].label.toLowerCase()}.` }
    }
    return { ok: true, value: elementsFrom(input.turn, other.value / fv, deltaDeg, stationM) }
  }

  const fa = shapeFn(a.id)
  const fb = shapeFn(b.id)
  if (!fa || !fb) return { ok: false, error: 'Those two elements do not describe a curve.' }

  const roots = rootsFor(fa, a.value, fb, b.value, maxDeltaRad([a.id, b.id]))
  if (roots.length === 0) {
    return {
      ok: false,
      error: `No curve has a ${CURVE_ELEMENTS[a.id].label.toLowerCase()} of ${a.value.toFixed(3)} with that ${CURVE_ELEMENTS[b.id].label.toLowerCase()}.`
        + (a.id === 'chord' || b.id === 'chord' ? ' A chord can never be longer than twice the radius.' : ''),
    }
  }
  // Exactly one ordinary (sub-half-turn) curve wins; two of them is a question
  // only the surveyor can answer. See the note at the top of this file.
  const ordinary = roots.filter((r) => r <= Math.PI + 1e-9)
  if (roots.length > 1 && ordinary.length !== 1) {
    const list = roots.map((r) => `${(r * DEG).toFixed(2)}°`).join(' and ')
    return {
      ok: false,
      error: `A ${CURVE_ELEMENTS[a.id].label.toLowerCase()} and a ${CURVE_ELEMENTS[b.id].label.toLowerCase()} describe more than one curve here — Δ could be ${list}. Add a radius, a delta or an arc length to say which.`,
    }
  }

  const deltaRad = ordinary.length === 1 ? ordinary[0] : roots[0]
  const radiusM = a.value / fa(deltaRad)
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    return { ok: false, error: 'Those two elements do not describe a curve.' }
  }
  return { ok: true, value: elementsFrom(input.turn, radiusM, deltaRad * DEG, stationM) }
}

// ── Where the curve actually goes ───────────────────────────────────────────

export interface CurveGeometry {
  /** Centre of the curve. */
  centre: Position
  /** Point of curvature — where it leaves the tangent. */
  pc: Position
  /** Point of tangency — where it rejoins one. */
  pt: Position
  /** Ground position at parameter t ∈ [0, 1] along the curve. */
  at: (t: number) => Position
  /** The azimuth the curve arrives on, for the next course to turn from. */
  outAzimuthDeg: number
  /** Long chord bearing, PC → PT — what the plat quotes. */
  chordAzimuthDeg: number
}

/**
 * The curve leaving `pc` on `tangentAzDeg`, turning `turn`, with the given
 * elements — as a locus of constant geodesic radius about its centre.
 *
 * A geodesic circle meets every one of its radii at a right angle, which is
 * exactly the tangency the construction needs, so the curve leaves PC on the
 * incoming tangent and arrives at PT on the outgoing one with nothing to
 * correct. The ellipsoid's spherical excess makes the total deflection differ
 * from Δ by around a nanoradian at survey scale — five orders of magnitude
 * below the millimetre the arc spline is fitted to.
 *
 * On a projected layer this is NOT the right definition: a plat's curve is a
 * true circle on the grid, and that arithmetic is R's (`/spatial/traverse`).
 * This is the geodesic basis, and the same split the straight courses already use.
 */
export function curveGeometry(
  pc: Position, tangentAzDeg: number, elements: CurveElements
): CurveGeometry {
  const sign = elements.turn === 'right' ? 1 : -1
  // The centre is a quarter turn to the inside of the heading. Tangency at PC
  // is therefore exact by construction: the radius leaves PC on
  // `tangentAz + 90`, and the tangent perpendicular to it is `tangentAz`.
  const centre = destination(pc, elements.radiusM, norm360(tangentAzDeg + sign * 90))
  // Seen FROM the centre, PC is NOT simply a half turn back. A geodesic arrives
  // on a different azimuth than it left on — by the convergence of the
  // meridians — so `tangentAz - sign·90` misses PC by Δλ·sin φ·R, which at
  // 122 m and latitude 45 is two millimetres. Small, systematic, and enough to
  // show up in a closure once a figure has a dozen curves in it. Measured, not
  // assumed, exactly as `traverseIncoming` measures the arrival azimuth of a
  // straight leg rather than reusing its departure azimuth.
  const radialStart = inverse(centre, pc).initialAzimuth
  const at = (t: number): Position =>
    destination(centre, elements.radiusM, norm360(radialStart + sign * elements.deltaDeg * t))

  const pt = at(1)
  // Measured rather than assumed: the radius direction AT PT, turned a quarter
  // circle, is the heading the next course turns from.
  const radialAtPt = inverse(centre, pt).finalAzimuth
  return {
    centre,
    pc,
    pt,
    at,
    outAzimuthDeg: norm360(radialAtPt + sign * 90),
    chordAzimuthDeg: inverse(pc, pt).initialAzimuth,
  }
}

/**
 * The tangent a non-tangent curve leaves on, derived from the chord bearing the
 * plat quotes. The long chord bisects the total deflection, so the tangent is
 * half a delta back from it — which is how a curve that does not continue the
 * previous course gets its orientation from the page rather than from a click.
 */
export function tangentAzimuthFromChord(
  chordAzDeg: number, deltaDeg: number, turn: TurnDirection
): number {
  return norm360(chordAzDeg - (turn === 'right' ? 1 : -1) * (deltaDeg / 2))
}

/** The tangent implied by a radial bearing from PC to the centre. */
export function tangentAzimuthFromRadial(radialAzDeg: number, turn: TurnDirection): number {
  return norm360(radialAzDeg - (turn === 'right' ? 1 : -1) * 90)
}
