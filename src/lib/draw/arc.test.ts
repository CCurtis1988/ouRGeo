import { describe, it, expect } from 'vitest'
import { circumcircle, densifyArc } from './arc'

describe('circumcircle', () => {
  it('finds the circle through three points', () => {
    // Right triangle on the unit circle
    const cc = circumcircle([1, 0], [0, 1], [-1, 0])!
    expect(cc.cx).toBeCloseTo(0)
    expect(cc.cy).toBeCloseTo(0)
    expect(cc.r).toBeCloseTo(1)
  })

  it('returns null for collinear points', () => {
    expect(circumcircle([0, 0], [1, 1], [2, 2])).toBeNull()
  })
})

describe('densifyArc', () => {
  it('passes near the via point and ends exactly at the end point', () => {
    const pts = densifyArc([1, 0], [0, 1], [-1, 0], 4)
    expect(pts[pts.length - 1]).toEqual([-1, 0])
    // Some sample must come close to the via point
    const nearVia = pts.some((p) => Math.hypot(p[0] - 0, p[1] - 1) < 0.05)
    expect(nearVia).toBe(true)
    // All samples stay on the circle
    for (const p of pts) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 5)
    }
    // Half circle at ≤4°/step needs ≥ 45 segments
    expect(pts.length).toBeGreaterThanOrEqual(45)
  })

  it('takes the sweep through the via point, not the short way', () => {
    // via on the long way around: start (1,0) → end (0,1) via (0,-1)
    const pts = densifyArc([1, 0], [0, -1], [0, 1], 10)
    const nearVia = pts.some((p) => Math.hypot(p[0] - 0, p[1] + 1) < 0.1)
    expect(nearVia).toBe(true)
  })

  it('degrades to the end point for collinear input', () => {
    expect(densifyArc([0, 0], [1, 1], [2, 2])).toEqual([[2, 2]])
  })
})
