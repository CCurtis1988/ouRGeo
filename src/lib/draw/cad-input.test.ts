import { describe, it, expect } from 'vitest'
import { parseCadInput, destination } from './cad-input'

describe('parseCadInput', () => {
  it('parses absolute lng,lat', () => {
    expect(parseCadInput('-122.42, 37.77', null)).toEqual({
      position: [-122.42, 37.77],
      relative: false
    })
    expect(parseCadInput('10 20', null)?.position).toEqual([10, 20])
  })

  it('rejects out-of-range and malformed input', () => {
    expect(parseCadInput('200, 10', null)).toBeNull()
    expect(parseCadInput('abc', null)).toBeNull()
    expect(parseCadInput('', null)).toBeNull()
  })

  it('parses relative distance/angle from the last vertex', () => {
    const res = parseCadInput('d1000 a90', [0, 0])!
    expect(res.relative).toBe(true)
    // 1 km due east from the origin ≈ 0.009° lng, 0 lat
    expect(res.position[0]).toBeCloseTo(0.008993, 4)
    expect(res.position[1]).toBeCloseTo(0, 6)

    // Order-insensitive
    const res2 = parseCadInput('a90 d1000', [0, 0])!
    expect(res2.position[0]).toBeCloseTo(res.position[0])
  })

  it('requires a last vertex for relative form', () => {
    expect(parseCadInput('d100 a45', null)).toBeNull()
  })

  it('requires both distance and angle', () => {
    expect(parseCadInput('d100', [0, 0])).toBeNull()
  })
})

describe('destination', () => {
  it('moves due north by the requested distance', () => {
    const p = destination([0, 0], 111195, 0) // ≈ 1° of latitude
    expect(p[0]).toBeCloseTo(0, 6)
    expect(p[1]).toBeCloseTo(1, 2)
  })
})
