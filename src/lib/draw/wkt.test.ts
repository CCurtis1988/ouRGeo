import { describe, it, expect } from 'vitest'
import { draftToWkt, parseWktToDraft, draftHasArcs, isCurvedWkt } from './wkt'
import { emptyDraft, appendVertex, startHole, startPart, draftToGeoJSON } from './draft'
import type { DraftGeometry, Position, SegmentKind, PathRef } from './types'

const P0: PathRef = { part: 0, ring: 0 }

function build(
  steps: { pos: Position; seg?: SegmentKind }[],
  at: PathRef = P0,
  base: DraftGeometry = emptyDraft()
): DraftGeometry {
  let d = base
  for (const s of steps) d = appendVertex(d, at, s.pos, s.seg ?? 'line')
  return d
}

const arc = (via: Position): SegmentKind => ({ kind: 'arc', via })

describe('draftToWkt — straight drafts', () => {
  it('emits plain types when no arcs exist', () => {
    expect(draftToWkt(build([{ pos: [1, 2] }]), 'POINT')).toBe('POINT(1 2)')
    expect(
      draftToWkt(build([{ pos: [0, 0] }, { pos: [2, 0] }]), 'LINESTRING')
    ).toBe('LINESTRING(0 0, 2 0)')
    expect(
      draftToWkt(build([{ pos: [0, 0] }, { pos: [4, 0] }, { pos: [4, 4] }]), 'POLYGON')
    ).toBe('POLYGON((0 0, 4 0, 4 4, 0 0))')
  })
})

describe('draftToWkt — curved drafts', () => {
  it('single arc → CIRCULARSTRING', () => {
    const d = build([{ pos: [0, 0] }, { pos: [2, 0], seg: arc([1, 1]) }])
    expect(draftToWkt(d, 'LINESTRING')).toBe('CIRCULARSTRING(0 0, 1 1, 2 0)')
  })

  it('chained arcs share junction vertices in one CIRCULARSTRING', () => {
    const d = build([
      { pos: [0, 0] },
      { pos: [2, 0], seg: arc([1, 1]) },
      { pos: [4, 0], seg: arc([3, -1]) }
    ])
    expect(draftToWkt(d, 'LINESTRING')).toBe('CIRCULARSTRING(0 0, 1 1, 2 0, 3 -1, 4 0)')
  })

  it('mixed segments → COMPOUNDCURVE with shared junctions', () => {
    const d = build([
      { pos: [0, 0] },
      { pos: [2, 0], seg: arc([1, 1]) },
      { pos: [4, 0] }
    ])
    expect(draftToWkt(d, 'LINESTRING')).toBe(
      'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 2 0), (2 0, 4 0))'
    )
  })

  it('polygon with an arc ring → CURVEPOLYGON with straight closing run', () => {
    const d = build([
      { pos: [0, 0] },
      { pos: [4, 0], seg: arc([2, 2]) },
      { pos: [4, 4] }
    ])
    expect(draftToWkt(d, 'POLYGON')).toBe(
      'CURVEPOLYGON(COMPOUNDCURVE(CIRCULARSTRING(0 0, 2 2, 4 0), (4 0, 4 4, 0 0)))'
    )
  })

  it('straight hole in a curved polygon stays a bare ring list', () => {
    let d = build([{ pos: [0, 0] }, { pos: [10, 0], seg: arc([5, 5]) }, { pos: [10, 10] }])
    const { draft: d2, active } = startHole(d, 0)
    d = build(
      [{ pos: [2, 2] }, { pos: [4, 2] }, { pos: [4, 4] }],
      active,
      d2
    )
    const wkt = draftToWkt(d, 'POLYGON')!
    expect(wkt.startsWith('CURVEPOLYGON(COMPOUNDCURVE(')).toBe(true)
    expect(wkt).toContain('(2 2, 4 2, 4 4, 2 2)')
    expect(wkt).not.toContain('CIRCULARSTRING(2 2')
  })

  it('MULTILINESTRING with any curved part → MULTICURVE', () => {
    let d = build([{ pos: [0, 0] }, { pos: [2, 0] }])
    const { draft: d2, active } = startPart(d)
    d = build([{ pos: [5, 0] }, { pos: [7, 0], seg: arc([6, 1]) }], active, d2)
    expect(draftToWkt(d, 'MULTILINESTRING')).toBe(
      'MULTICURVE((0 0, 2 0), CIRCULARSTRING(5 0, 6 1, 7 0))'
    )
  })

  it('MULTIPOLYGON with a curved part → MULTISURFACE mixing bare and CURVEPOLYGON', () => {
    let d = build([{ pos: [0, 0] }, { pos: [4, 0] }, { pos: [4, 4] }])
    const { draft: d2, active } = startPart(d)
    d = build([{ pos: [10, 0] }, { pos: [14, 0], seg: arc([12, 2]) }, { pos: [14, 4] }], active, d2)
    const wkt = draftToWkt(d, 'MULTIPOLYGON')!
    expect(wkt.startsWith('MULTISURFACE(((0 0, 4 0, 4 4, 0 0)), CURVEPOLYGON(')).toBe(true)
  })

  it('strict gating matches draftToGeoJSON (incomplete ring → null)', () => {
    const d = build([{ pos: [0, 0] }, { pos: [4, 0], seg: arc([2, 2]) }])
    expect(draftToWkt(d, 'POLYGON')).toBeNull()
  })
})

