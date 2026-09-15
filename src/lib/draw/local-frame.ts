import type { Position } from './types'

/**
 * A local metric frame: metres east and north of one origin.
 *
 * Every curve construction in this folder used to be computed in raw lng/lat
 * degrees, and a circle in that plane is an ellipse on the ground — a degree of
 * longitude is 111 320·cos φ metres against 111 132 for a degree of latitude,
 * so at latitude 60 the plane is stretched almost two to one. Measured against
 * true ground geometry, a 250 m radius arc swept through 90° and stored as one
 * three-point arc came out **46.8 m** from where it belonged at that latitude,
 * and 24.6 m at latitude 45.
 *
 * Subdividing does not rescue it. The error bottoms out around 15 mm and then
 * climbs again, because `circumcircle`'s degeneracy test is an absolute epsilon
 * on a quantity in degree² units, so a short arc goes singular before it goes
 * accurate. Doing the same arithmetic here instead takes that 46.8 m down to a
 * millimetre, and subdivision then converges all the way with no floor. It is
 * the whole reason a typed curve is worth typing.
 *
 * The frame is equirectangular: exact at the origin, degrading with distance
 * from it — sub-millimetre over a few hundred metres, centimetres over a few
 * kilometres. That is the right trade for arcs, which are local by nature.
 * Anything that spans a continent (a traverse leg, a great circle) goes through
 * `cogo.ts`'s Vincenty solutions and never comes near this.
 */

export interface LocalFrame {
  /** lng/lat → metres east, metres north of the origin. */
  toLocal(p: Position): Position
  /** metres east/north → lng/lat. */
  fromLocal(p: Position): Position
  /** Metres per degree at the origin, for callers sizing a tolerance. */
  readonly mLat: number
  readonly mLon: number
}

/**
 * Metres per degree of latitude and of longitude at `lat` — the standard WGS84
 * series. Good to a few centimetres per degree anywhere, which is four orders
 * of magnitude better than the anisotropy it exists to cancel.
 */
export function metresPerDegree(lat: number): { mLat: number; mLon: number } {
  const p = (lat * Math.PI) / 180
  return {
    mLat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p),
    mLon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  }
}

/**
 * A parallel has no length at the pole, and dividing by that turns half a metre
 * of easting into thousands of degrees. Below this the frame has stopped being
 * a frame; clamping keeps the arithmetic finite and the geometry merely wrong,
 * which is the better of the two failures. Arcs at the pole are degenerate in
 * any planar frame, so there is no answer here that is right.
 */
const MIN_M_PER_LON_DEG = 1

/**
 * Shortest signed longitude difference, so an arc spanning the antimeridian is
 * a small delta rather than a 360° jump. The frame does NOT re-wrap on the way
 * back out: a run of coordinates that walks past ±180 continuously is what a
 * renderer wants, and re-wrapping would cut every such arc in half.
 */
function wrapLonDelta(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180
}

export function localFrame(origin: Position): LocalFrame {
  const { mLat, mLon } = metresPerDegree(origin[1])
  const sx = Math.abs(mLon) < MIN_M_PER_LON_DEG ? MIN_M_PER_LON_DEG : mLon
  return {
    mLat,
    mLon: sx,
    toLocal: (p) => [wrapLonDelta(p[0] - origin[0]) * sx, (p[1] - origin[1]) * mLat],
    fromLocal: (p) => [origin[0] + p[0] / sx, origin[1] + p[1] / mLat],
  }
}
