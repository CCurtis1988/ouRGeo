import { describe, expect, it } from 'vitest'
import { diffLines, diffStats, merge3, resolveMerge, conflictCount, splitLines } from './text-diff'

const apply = (a: string[], changes: ReturnType<typeof diffLines>): string[] => {
  const out: string[] = []
  let at = 0
  for (const c of changes) { out.push(...a.slice(at, c.start), ...c.lines); at = c.end }
  return [...out, ...a.slice(at)]
}

describe('diffLines', () => {
  it('reproduces the target when applied', () => {
    const a = splitLines('a\nb\nc\nd\ne'), b = splitLines('a\nB\nc\nx\ny\ne')
    expect(apply(a, diffLines(a, b))).toEqual(b)
  })
  it('counts added and removed lines', () => {
    expect(diffStats('x\ny\nz', 'x\nY\nz\nw')).toEqual({ added: 2, removed: 1 })
    expect(diffStats('same', 'same')).toEqual({ added: 0, removed: 0 })
  })
})

describe('merge3', () => {
  const base = 'one\ntwo\nthree\nfour\nfive'
  it('combines changes made on different lines', () => {
    const merged = merge3(base, 'ONE\ntwo\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE')
    expect(conflictCount(merged)).toBe(0)
    expect(resolveMerge(merged, [])).toBe('ONE\ntwo\nthree\nfour\nFIVE')
  })
  it('takes an identical change once', () => {
    const merged = merge3(base, 'one\nTWO\nthree\nfour\nfive', 'one\nTWO\nthree\nfour\nfive')
    expect(conflictCount(merged)).toBe(0)
    expect(resolveMerge(merged, [])).toBe('one\nTWO\nthree\nfour\nfive')
  })
  it('reports overlapping different changes as one conflict, resolvable four ways', () => {
    const merged = merge3(base, 'one\nmine\nthree\nfour\nfive', 'one\ntheirs\nthree\nfour\nfive')
    expect(conflictCount(merged)).toBe(1)
    expect(resolveMerge(merged, ['mine'])).toBe('one\nmine\nthree\nfour\nfive')
    expect(resolveMerge(merged, ['theirs'])).toBe('one\ntheirs\nthree\nfour\nfive')
    expect(resolveMerge(merged, ['both'])).toBe('one\nmine\ntheirs\nthree\nfour\nfive')
    expect(resolveMerge(merged, [{ edited: 'hand' }])).toBe('one\nhand\nthree\nfour\nfive')
  })
  it('keeps appended lines from both sides when they differ, as a conflict', () => {
    const merged = merge3('a', 'a\nm', 'a\nt')
    expect(conflictCount(merged)).toBe(1)
    expect(resolveMerge(merged, ['both'])).toBe('a\nm\nt')
  })
  it('handles an empty base', () => {
    expect(resolveMerge(merge3('', 'x', ''), [])).toBe('x')
  })
})
