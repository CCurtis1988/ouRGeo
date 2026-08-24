import { describe, it, expect } from 'vitest'
import { applyPicksToSelections, candidateLabel, selKey } from './selection-apply'

const visible = [
  { accessPath: 'pts', envName: '.GlobalEnv' },
  { accessPath: 'polys', envName: '.GlobalEnv' },
]

describe('applyPicksToSelections', () => {
  it('replace writes picks and clears other visible layers', () => {
    const existing = { 'polys::.GlobalEnv': [1, 2], 'hidden::.GlobalEnv': [7] }
    const next = applyPicksToSelections(
      existing,
      [{ accessPath: 'pts', envName: '.GlobalEnv', indices: [3, 1] }],
      false,
      visible,
    )
    expect(next['pts::.GlobalEnv']).toEqual([1, 3])
    expect(next['polys::.GlobalEnv']).toEqual([])
    // hidden layers are untouched by replace
    expect(next['hidden::.GlobalEnv']).toEqual([7])
  })

  it('replace with empty picks clears all visible layers', () => {
    const existing = { 'pts::.GlobalEnv': [0], 'polys::.GlobalEnv': [5] }
    const next = applyPicksToSelections(existing, [], false, visible)
    expect(next['pts::.GlobalEnv']).toEqual([])
    expect(next['polys::.GlobalEnv']).toEqual([])
  })

  it('merge unions with existing, dedupes and sorts', () => {
    const existing = { 'pts::.GlobalEnv': [2, 5] }
    const next = applyPicksToSelections(
      existing,
      [{ accessPath: 'pts', envName: '.GlobalEnv', indices: [5, 1] }],
      true,
      visible,
    )
    expect(next['pts::.GlobalEnv']).toEqual([1, 2, 5])
  })

  it('merge leaves layers not in picks untouched', () => {
    const existing = { 'polys::.GlobalEnv': [4] }
    const next = applyPicksToSelections(
      existing,
      [{ accessPath: 'pts', envName: '.GlobalEnv', indices: [0] }],
      true,
      visible,
    )
    expect(next['polys::.GlobalEnv']).toEqual([4])
    expect(next['pts::.GlobalEnv']).toEqual([0])
  })

  it('does not mutate the existing map', () => {
    const existing = { 'pts::.GlobalEnv': [1] }
    applyPicksToSelections(existing, [], false, visible)
    expect(existing['pts::.GlobalEnv']).toEqual([1])
  })
})

describe('candidateLabel', () => {
  it('uses the first primitive property', () => {
    expect(candidateLabel({ NAME: 'Ashe', AREA: 0.114 }, 0)).toBe('NAME: Ashe')
  })

  it('skips geometry-ish, underscore, null and object-valued keys', () => {
    expect(
      candidateLabel({ geometry: 'x', _id: 9, meta: { a: 1 }, empty: null, CNTY: 1825 }, 0),
    ).toBe('CNTY: 1825')
  })

  it('truncates long values', () => {
    const label = candidateLabel({ name: 'x'.repeat(60) }, 0)
    expect(label).toBe(`name: ${'x'.repeat(40)}…`)
  })

  it('falls back to a 1-based feature number', () => {
    expect(candidateLabel(null, 4)).toBe('Feature 5')
    expect(candidateLabel({ geom: 'skip' }, 0)).toBe('Feature 1')
  })
})

describe('selKey', () => {
  it('matches the store key format', () => {
    expect(selKey('pts', '.GlobalEnv')).toBe('pts::.GlobalEnv')
  })
})
