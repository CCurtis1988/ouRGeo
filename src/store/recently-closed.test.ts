import { describe, expect, it } from 'vitest'
import { mergeRecentlyClosed, MAX_RECENTLY_CLOSED } from './recently-closed'
import { normaliseInterval } from './project-settings'

describe('recently closed', () => {
  it('puts new paths first, de-duplicates and caps at 20 (§2.5)', () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ path: `/f${i}.R`, closedAt: 'old' }))
    const merged = mergeRecentlyClosed(existing, ['/new.R', '/f3.R'], 'now')
    expect(merged).toHaveLength(MAX_RECENTLY_CLOSED)
    expect(merged.slice(0, 3).map(i => i.path)).toEqual(['/new.R', '/f3.R', '/f0.R'])
    expect(merged.filter(i => i.path === '/f3.R')).toHaveLength(1)
  })
})

describe('snapshot interval', () => {
  it('keeps 0 (only on close) and the 10 s – 30 min range, else falls back to 30 s', () => {
    expect(normaliseInterval(0)).toBe(0)
    expect(normaliseInterval(10)).toBe(10)
    expect(normaliseInterval(1800)).toBe(1800)
    expect(normaliseInterval(5)).toBe(30)
    expect(normaliseInterval('x')).toBe(30)
  })
})