describe('parseWktToDraft', () => {
  it('round-trips every emitted curved form', () => {
    const cases: { steps: { pos: Position; seg?: SegmentKind }[]; type: 'LINESTRING' | 'POLYGON' }[] = [
      { steps: [{ pos: [0, 0] }, { pos: [2, 0], seg: arc([1, 1]) }], type: 'LINESTRING' },
      {
        steps: [{ pos: [0, 0] }, { pos: [2, 0], seg: arc([1, 1]) }, { pos: [4, 0] }],
        type: 'LINESTRING'
      },
      {
        steps: [{ pos: [0, 0] }, { pos: [4, 0], seg: arc([2, 2]) }, { pos: [4, 4] }],
        type: 'POLYGON'
      }
    ]
    for (const c of cases) {
      const d = build(c.steps)
      const wkt = draftToWkt(d, c.type)!
      const parsed = parseWktToDraft(wkt)!
      expect(parsed).not.toBeNull()
      expect(parsed.family).toBe(c.type)
      expect(draftToWkt(parsed.draft, c.type)).toBe(wkt) // stable re-emission
    }
  })

  it('accepts sf::st_as_text output (spaces + LINESTRING-labeled components)', () => {
    const parsed = parseWktToDraft(
      'COMPOUNDCURVE (CIRCULARSTRING (0 0, 1 1, 2 0), LINESTRING (2 0, 4 0))'
    )!
    expect(parsed.family).toBe('LINESTRING')
    expect(parsed.draft.parts[0].exterior.vertices).toEqual([[0, 0], [2, 0], [4, 0]])
    expect(parsed.draft.parts[0].exterior.segments).toEqual([
      { kind: 'arc', via: [1, 1] },
      'line'
    ])
    expect(draftToWkt(parsed.draft, 'LINESTRING')).toBe(
      'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 1, 2 0), (2 0, 4 0))'
    )
  })

  it('drops the duplicate closing vertex for straight-closed rings', () => {
    const parsed = parseWktToDraft('POLYGON ((0 0, 4 0, 4 4, 0 0))')!
    expect(parsed.draft.parts[0].exterior.vertices).toEqual([[0, 0], [4, 0], [4, 4]])
    expect(draftToWkt(parsed.draft, 'POLYGON')).toBe('POLYGON((0 0, 4 0, 4 4, 0 0))')
  })

  it('keeps explicit closure for arc-closed rings (full disc round-trips)', () => {
    // Full circle: start == end, via at the diametral antipode. Normalized
    // into two half-arcs on parse (geometrically identical), then stable.
    const parsed = parseWktToDraft('CURVEPOLYGON(CIRCULARSTRING(0 0, 2 0, 0 0))')!
    expect(parsed.family).toBe('POLYGON')
    const ext = parsed.draft.parts[0].exterior
    expect(ext.vertices).toEqual([[0, 0], [2, 0], [0, 0]])
    expect(ext.segments).toEqual([
      { kind: 'arc', via: [1, 1] },
      { kind: 'arc', via: [1, -1] }
    ])
    const reEmitted = draftToWkt(parsed.draft, 'POLYGON')!
    expect(reEmitted).toBe('CURVEPOLYGON(CIRCULARSTRING(0 0, 1 1, 2 0, 1 -1, 0 0))')
    // Stable from here on
    const again = parseWktToDraft(reEmitted)!
    expect(draftToWkt(again.draft, 'POLYGON')).toBe(reEmitted)
    // Display conversion must not duplicate the closing point
    const g = draftToGeoJSON(parsed.draft, 'POLYGON') as GeoJSON.Polygon
    const ring = g.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring.length).toBeGreaterThan(10) // densified arc
  })

  it('parses straight multi types and MULTIPOINT in both WKT forms', () => {
    expect(parseWktToDraft('MULTILINESTRING((0 0, 1 0), (2 0, 3 0))')!.draft.parts).toHaveLength(2)
    expect(parseWktToDraft('MULTIPOINT((1 2), (3 4))')!.draft.parts[0].exterior.vertices).toEqual([[1, 2], [3, 4]])
    expect(parseWktToDraft('MULTIPOINT(1 2, 3 4)')!.family).toBe('MULTIPOINT')
    const ms = parseWktToDraft(
      'MULTISURFACE(CURVEPOLYGON(CIRCULARSTRING(0 0, 2 0, 0 0)), ((10 10, 11 10, 11 11, 10 10)))'
    )!
    expect(ms.family).toBe('MULTIPOLYGON')
    expect(ms.draft.parts).toHaveLength(2)
  })

  it('rejects unsupported input', () => {
    expect(parseWktToDraft('GEOMETRYCOLLECTION(POINT(0 0))')).toBeNull()
    expect(parseWktToDraft('LINESTRING EMPTY')).toBeNull()
    expect(parseWktToDraft('POINT Z (1 2 3)')).toBeNull()
    expect(parseWktToDraft('LINESTRING(1 2 3, 4 5 6)')).toBeNull()
    expect(parseWktToDraft('banana')).toBeNull()
  })
})

describe('helpers', () => {
  it('draftHasArcs and isCurvedWkt', () => {
    expect(draftHasArcs(build([{ pos: [0, 0] }, { pos: [1, 0] }]))).toBe(false)
    expect(draftHasArcs(build([{ pos: [0, 0] }, { pos: [1, 0], seg: arc([0.5, 1]) }]))).toBe(true)
    expect(isCurvedWkt('LINESTRING(0 0, 1 1)')).toBe(false)
    expect(isCurvedWkt('CURVEPOLYGON(CIRCULARSTRING(0 0, 2 0, 0 0))')).toBe(true)
  })
})
