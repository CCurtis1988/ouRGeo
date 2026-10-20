import { describe, expect, it } from 'vitest'
import { planDocs, planKeyed, planR, mergeList, mineName, resolvedSide, itemsNeedingChoice } from './project-merge'
import type { MergeEnvItem } from './r-client'

interface Item { id: string; v: number }
const key = (i: Item): string => i.id

describe('planKeyed', () => {
  const base = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }, { id: 'd', v: 1 }]
  const mine = [{ id: 'a', v: 2 }, { id: 'b', v: 1 }, { id: 'c', v: 3 }, { id: 'd', v: 1 }, { id: 'm', v: 1 }]
  const theirs = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 4 }, { id: 't', v: 1 }]
  const items = planKeyed('layer', base, mine, theirs, key, i => i.id)
  const status = Object.fromEntries(items.map(i => [i.key, i.status]))
  it('sorts each item by who changed it', () => {
    expect(status).toEqual({ a: 'auto-mine', b: 'auto-theirs', c: 'conflict', d: 'auto-theirs', m: 'auto-mine', t: 'auto-theirs' })
  })
  it('asks only about conflicts', () => {
    expect(itemsNeedingChoice(items, {}).map(i => i.key)).toEqual(['c'])
    expect(itemsNeedingChoice(items, { 'layer:c': 'mine' })).toEqual([])
  })
  it('merges into mine order, with theirs-only additions after and both kept on request', () => {
    const merged = mergeList(mine, theirs, items, { 'layer:c': 'both' }, key, (i, taken) => ({ ...i, id: mineName(i.id, n => taken.has(n)) }))
    expect(merged).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 2 }, { id: 'c', v: 4 }, { id: 'c_mine', v: 3 }, { id: 'm', v: 1 }, { id: 't', v: 1 }])
  })
})

describe('documents', () => {
  const doc = (content: string) => ({ id: 'd', fileName: 'a.R', content })
  it('combines non-overlapping edits without asking', () => {
    const [item] = planDocs([doc('1\n2\n3\n4')], [doc('X\n2\n3\n4')], [doc('1\n2\n3\nY')])
    expect(item.status).toBe('combined')
    expect(resolvedSide(item, undefined)).toBe('mine')
  })
  it('leaves overlapping edits as a conflict with segments', () => {
    const [item] = planDocs([doc('1\n2')], [doc('1\nmine')], [doc('1\ntheirs')])
    expect(item.status).toBe('conflict')
    expect(item.segments?.some(s => s.kind === 'conflict')).toBe(true)
  })
})

describe('R objects', () => {
  const r = (name: string, mineEqBase: boolean, theirsEqBase: boolean, mineEqTheirs: boolean): MergeEnvItem => ({ name, has: { base: true, mine: true, theirs: true }, mineEqBase, theirsEqBase, mineEqTheirs, describe: [] })
  it('uses R\'s comparison', () => {
    const items = planR([r('same', true, true, true), r('mineOnly', false, true, false), r('theirsOnly', true, false, false), r('both', false, false, false)])
    expect(items.map(i => [i.key, i.status])).toEqual([['mineOnly', 'auto-mine'], ['theirsOnly', 'auto-theirs'], ['both', 'conflict']])
  })
})

describe('mineName', () => {
  it('suffixes before the extension and avoids collisions', () => {
    expect(mineName('roads.csv', () => false)).toBe('roads_mine.csv')
    expect(mineName('roads', n => n === 'roads_mine')).toBe('roads_mine_2')
  })
})
