import { describe, it, expect } from 'vitest'
import { solveCurve, curveGeometry } from './curve-cogo'
import { arcSplineFit } from './arc-spline'
import { draftToWkt, parseWktToDraft, draftHasArcs, isCurvedWkt } from './wkt'
import { pathDisplayCoords } from './draft'
import { inverse, toMetres } from './cogo'
import type { DraftGeometry, Position } from './types'

/**
 * A typed curve has to be indistinguishable from a clicked one by the time it
 * reaches the layer, or none of the rest of the drawing surface works on it:
 * Save Edits, re-opening the feature to edit, `sfarc`, the data viewer.
 *
 * Verified against the real R session as well as here — `sf` reads the WKT
 * below as a COMPOUNDCURVE, keeps it through `st_transform` to EPSG:2227 and
 * through a GeoPackage round trip, and `sfarc::st_arc_parameters` reads back a
 * sweep of 45.4999° clockwise and an arc of 198.517 ft from a curve typed as
 * "R 250 ft, Δ 45°30', right". The radius reads 249.982 grid feet rather than
 * 250: a GROUND radius is what the geodesic basis promises, and the projection's
 * point scale factor is the difference. That is the whole reason the grid basis
 * exists beside it.
 */
function deedCall(): { draft: DraftGeometry; pieces: number; errorM: number } {
  const el = solveCurve({
    turn: 'right',
    a: { id: 'radius', value: toMetres(250, 'ft') },
    b: { id: 'delta', value: 45.5 },
  })
  if (!el.ok) throw new Error(el.error)
  const start: Position = [-122.4194, 37.7749]
  const corner: Position = [-122.41889, 37.77531]
  const g = curveGeometry(corner, 45.5, el.value)
  const fit = arcSplineFit(g.at, { toleranceM: 0.001 })
  return {
    pieces: fit.pieces.length,
    errorM: fit.errorM,
    draft: {
      parts: [{
        exterior: {
          vertices: [start, corner, ...fit.pieces.map((p) => p.end)],
          segments: ['line', ...fit.pieces.map((p) => ({ kind: 'arc' as const, via: p.via }))],
        },
        holes: [],
      }],
    },
  }
}

describe('a typed curve reaching the layer', () => {
  it('writes a straight course and a curve as one COMPOUNDCURVE', () => {
    const { draft, pieces, errorM } = deedCall()
    expect(pieces).toBe(1)
    expect(errorM).toBeLessThan(0.001)

    const wkt = draftToWkt(draft, 'LINESTRING')!
    expect(wkt).toMatch(/^COMPOUNDCURVE\(/)
    expect(wkt).toContain('CIRCULARSTRING(')
    expect(isCurvedWkt(wkt)).toBe(true)
  })

  it('re-opens for editing as the same curve', () => {
    const { draft } = deedCall()
    const wkt = draftToWkt(draft, 'LINESTRING')!
    const back = parseWktToDraft(wkt)
    expect(back).not.toBeNull()
    expect(draftHasArcs(back!.draft)).toBe(true)

    // The geometry has to survive, not just the class: compare the drawn
    // curves point for point.
    const before = pathDisplayCoords(draft.parts[0].exterior)
    const after = pathDisplayCoords(back!.draft.parts[0].exterior)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      const d = inverse(before[i] as Position, after[i] as Position).distanceM
      expect(d).toBeLessThan(1e-6)
    }
  })

  it('is an all-curve figure when there is no straight course', () => {
    const { draft } = deedCall()
    const ex = draft.parts[0].exterior
    // Drop the leading straight segment — a curve on its own is a plain
    // CIRCULARSTRING, not a COMPOUNDCURVE wrapping one.
    const curveOnly: DraftGeometry = {
      parts: [{ exterior: { vertices: ex.vertices.slice(1), segments: ex.segments.slice(1) }, holes: [] }],
    }
    const wkt = draftToWkt(curveOnly, 'LINESTRING')!
    expect(wkt).toMatch(/^CIRCULARSTRING\(/)
  })
})
