import lineOffset from '@turf/line-offset'
import { lineString } from '@turf/helpers'
import type { Position } from './types'

/**
 * Perpendicular offset of a polyline by `meters` (positive = left of travel
 * direction, negative = right), geodesically correct via turf.
 */
export function offsetPath(path: Position[], meters: number): Position[] {
  if (path.length < 2 || meters === 0) return path
  try {
    const ls = lineString(path.map((p) => [p[0], p[1]]))
    const off = lineOffset(ls, meters, { units: 'meters' })
    return off.geometry.coordinates.map((c) => [c[0], c[1]] as Position)
  } catch {
    return path
  }
}
