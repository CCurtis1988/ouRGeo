import { expect, it } from 'vitest'
import { applyMemoryRevision, memoryRelevance, preferenceMatch, preferenceSetting } from './preferences'
import type { MemoryRecord } from './types'

const memory = (statement: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement, evidence: [], assertion: 'user-declared', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', status: 'active', supersedes: [], ...extra })

it('finds relevant units without adding a profile to synthetic or general turns', () => {
  expect(preferenceMatch('How far should I buffer this layer?', 'I prefer metric units')).toBe(true)
  expect(preferenceMatch('Calculate the area of this layer', 'Use miles for this project')).toBe(true)
  expect(preferenceMatch('Generate 100 rows of dummy data.', 'I prefer metric units')).toBe(false)
  expect(preferenceMatch('How do R lists work?', 'I prefer metric units')).toBe(false)
  expect(memoryRelevance('Calculate the distance of this layer', 'Use EPSG:27700 for this project', '')).toBe(0)
  expect(memoryRelevance('Calculate the distance of this layer', 'Use miles for this project', '')).toBeGreaterThan(0)
})
it('supersedes an explicit conflicting setting atomically within the same scope', () => {
  const old = memory('I prefer metric units'), next = memory('I prefer imperial units'), project = memory('Use metric units for this project', { scope: 'project', projectId: crypto.randomUUID() })
  const result = applyMemoryRevision([old, project], next)
  expect(result.record.supersedes).toEqual([old.id])
  expect(result.records.find(record => record.id === old.id)?.status).toBe('superseded')
  expect(result.records.find(record => record.id === project.id)).toEqual(project)
  expect(result.changed[0].revision).toBe(2)
})
it('keeps suggestions, inferred claims and ambiguous conventions from replacing a user instruction', () => {
  const old = memory('I prefer metric units')
  for (const next of [memory('I prefer imperial units', { status: 'candidate' }), memory('I prefer imperial units', { assertion: 'inferred' }), memory('Use metric and imperial units side by side')]) {
    expect(applyMemoryRevision([old], next).changed).toEqual([])
  }
  expect(preferenceSetting('Metric with imperial equivalents')).toBeNull()
})

it('requires review rather than emitting an unportable oversized supersession chain', () => {
  const records = Array.from({ length: 33 }, () => memory('I prefer metric units'))
  expect(() => applyMemoryRevision(records, memory('I prefer imperial units'))).toThrow('review')
  expect(records.every(record => record.status === 'active')).toBe(true)
})
