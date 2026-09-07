import type { Position } from './types'

/**
 * COGO — coordinate geometry: typing a vertex instead of eyeballing it.
 *
 * The surveyor's term for this is COGO; the UI says "Distance & Bearing",
 * because that is what the user is typing. Everything here is pure and knows
 * nothing about React, the map or R, so the arithmetic that decides where a
 * vertex lands is testable on its own — which matters more here than anywhere
 * else in the drawing code, because a wrong answer looks exactly like a right
 * one on screen.
 *
 * ── Why Vincenty and not the great-circle formula this replaced ──────────────
 *
 * `cad-input.ts` computed the destination on a sphere of radius 6371008.8 m.
 * That is a fine approximation for a rubber band and the wrong tool for a
 * number someone typed: the sphere is up to ~0.5 % out against the WGS84
 * ellipsoid, which is half a metre in a hundred, and it is a systematic error,
 * not noise — every leg of a traverse leans the same way. ouRGeo's own website
 * promises "distances are geodesic (measured on the globe), so precision holds
 * anywhere on Earth", and only an ellipsoidal solution keeps that promise.
 *
 * Vincenty (1975) direct and inverse, iterated to 1e-12, is sub-millimetre for
 * anything short of near-antipodal — and a traverse leg is never that. The
 * inverse solution is not an extra: a geodesic's azimuth CHANGES along it, so
 * the direction a leg arrives on is not the direction it left on, and every
 * angle turned from the previous leg has to be measured from the arrival
 * azimuth or it is wrong by the convergence of the meridians.
 *
 * `ourgeo_traverse()` in `r/lib/handlers-cogo.R` implements the same direct
 * solution so that the R echoed to the console reproduces what is on screen.
 * The two must stay in step; each names the other.
 */

// WGS84.
const A = 6378137.0
const F = 1 / 298.257223563
const B = A * (1 - F)

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

/** Normalize an angle to [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

// ── Geodesics ───────────────────────────────────────────────────────────────

/**
 * Vincenty's direct solution: where you arrive, starting at `origin`, going
 * `distanceM` metres along the geodesic that leaves on azimuth `azimuthDeg`.
 */
export function destination(origin: Position, distanceM: number, azimuthDeg: number): Position {
  const [lng, lat] = origin
  if (distanceM === 0) return [lng, lat]

  const α1 = norm360(azimuthDeg) * RAD
  const s = distanceM
  const sinα1 = Math.sin(α1)
  const cosα1 = Math.cos(α1)

  const tanU1 = (1 - F) * Math.tan(lat * RAD)
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1)
  const sinU1 = tanU1 * cosU1

  const σ1 = Math.atan2(tanU1, cosα1)
  const sinα = cosU1 * sinα1
  const cosSqα = 1 - sinα * sinα
  const uSq = (cosSqα * (A * A - B * B)) / (B * B)
  const AA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const BB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))

  let σ = s / (B * AA)
  let sinσ = 0
  let cosσ = 0
  let cos2σm = 0
  let prev = 0
  // 100 is a ceiling, not an expectation: this converges in three or four.
  for (let i = 0; i < 100; i++) {
    cos2σm = Math.cos(2 * σ1 + σ)
    sinσ = Math.sin(σ)
    cosσ = Math.cos(σ)
    const Δσ =
      BB *
      sinσ *
      (cos2σm +
        (BB / 4) *
          (cosσ * (-1 + 2 * cos2σm * cos2σm) -
            (BB / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)))
    prev = σ
    σ = s / (B * AA) + Δσ
    if (Math.abs(σ - prev) < 1e-12) break
  }

  const tmp = sinU1 * sinσ - cosU1 * cosσ * cosα1
  const φ2 = Math.atan2(
    sinU1 * cosσ + cosU1 * sinσ * cosα1,
    (1 - F) * Math.sqrt(sinα * sinα + tmp * tmp)
  )
  const λ = Math.atan2(sinσ * sinα1, cosU1 * cosσ - sinU1 * sinσ * cosα1)
  const C = (F / 16) * cosSqα * (4 + F * (4 - 3 * cosSqα))
  const L =
    λ -
    (1 - C) *
      F *
      sinα *
      (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)))

  return [norm180(lng + L * DEG), φ2 * DEG]
}

