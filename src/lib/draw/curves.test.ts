import { describe, it, expect } from 'vitest'
import { cubicBezier, densifyBezier, bezierArcSpline, tangentArcVia, incomingTangent } from './curves'
import { circumcircle } from './arc'
import type { DraftPath, Position } from './types'

describe('cubicBezier', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    const p0: Position = [0, 0]
    const c1: Position = [0, 1]
    const c2: Position = [1, 1]
    const p3: Position = [1, 0]
    expect(cubicBezier(p0, c1, c2, p3, 0)).toEqual([0, 0])
    expect(cubicBezier(p0, c1, c2, p3, 1)).toEqual([1, 0])
  })

  it('is symmetric at t=0.5 for a symmetric control net', () => {
    const mid = cubicBezier([0, 0], [0, 1], [2, 1], [2, 0], 0.5)
    expect(mid[0]).toBeCloseTo(1) // midway in x
    expect(mid[1]).toBeCloseTo(0.75) // peak of the bump
  })
})

describe('densifyBezier', () => {
  it('includes both endpoints and has steps+1 points', () => {
    const pts = densifyBezier([0, 0], [0, 1], [1, 1], [1, 0], 16)
    expect(pts).toHaveLength(17)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([1, 0])
  })
})

describe('bezierArcSpline', () => {
  const p0: Position = [0, 0]
  const c1: Position = [0, 1]
  const c2: Position = [1, 1]
  const p3: Position = [1, 0]

  it('produces arcCount arcs whose endpoints track the Bézier samples', () => {
    const arcs = bezierArcSpline(p0, c1, c2, p3, 8)
    expect(arcs).toHaveLength(8)
    // Last arc ends exactly at the Bézier end point.
    expect(arcs[arcs.length - 1].end[0]).toBeCloseTo(p3[0])
    expect(arcs[arcs.length - 1].end[1]).toBeCloseTo(p3[1])
    // Each arc's end == the even sample, via == the odd sample.
    arcs.forEach((a, i) => {
      const end = cubicBezier(p0, c1, c2, p3, (2 * i + 2) / 16)
      const via = cubicBezier(p0, c1, c2, p3, (2 * i + 1) / 16)
      expect(a.end[0]).toBeCloseTo(end[0])
      expect(a.end[1]).toBeCloseTo(end[1])
      expect(a.via[0]).toBeCloseTo(via[0])
      expect(a.via[1]).toBeCloseTo(via[1])
    })
  })
})

describe('tangentArcVia', () => {
  it('returns a via whose arc is tangent to the given direction and passes through end', () => {
    const start: Position = [0, 0]
    const end: Position = [1, 1]
    const via = tangentArcVia(start, end, [1, 0])! // tangent along +x
    expect(via).not.toBeNull()
    // The arc through start/via/end is centered on the tangent normal (0, R).
    const cc = circumcircle(start, via, end)!
    expect(cc.cx).toBeCloseTo(0)
    expect(cc.cy).toBeCloseTo(1)
    expect(cc.r).toBeCloseTo(1)
  })

  it('returns null when the end lies along the tangent (straight)', () => {
    expect(tangentArcVia([0, 0], [2, 0], [1, 0])).toBeNull()
  })
})

describe('incomingTangent', () => {
  it('is the unit direction of the last straight segment', () => {
    const path: DraftPath = { vertices: [[0, 0], [2, 0]], segments: ['line'] }
    const t = incomingTangent(path)!
    expect(t[0]).toBeCloseTo(1)
    expect(t[1]).toBeCloseTo(0)
  })

  it('is null when the path has fewer than two points', () => {
    expect(incomingTangent({ vertices: [[0, 0]], segments: [] })).toBeNull()
  })
})
