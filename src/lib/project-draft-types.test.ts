import { describe, expect, it } from 'vitest'
import { lockIsStale, olderThan, summariseDrafts, type DraftListing } from './project-draft-types'

const day = 86_400_000
const listing = (patch: Partial<DraftListing>): DraftListing => ({ key: 'k', path: '/p.ourgeoproj', name: 'p', updatedAt: new Date().toISOString(), changed: true, bytes: 1, fileExists: true, open: false, ...patch })

describe('locks', () => {
  it('is stale when the process is gone, or the pid now belongs to another process', () => {
    expect(lockIsStale({ pid: 10, start: '5', acquiredAt: '' }, { alive: false, start: null })).toBe(true)
    expect(lockIsStale({ pid: 10, start: '5', acquiredAt: '' }, { alive: true, start: '6' })).toBe(true)
    expect(lockIsStale({ pid: 10, start: '5', acquiredAt: '' }, { alive: true, start: '5' })).toBe(false)
    expect(lockIsStale({ pid: 10, start: null, acquiredAt: '' }, { alive: true, start: null })).toBe(false)
    expect(lockIsStale({ pid: -1, start: null, acquiredAt: '' }, { alive: true, start: null })).toBe(true)
  })
})

describe('age and health', () => {
  it('counts a draft with no change time as old', () => {
    expect(olderThan(null, 30, Date.now())).toBe(true)
    expect(olderThan(new Date(Date.now() - 31 * day).toISOString(), 30, Date.now())).toBe(true)
    expect(olderThan(new Date().toISOString(), 30, Date.now())).toBe(false)
  })
  it('reports orphans and old drafts, never the open one', () => {
    const report = summariseDrafts([
      listing({ key: 'gone', fileExists: false }),
      listing({ key: 'old', updatedAt: new Date(Date.now() - 100 * day).toISOString() }),
      listing({ key: 'open', fileExists: false, open: true }),
      listing({ key: 'fresh', bytes: 10 }),
    ], Date.now())
    expect(report.count).toBe(4)
    expect(report.orphans.map(d => d.key)).toEqual(['gone'])
    expect(report.old.map(d => d.key)).toEqual(['old'])
  })
})