/** Longitudes stay in (−180, 180]; a traverse that crosses the antimeridian
 *  must not produce 181°, which every consumer would draw on the wrong side. */
function norm180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export interface GeodesicInverse {
  distanceM: number
  /** Azimuth the geodesic LEAVES `a` on, degrees clockwise from true north. */
  initialAzimuth: number
  /** Azimuth it ARRIVES at `b` on — different, and the one angles turn from. */
  finalAzimuth: number
}

/** Vincenty's inverse solution: how far apart two points are, and on what
 *  azimuths the geodesic between them leaves and arrives. */
export function inverse(a: Position, b: Position): GeodesicInverse {
  const [lng1, lat1] = a
  const [lng2, lat2] = b
  const L = (lng2 - lng1) * RAD
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * RAD))
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * RAD))
  const sinU1 = Math.sin(U1)
  const cosU1 = Math.cos(U1)
  const sinU2 = Math.sin(U2)
  const cosU2 = Math.cos(U2)

  let λ = L
  let sinλ = 0
  let cosλ = 0
  let sinσ = 0
  let cosσ = 0
  let σ = 0
  let sinα = 0
  let cosSqα = 0
  let cos2σm = 0

  for (let i = 0; i < 200; i++) {
    sinλ = Math.sin(λ)
    cosλ = Math.cos(λ)
    const sinSqσ =
      cosU2 * sinλ * (cosU2 * sinλ) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosλ) * (cosU1 * sinU2 - sinU1 * cosU2 * cosλ)
    sinσ = Math.sqrt(sinSqσ)
    if (sinσ === 0) return { distanceM: 0, initialAzimuth: 0, finalAzimuth: 0 } // coincident
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ
    σ = Math.atan2(sinσ, cosσ)
    sinα = (cosU1 * cosU2 * sinλ) / sinσ
    cosSqα = 1 - sinα * sinα
    // Equatorial line: cos²α is 0, and cos2σm is undefined. Zero is the
    // conventional substitution and keeps the series finite.
    cos2σm = cosSqα === 0 ? 0 : cosσ - (2 * sinU1 * sinU2) / cosSqα
    const C = (F / 16) * cosSqα * (4 + F * (4 - 3 * cosSqα))
    const prev = λ
    λ =
      L +
      (1 - C) *
        F *
        sinα *
        (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)))
    if (Math.abs(λ - prev) < 1e-12) break
  }

  const uSq = (cosSqα * (A * A - B * B)) / (B * B)
  const AA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const BB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const Δσ =
    BB *
    sinσ *
    (cos2σm +
      (BB / 4) *
        (cosσ * (-1 + 2 * cos2σm * cos2σm) -
          (BB / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)))

  return {
    distanceM: B * AA * (σ - Δσ),
    initialAzimuth: norm360(
      Math.atan2(cosU2 * sinλ, cosU1 * sinU2 - sinU1 * cosU2 * cosλ) * DEG
    ),
    finalAzimuth: norm360(
      Math.atan2(cosU1 * sinλ, -sinU1 * cosU2 + cosU1 * sinU2 * cosλ) * DEG
    ),
  }
}

// ── Distance units ──────────────────────────────────────────────────────────

export type DistanceUnit = 'm' | 'km' | 'ft' | 'usft' | 'chain' | 'mi' | 'nmi'

export interface UnitDef {
  id: DistanceUnit
  /** What the dropdown shows. */
  label: string
  /** What the readouts print after a number. */
  abbr: string
  toMetre: number
  /** Spellings accepted when a unit is typed into the distance field itself. */
  aliases: string[]
}

/**
 * The US survey foot is not pedantry. Most State Plane zones are defined in
 * it, it differs from the international foot by 2 ppm — 6 mm in 3 km — and a
 * plat that says "feet" in a State Plane zone means this one. Offering only
 * one "ft" would silently pick the wrong definition half the time.
 */
