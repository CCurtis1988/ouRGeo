import type { Position } from './types'
import { circumcircle } from './arc'
import { localFrame } from './local-frame'

/**
 * Any smooth curve → a chain of circular arcs the draft model can hold.
 *
 * The draft's only curved primitive is `{ kind: 'arc', via }` — three points
 * defining one circular arc — because that is the only curve OGC WKT can carry
 * (`CIRCULARSTRING`), and therefore the only one that survives Save Edits,
 * comes back out of `parseWkt` as a curve, and reaches `sfarc` as a curve. A
 * clothoid has no representation there at all; neither does a Bézier. ISO 19107
 * defines a clothoid abstractly, but no format ouRGeo writes to implements one,
 * so approximation is not a shortcut — it is the only thing available.
 *
 * What it is approximated WITH is the real choice, and arcs beat straight
 * segments by more than an order of magnitude at the same piece count, because
 * an arc already matches the curve's curvature where a chord matches nothing.
 * Measured on a highway spiral (Ls = 100 m, R = 250 m):
 *
 * | pieces | as circular arcs | as straight segments |
 * |--------|------------------|----------------------|
 * | 4      | 5.0 mm           | 273 mm               |
 * | 8      | 0.63 mm          | 73 mm                |
 * | 16     | 0.08 mm          | 19 mm                |
 *
 * Eight arcs put a spiral inside a millimetre AND keep it a real curve in the
 * WKT. Sixty-four straight segments would still be worse and would have thrown
 * the curve semantics away to get there.
 *
 * The curve arrives as a FUNCTION of its parameter rather than as a fixed array
 * of samples, so each piece's `via` is the exact midpoint of that piece rather
 * than whichever sample happened to land nearest it. A sample grid that does
 * not divide evenly into the piece count aliases, and the aliasing shows up as
 * an error that refuses to converge.
 */

export interface ArcPiece {
  via: Position
  end: Position
}

export interface ArcSplineOptions {
  /** How far the committed arcs may stray from the true curve. Default 1 mm —
   *  below survey noise, and far below what any CRS round trip preserves. */
  toleranceM?: number
  /** Ceiling on pieces. Reaching it is reported, not hidden: see `arcSplineFit`. */
  maxPieces?: number
  /** Error probes per piece. More is slower and finds slightly worse worst-cases. */
  probesPerPiece?: number
  /** Pieces to start from, before any doubling. A closed curve needs at least
   *  two, since one arc whose start and end coincide defines no circle. */
  minPieces?: number
}

export interface ArcSplineFit {
  pieces: ArcPiece[]
  /** The worst measured distance from the committed arcs to the true curve. */
  errorM: number
  /** True when `maxPieces` was hit before the tolerance was met — the caller
   *  gets the best available fit AND is told it is not the fit it asked for. */
  truncated: boolean
}

/**
 * How far one probe point sits from the arc through `start`, `via`, `end` —
 * measured against the CIRCLE, not against a densified polyline of it.
 *
 * The distinction is not pedantry, and getting it wrong is self-defeating in a
 * way that hides itself: densifying an arc of radius R at a 0.5° step leaves a
 * sagitta of R·(1−cos 0.25°), which at R = 122 m is 1.2 mm. Measure against
 * that polyline and the ruler is coarser than the millimetre being asked for,
 * so the fitter subdivides for ever chasing its own discretisation. Against the
 * circle the measurement is exact and the loop converges on the real error.
 */
function probeErrorM(start: Position, via: Position, end: Position, probe: Position): number {
  const f = localFrame(start)
  const a = f.toLocal(start)
  const cc = circumcircle(a, f.toLocal(via), f.toLocal(end))
  const p = f.toLocal(probe)
  if (!cc) {
    // Collinear: the piece is a straight segment, so measure to the segment.
    const b = f.toLocal(end)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
  }
  return Math.abs(Math.hypot(p[0] - cc.cx, p[1] - cc.cy) - cc.r)
}

/** The pieces for a given count, and how far they stray from `at`. */
function fitAt(at: (t: number) => Position, n: number, probes: number): ArcSplineFit {
  const pieces: ArcPiece[] = []
  let start = at(0)
  let worst = 0

  for (let k = 0; k < n; k++) {
    const t0 = k / n
    const t1 = (k + 1) / n
    const via = at((t0 + t1) / 2)
    const end = at(t1)
    pieces.push({ via, end })
    for (let i = 1; i < probes; i++) {
      const t = t0 + ((t1 - t0) * i) / probes
      worst = Math.max(worst, probeErrorM(start, via, end, at(t)))
    }
    start = end
  }

  return { pieces, errorM: worst, truncated: false }
}

/**
 * Fit `at` — a curve parameterised over [0, 1], `at(0)` its start and `at(1)`
 * its end — with as few circular arcs as hold the tolerance.
 *
 * Doubling rather than incrementing, because the error falls cubically: the
 * piece count that holds 1 mm is usually 4 or 8, and stepping one at a time to
 * find it would measure the curve seven times for nothing.
 */
export function arcSplineFit(at: (t: number) => Position, opts: ArcSplineOptions = {}): ArcSplineFit {
  const toleranceM = opts.toleranceM ?? 0.001
  const maxPieces = opts.maxPieces ?? 64
  const probes = opts.probesPerPiece ?? 16
  const minPieces = Math.max(1, opts.minPieces ?? 1)

  let best = fitAt(at, minPieces, probes)
  if (best.errorM <= toleranceM) return best

  for (let n = minPieces * 2; n <= maxPieces; n *= 2) {
    best = fitAt(at, n, probes)
    if (best.errorM <= toleranceM) return best
  }
  return { ...best, truncated: true }
}

/** `arcSplineFit` when only the geometry is wanted. */
export function arcSpline(at: (t: number) => Position, opts: ArcSplineOptions = {}): ArcPiece[] {
  return arcSplineFit(at, opts).pieces
}
