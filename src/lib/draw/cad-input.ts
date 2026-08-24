import type { Position } from './types'

/**
 * Precise vertex entry (AutoCAD-style). Two accepted forms:
 *
 *   "lng, lat"          absolute coordinate, e.g. "-122.42, 37.77"
 *   "d<dist> a<angle>"  relative to the last vertex: distance in meters,
 *                       angle in degrees clockwise from north,
 *                       e.g. "d150 a45" (order-insensitive: "a45 d150")
 */
export interface CadInputResult {
  position: Position
  relative: boolean
}

const EARTH_RADIUS_M = 6371008.8

/** Geodesic destination point from `origin` given distance (m) and bearing (° from north, clockwise). */
export function destination(origin: Position, distanceM: number, bearingDeg: number): Position {
  const [lng, lat] = origin
  const δ = distanceM / EARTH_RADIUS_M
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (lat * Math.PI) / 180
  const λ1 = (lng * Math.PI) / 180
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    )
  return [((λ2 * 180) / Math.PI + 540) % 360 - 180, (φ2 * 180) / Math.PI]
}

/**
 * Parse a CAD-entry string. Returns null on malformed input, or when a
 * relative form is used with no last vertex to measure from.
 */
export function parseCadInput(input: string, lastVertex: Position | null): CadInputResult | null {
  const s = input.trim()
  if (!s) return null

  // Relative: d<dist> a<angle> in either order
  const dMatch = s.match(/(?:^|\s)d\s*(-?\d+(?:\.\d+)?)/i)
  const aMatch = s.match(/(?:^|\s)a\s*(-?\d+(?:\.\d+)?)/i)
  if (dMatch || aMatch) {
    if (!dMatch || !aMatch || !lastVertex) return null
    const dist = parseFloat(dMatch[1])
    const angle = parseFloat(aMatch[1])
    if (!Number.isFinite(dist) || !Number.isFinite(angle) || dist < 0) return null
    return { position: destination(lastVertex, dist, angle), relative: true }
  }

  // Absolute: lng, lat (comma or whitespace separated)
  const parts = s.split(/[,\s]+/).filter(Boolean)
  if (parts.length !== 2) return null
  const lng = parseFloat(parts[0])
  const lat = parseFloat(parts[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null
  return { position: [lng, lat], relative: false }
}