export const UNITS: Record<DistanceUnit, UnitDef> = {
  m: { id: 'm', label: 'Metres', abbr: 'm', toMetre: 1, aliases: ['m', 'metre', 'metres', 'meter', 'meters'] },
  km: { id: 'km', label: 'Kilometres', abbr: 'km', toMetre: 1000, aliases: ['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers'] },
  ft: { id: 'ft', label: 'Feet (international)', abbr: 'ft', toMetre: 0.3048, aliases: ['ft', 'foot', 'feet', "'"] },
  usft: { id: 'usft', label: 'Feet (US survey)', abbr: 'us ft', toMetre: 1200 / 3937, aliases: ['usft', 'usfoot', 'usfeet', 'ussurveyfoot', 'ussurveyfeet'] },
  chain: { id: 'chain', label: 'Chains (Gunter’s)', abbr: 'ch', toMetre: (66 * 1200) / 3937, aliases: ['ch', 'chain', 'chains'] },
  mi: { id: 'mi', label: 'Miles', abbr: 'mi', toMetre: 1609.344, aliases: ['mi', 'mile', 'miles'] },
  nmi: { id: 'nmi', label: 'Nautical miles', abbr: 'nmi', toMetre: 1852, aliases: ['nmi', 'nauticalmile', 'nauticalmiles'] },
}

export const UNIT_IDS = Object.keys(UNITS) as DistanceUnit[]

export const toMetres = (value: number, unit: DistanceUnit): number => value * UNITS[unit].toMetre
export const fromMetres = (metres: number, unit: DistanceUnit): number => metres / UNITS[unit].toMetre

// ── Parse results ───────────────────────────────────────────────────────────

/**
 * A parse either produces a value or says what it wanted instead. Never null:
 * a refusal here is shown to someone mid-keystroke, and "invalid input" is a
 * shrug, not a message.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const bad = (error: string): ParseResult<never> => ({ ok: false, error })
const good = <T>(value: T): ParseResult<T> => ({ ok: true, value })

// ── Angles ──────────────────────────────────────────────────────────────────

/**
 * Degrees, from anything a field book might write: `45`, `45.5`, `45°30'15"`,
 * `45 30 15`, `45-30-15`, `45:30:15`. Always unsigned — the caller owns the
 * sign, because only deflections have one and a stray minus in an azimuth is
 * a mistake worth naming.
 */
