import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM helper without type declarations
import { pairedDiff, passHatK, perTask, signTest, holm, ratioOfGeoMeans } from '../skill-training/lib/stats.mjs'

describe('skill-training statistics', () => {
  it('pass^k is 1 only when every run of every task passed', () => {
    const all = [{ task: 'a', pass: true }, { task: 'a', pass: true }, { task: 'b', pass: true }, { task: 'b', pass: true }]
    expect(passHatK(all, 2)).toBe(1)
    expect(passHatK([...all.slice(0, 2), { task: 'b', pass: true }, { task: 'b', pass: false }], 2)).toBe(0.5)
  })
  it('a uniform improvement has a CI that excludes zero; no change straddles it', () => {
    const base = new Map(Array.from({ length: 50 }, (_, i) => [`t${i}`, i % 2 ? 1 : 0]))
    const better = new Map([...base].map(([t, v]) => [t, Math.min(1, v + (Number(t.slice(1)) % 4 === 0 ? 1 : 0))]))
    const up = pairedDiff(base, better)
    expect(up.diff).toBeGreaterThan(0)
    expect(up.ci95[0]).toBeGreaterThan(0)
    const same = pairedDiff(base, base)
    expect(same.ci95).toEqual([0, 0])
  })
  it('sign test and Holm match textbook values', () => {
    expect(signTest(8, 0)).toBeCloseTo(0.0078125)
    expect(signTest(5, 5)).toBe(1)
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06])
  })
  it('perTask averages runs and ratioOfGeoMeans halves', () => {
    const t = perTask([{ task: 'a', pass: true }, { task: 'a', pass: false }])
    expect(t.get('a')).toBe(0.5)
    const r = ratioOfGeoMeans(new Map([['a', 100], ['b', 200]]), new Map([['a', 50], ['b', 100]]))
    expect(r.ratio).toBeCloseTo(0.5)
  })
})
