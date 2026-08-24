import { describe, it, expect } from 'vitest'
import { rectangleCorners, circleVertices, simplifyPathPx } from './shapes'
import type { Position } from './types'

const project = (ll: [number, number]) => ({ x: ll[0] * 100, y: -ll[1] * 100 })
const unproject = (p: [number, number]) => ({ lng: p[0] / 100, lat: -p[1] / 100 })

describe('rectangleCorners', () => {
  it('spans the two corners axis-aligned', () => {
    const corners = rectangleCorners([0, 0], [2, 1], false, project, unproject)
    expect(corners).toHaveLength(4)
    expect(corners[0]).toEqual([0, 0])
    expect(corners[1][0]).toBeCloseTo(2)
    expect(corners[2][0]).toBeCloseTo(2)
    expect(corners[2][1]).toBeCloseTo(1)
    expect(corners[3][1]).toBeCloseTo(1)
  })

  it('constrains to a square with shift', () => {
    const corners = rectangleCorners([0, 0], [2, 1], true, project, unproject)
    const w = Math.abs(corners[1][0] - corners[0][0])
    const h = Math.abs(corners[2][1] - corners[1][1])
    expect(w).toBeCloseTo(h)
    expect(w).toBeCloseTo(2)
  })
})

describe('circleVertices', () => {
  it('produces the requested number of vertices at constant pixel radius', () => {
    const verts = circleVertices([0, 0], [1, 0], project, unproject, 32)
    expect(verts).toHaveLength(32)
    for (const v of verts) {
      const p = project(v)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 5)
    }
  })

  it('returns empty for zero radius', () => {
    expect(circleVertices([0, 0], [0, 0], project, unproject)).toEqual([])
  })
})

describe('simplifyPathPx', () => {
  it('drops collinear points and keeps corners', () => {
    const path: Position[] = [
      [0, 0], [0.5, 0], [1, 0],   // straight run
      [1, 0.5], [1, 1]            // corner then straight
    ]
    const out = simplifyPathPx(path, project, 2)
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([1, 1])
    expect(out).toContainEqual([1, 0]) // the corner survives
    expect(out.length).toBeLessThan(path.length)
  })

  it('keeps significant deviations', () => {
    const path: Position[] = [[0, 0], [0.5, 0.5], [1, 0]]
    const out = simplifyPathPx(path, project, 2)
    expect(out).toHaveLength(3)
  })
})