export function parseAngle(text: string): ParseResult<number> {
  const s = text.trim().replace(/[°º*]/g, ' ').replace(/['′]/g, ' ').replace(/["″]/g, ' ')
    .replace(/[-:]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return bad('Enter an angle — 45, 45.5, 45°30\'15" or 45 30 15.')

  const parts = s.split(' ')
  if (parts.length > 3) return bad('Too many parts — an angle is degrees, minutes, seconds.')
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
    return bad('Angles are unsigned numbers — 45, 45.5, 45°30\'15" or 45 30 15.')
  }
  const [d, m = 0, sec = 0] = nums
  if (m >= 60) return bad('Minutes run 0–59.')
  if (sec >= 60) return bad('Seconds run 0–59.')
  return good(d + m / 60 + sec / 3600)
}

/**
 * Degrees as `45°30'15"`, rounded to the nearest second — the form the leg list
 * reads back, and the one a plat is written in. Trailing zero parts are
 * dropped, so a round number stays a round number: `45°`, not `45°00'00"`.
 */
export function formatDms(deg: number): string {
  const total = Math.round(Math.abs(deg) * 3600)
  const d = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const sign = deg < 0 ? '\u2212' : ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (m === 0 && s === 0) return `${sign}${d}\u00b0`
  if (s === 0) return `${sign}${d}\u00b0${pad(m)}'`
  return `${sign}${d}\u00b0${pad(m)}'${pad(s)}"`
}

// ── Bearings ────────────────────────────────────────────────────────────────

export type BearingMode = 'azimuth' | 'quadrant' | 'deflection' | 'interior'

export interface BearingModeDef {
  id: BearingMode
  label: string
  /** Shown under the field — the accepted forms, not a description. */
  hint: string
  /** Whether it is measured from the previous leg rather than from north. */
  relative: boolean
}

export const BEARING_MODES: Record<BearingMode, BearingModeDef> = {
  azimuth: {
    id: 'azimuth', label: 'Azimuth', relative: false,
    hint: 'Clockwise from north: 45, 45.5, 45°30\'15", 45 30 15',
  },
  quadrant: {
    id: 'quadrant', label: 'Quadrant', relative: false,
    hint: 'N45°30\'E, S30W, N 45 30 15 E',
  },
  deflection: {
    id: 'deflection', label: 'Deflection', relative: true,
    hint: 'Turned from the last leg: R90, L12°30\', −12.5',
  },
  interior: {
    id: 'interior', label: 'Angle right', relative: true,
    hint: 'Clockwise from the back line: 120°30\'',
  },
}

export const BEARING_MODE_IDS = Object.keys(BEARING_MODES) as BearingMode[]

/**
 * A bearing, in whichever notation the mode names, resolved to an azimuth in
 * degrees clockwise from north.
 *
 * `incomingAzimuth` is the azimuth the PREVIOUS leg arrived on
 * (`inverse(prevPrev, prev).finalAzimuth`), and the relative modes cannot be
 * resolved without it. Using the azimuth that leg *left* on instead would be
 * wrong by the convergence of the meridians over its own length — small over
 * a lot, real over a kilometre, and exactly the kind of error that hides.
 */
export function parseBearing(
  text: string, mode: BearingMode, incomingAzimuth: number | null
): ParseResult<number> {
  const s = text.trim()
  if (!s) return bad(`Enter a bearing — ${BEARING_MODES[mode].hint}`)

  // A leading L or R is a deflection in any notation — nothing else starts
  // with one — so it is read as one rather than refused for being in the wrong
  // dropdown. Same rule as the two absolute notations below, and the same
  // reason: an entry that can only mean one thing should mean it.
  if ((mode === 'azimuth' || mode === 'quadrant') && /^[LlRr]\s*[0-9]/.test(s)) {
    return parseBearing(s, 'deflection', incomingAzimuth)
  }

  // The two ABSOLUTE notations each accept the other's form, and that is not
  // laxity. `N45°30'E` is a quadrant bearing whatever a dropdown says, and
  // refusing it because the selector reads "Azimuth" answers an unambiguous
  // number with a complaint about the number — which is how a first traverse
  // ends in the wrong dropdown rather than on the map. The selector still
  // decides the placeholder and how the leg reads back in the list.
  if (mode === 'azimuth' || mode === 'quadrant') {
    const m = s.match(/^([NnSs])\s*(.*?)\s*([EeWw])$/)
    if (m) {
      const a = parseAngle(m[2])
      if (!a.ok) return a
      if (a.value > 90) return bad('A quadrant bearing turns 0–90° away from north or south.')
      const ns = m[1].toUpperCase()
      const ew = m[3].toUpperCase()
      if (ns === 'N' && ew === 'E') return good(norm360(a.value))
      if (ns === 'S' && ew === 'E') return good(norm360(180 - a.value))
      if (ns === 'S' && ew === 'W') return good(norm360(180 + a.value))
      return good(norm360(360 - a.value))
    }
    if (/^[NnSs]|[EeWw]$/.test(s)) {
      return bad('Quadrant bearings read N…E, N…W, S…E or S…W — for example N45°30\'E or S30W.')
    }
    if (/^[-−+]/.test(s)) {
      return bad('Azimuths run 0–360 from north. To turn left from the last leg, use the Deflection notation.')
    }
    const a = parseAngle(s)
    if (!a.ok) return a
    if (a.value > 360) return bad('Azimuths run 0–360 from north.')
    return good(norm360(a.value))
  }

  if (incomingAzimuth === null) {
    return bad(
      mode === 'deflection'
        ? 'A deflection turns from the previous leg, and there is not one yet. Enter this leg as an azimuth or a quadrant bearing.'
        : 'An angle right is measured at the previous vertex, and there is not one yet. Enter this leg as an azimuth or a quadrant bearing.'
    )
  }

  if (mode === 'deflection') {
    const m = s.match(/^([LlRr+\-−])?\s*(.+)$/)
    if (!m) return bad(`Enter a deflection — ${BEARING_MODES.deflection.hint}`)
    const a = parseAngle(m[2])
    if (!a.ok) return a
    if (a.value > 180) return bad('A deflection turns up to 180° either way; beyond that, turn the other way.')
    const left = m[1] === 'L' || m[1] === 'l' || m[1] === '-' || m[1] === '−'
    return good(norm360(incomingAzimuth + (left ? -a.value : a.value)))
  }

  // Angle right: measured clockwise from the back line — the way back to the
  // previous vertex, which is the incoming azimuth reversed — round to the
  // next leg. That is how a closed traverse is booked, and why the interior
  // angles of a ring run clockwise sum to (n−2)·180.
  const a = parseAngle(s)
  if (!a.ok) return a
  if (a.value > 360) return bad('An angle right runs 0–360° from the back line.')
  return good(norm360(incomingAzimuth + 180 + a.value))
}

/** An azimuth written back out in the notation it was entered in. The relative
 *  modes need what they were measured from, and fall back to an azimuth when
 *  it is not supplied — a leg list still has the raw text the user typed. */
export function formatBearing(
  azimuth: number, mode: BearingMode, incomingAzimuth: number | null = null
): string {
  const az = norm360(azimuth)
  if (mode === 'quadrant') {
    if (az <= 90) return `N${formatDms(az)}E`
    if (az <= 180) return `S${formatDms(180 - az)}E`
    if (az <= 270) return `S${formatDms(az - 180)}W`
    return `N${formatDms(360 - az)}W`
  }
  if (mode === 'deflection' && incomingAzimuth !== null) {
    const d = norm360(az - incomingAzimuth)
    return d <= 180 ? `R${formatDms(d)}` : `L${formatDms(360 - d)}`
  }
  if (mode === 'interior' && incomingAzimuth !== null) {
    return formatDms(norm360(az - incomingAzimuth - 180))
  }
  return formatDms(az)
}

// ── Distances ───────────────────────────────────────────────────────────────

/**
 * A distance, in the selected unit — or in one typed after it (`150ft`,
 * `20 ch`), because someone copying a deed reads the unit off the page and
 * should not have to find the dropdown for one line.
 */
export function parseDistance(text: string, unit: DistanceUnit): ParseResult<number> {
  const s = text.trim().replace(/,/g, '')
  if (!s) return bad('Enter a distance.')
  const m = s.match(/^([0-9]*\.?[0-9]+)\s*([a-zA-Z'’]*)$/)
  if (!m) return bad('Distances are a number, optionally followed by a unit — 150, 150ft, 20 ch.')
  const value = Number(m[1])
  if (!Number.isFinite(value)) return bad('Distances are a number, optionally followed by a unit — 150, 150ft, 20 ch.')
  if (value <= 0) return bad('A leg needs a distance greater than zero.')

  const suffix = m[2].toLowerCase().replace(/[’]/g, "'")
  if (!suffix) return good(toMetres(value, unit))
  const hit = UNIT_IDS.find((id) => UNITS[id].aliases.includes(suffix))
  if (!hit) {
    return bad(`Unknown unit "${m[2]}". Try ${UNIT_IDS.map((id) => UNITS[id].abbr).join(', ')}.`)
  }
  return good(toMetres(value, hit))
}

/** A distance for a readout: enough decimals to be worth typing, no more. */
export function formatDistance(metres: number, unit: DistanceUnit): string {
  const v = fromMetres(metres, unit)
  const dp = unit === 'km' || unit === 'mi' || unit === 'nmi' ? 4 : 2
  return `${v.toFixed(dp)} ${UNITS[unit].abbr}`
}

// ── Coordinates ─────────────────────────────────────────────────────────────

/** `lng, lat` — the other half of "type it, don't eyeball it". Comma or
 *  whitespace separated, in that order, because that is the order every
 *  GeoJSON, WKT and sf coordinate in this application is written in. */
export function parseCoordinate(text: string): ParseResult<Position> {
  // U+2212 MINUS SIGN is what this application PRINTS a negative coordinate
  // with, so it is what comes back when someone copies one out of a readout
  // and pastes it into the field. `Number()` does not accept it.
  const parts = text.trim().replace(/\u2212/g, '-').split(/[,\s]+/).filter(Boolean)
  if (parts.length !== 2) return bad('Enter a coordinate as longitude, latitude — for example −122.4194, 37.7749.')
  const lng = Number(parts[0])
  const lat = Number(parts[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return bad('Enter a coordinate as longitude, latitude — for example −122.4194, 37.7749.')
  }
  if (lng < -180 || lng > 180) return bad('Longitude runs −180 to 180. Longitude comes first.')
  if (lat < -90 || lat > 90) return bad('Latitude runs −90 to 90. Longitude comes first.')
  return good([lng, lat])
}

// ── Traverses ───────────────────────────────────────────────────────────────

/** One leg as the user entered it — kept verbatim so the list reads back in
 *  the notation it was typed in, not in whatever the resolver normalised to. */
export interface TraverseLeg {
  distanceText: string
  bearingText: string
  unit: DistanceUnit
  mode: BearingMode
  /** Resolved at entry: metres, and degrees clockwise from true north. */
  distanceM: number
  azimuth: number
}

/**
 * The azimuth the next relative bearing turns from: the direction the last leg
 * ARRIVED on. Null until there is a leg to turn from.
 */
export function incomingAzimuth(vertices: Position[]): number | null {
  if (vertices.length < 2) return null
  return inverse(vertices[vertices.length - 2], vertices[vertices.length - 1]).finalAzimuth
}

export interface Closure {
  /** How far the last vertex misses the first. */
  distanceM: number
  azimuth: number
  /** Sum of the legs entered — the closing course is the misclosure itself. */
  perimeterM: number
  /** Perimeter ÷ misclosure: the `1:N` a traverse is judged by. Infinite when
   *  the traverse closes exactly, which is the answer, not a failure. */
  ratio: number
}

/** How badly a ring fails to close, and how good that is relative to its size. */
export function closure(vertices: Position[]): Closure | null {
  if (vertices.length < 3) return null
  let perimeterM = 0
  for (let i = 1; i < vertices.length; i++) perimeterM += inverse(vertices[i - 1], vertices[i]).distanceM
  const gap = inverse(vertices[vertices.length - 1], vertices[0])
  return {
    distanceM: gap.distanceM,
    azimuth: gap.initialAzimuth,
    perimeterM,
    ratio: gap.distanceM === 0 ? Infinity : perimeterM / gap.distanceM,
  }
}

/** `1:12,300`, or `exact` — the form it is quoted in. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'exact'
  if (ratio < 1) return '1:1'
  return `1:${Math.round(ratio).toLocaleString('en-GB')}`
}

// ── Grid ────────────────────────────────────────────────────────────────────

/**
 * What a projected CRS does to a bearing and a distance at one point.
 *
 * `convergence` is the angle from grid north to true north, positive east;
 * `scale` is the point scale factor, grid ÷ ground. R reports both for the
 * current vertex (see `r/lib/handlers-cogo.R`); they are what lets a grid leg
 * be PREVIEWED without another round trip while it is being typed. The
 * committed vertex is always R's own projected arithmetic, not this.
 */
export interface GridFrame {
  x: number
  y: number
  convergence: number
  scale: number
}

/** Reduce a grid bearing and distance to the geodesic pair that draws the same
 *  line — the standard survey reduction, exact enough over a leg to preview. */
export function reduceGridLeg(
  gridDistanceM: number, gridAzimuth: number, frame: GridFrame
): { distanceM: number; azimuth: number } {
  return {
    distanceM: frame.scale === 0 ? gridDistanceM : gridDistanceM / frame.scale,
    azimuth: norm360(gridAzimuth + frame.convergence),
  }
}

// ── The ribbon's one-line entry ─────────────────────────────────────────────

export interface CadInputResult {
  position: Position
  relative: boolean
}

/**
 * The drawing ribbon's text box: `lng, lat` absolute, or `d<metres> a<degrees>`
 * relative to the last vertex, in either order.
 *
 * Kept because it is muscle memory for anyone who found it, and because one
 * line is faster than two fields when you already know the numbers. It is now
 * geodesic like everything else here — the same call the Distance & Bearing
 * strip makes.
 */
export function parseCadInput(input: string, lastVertex: Position | null): CadInputResult | null {
  const s = input.trim()
  if (!s) return null

  const dMatch = s.match(/(?:^|\s)d\s*(-?\d+(?:\.\d+)?)/i)
  const aMatch = s.match(/(?:^|\s)a\s*(-?\d+(?:\.\d+)?)/i)
  if (dMatch || aMatch) {
    if (!dMatch || !aMatch || !lastVertex) return null
    const dist = parseFloat(dMatch[1])
    const angle = parseFloat(aMatch[1])
    if (!Number.isFinite(dist) || !Number.isFinite(angle) || dist < 0) return null
    return { position: destination(lastVertex, dist, angle), relative: true }
  }

  const parsed = parseCoordinate(s)
  return parsed.ok ? { position: parsed.value, relative: false } : null
}
