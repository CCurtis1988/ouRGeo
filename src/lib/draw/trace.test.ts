import { describe, it, expect } from 'vitest'
import { geometryTracePaths, projectOntoPath, extractSubPath } from './trace'
import type { TracePath } from './trace'

const square: TracePath = {
  vertices: [[0, 0], [10, 0], [10, 10], [0, 10]],
  closed: true
}
const line: TracePath = {
  vertices: [[0, 0], [10, 0], [20, 0]],
  closed: false
}

describe('geometryTracePaths', () => {
  it('extracts rings (closing vertex trimmed) and line parts', () => {
    const poly: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
    }
    const paths = geometryTracePaths(poly)
    expect(paths).toHaveLength(1)
    expect(paths[0].closed).toBe(true)
    expect(paths[0].vertices).toHaveLength(4)

    const mls: GeoJSON.MultiLineString = {
      type: 'MultiLineString',
      coordinates: [[[0, 0], [1, 0]], [[2, 0], [3, 0]]]
    }
    expect(geometryTracePaths(mls)).toHaveLength(2)
  })
})

describe('projectOntoPath', () => {
  it('projects onto the nearest segment, including the closing edge of rings', () => {
    const p = projectOntoPath(square, [5, -1])!
    expect(p.segIdx).toBe(0)
    expect(p.point[0]).toBeCloseTo(5)
    expect(p.point[1]).toBeCloseTo(0)

    // Closing edge (0,10) → (0,0) is segment 3
    const q = projectOntoPath(square, [-1, 5])!
    expect(q.segIdx).toBe(3)
    expect(q.point).toEqual([0, 5])
  })
})

describe('extractSubPath', () => {
  it('walks an open line between two projections (single route)', () => {
    const from = projectOntoPath(line, [2, 1])!
    const to = projectOntoPath(line, [15, 1])!
    const sub = extractSubPath(line, from, to, false)
    expect(sub[0]).toEqual([2, 0])
    expect(sub[sub.length - 1]).toEqual([15, 0])
    expect(sub).toContainEqual([10, 0])
  })

  it('walks a ring forward or backward depending on direction', () => {
    const from = projectOntoPath(square, [5, -1])! // bottom edge
    const to = projectOntoPath(square, [-1, 5])!   // left (closing) edge

    const forward = extractSubPath(square, from, to, false)
    // Forward passes through (10,0), (10,10), (0,10)
    expect(forward).toContainEqual([10, 0])
    expect(forward).toContainEqual([10, 10])
    expect(forward).toContainEqual([0, 10])

    const backward = extractSubPath(square, from, to, true)
    // Backward goes through (0,0) only
    expect(backward).toContainEqual([0, 0])
    expect(backward).not.toContainEqual([10, 10])
    expect(backward[0]).toEqual([5, 0])
    expect(backward[backward.length - 1]).toEqual([0, 5])
  })
})
