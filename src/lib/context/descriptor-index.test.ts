import { expect, it, vi } from 'vitest'
import { CompactDescriptorIndex } from './descriptor-index'
import { rankSourcePage } from './rank'
import type { ContextSource } from './types'
import { ContextBroker } from './broker'

const source = (index: number): ContextSource => ({ id: `environment:workspace:object-${index}`, title: `object-${index}`, summary: index % 7 ? 'unrelated metadata' : 'flood parcel exposure', revision: 'revision:1', kind: 'environment', scope: 'workspace', trust: 'observed', resource: { environment: 'workspace', name: `object-${index}` }, read: vi.fn(() => 'original body') })
it('preserves scoped descriptor fields across packed segment boundaries without reading bodies', () => {
  const originals = Array.from({ length: 2100 }, (_, index) => source(index)), read = vi.fn(() => 'resolved current body')
  originals[1024] = { ...originals[1024], title: '測定😀', timestamp: '2026-10-08T00:00:00Z', prerequisites: 'load prerequisites', legacyIds: ['environment:old:測定'], group: 'spatial', readRange: () => 'range' }
  const range = vi.fn(() => 'resolved current range')
  const index = CompactDescriptorIndex.from(originals, { read, readRange: range })
  expect(index.count).toBe(2100)
  const rebuilt = [...index.sources(['environment'])]
  for (let row = 0; row < originals.length; row++) {
    const { read: ignoredRead, readRange: ignoredRange, ...before } = originals[row]
    const { read: ignoredNewRead, readRange: ignoredNewRange, ...after } = rebuilt[row]
    void ignoredRead; void ignoredRange; void ignoredNewRead; void ignoredNewRange
    expect(after).toEqual(before)
    expect(originals[row].read).not.toHaveBeenCalled()
  }
  expect(read).not.toHaveBeenCalled()
  expect(rebuilt[1024].read()).toBe('resolved current body')
  expect(read).toHaveBeenCalledWith(originals[1024].id, 'revision:1', undefined)
  expect(rebuilt[1024].readRange!({ startLine: 3, endLine: 4 })).toBe('resolved current range')
  expect(range).toHaveBeenCalledWith(originals[1024].id, 'revision:1', { startLine: 3, endLine: 4 }, undefined)
})

it('retains exact and broad lexical page order and provider rank fusion', () => {
  const sources = Array.from({ length: 2300 }, (_, index) => source(index))
  const index = CompactDescriptorIndex.from(sources, { read: () => '' })
  for (const query of ['', 'flood parcel', '[object-987]', 'not-found']) for (const start of [0, 10, 100]) {
    const expected = rankSourcePage(query, () => sources, start, 10, [sources[2048].id, sources[7].id])
    const actual = rankSourcePage(query, () => index.scan(), start, 10, [sources[2048].id, sources[7].id])
    expect(actual.total).toBe(expected.total)
    expect(actual.hits.map(hit => [hit.source.id, hit.reason])).toEqual(expected.hits.map(hit => [hit.source.id, hit.reason]))
  }
})

it('uses ordinary broker freshness and exclusion checks with lazy descriptors', async () => {
  const read = vi.fn(() => 'authorised metadata'), index = CompactDescriptorIndex.from([source(1), source(2)], { read })
  let excluded: string[] = []
  const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: kinds => index.scan(kinds), excluded: () => excluded })
  const result = JSON.parse(broker.search({ query: 'object-1' }))
  expect(result.results[0].title).toBe('object-1')
  expect(read).not.toHaveBeenCalled()
  excluded = [source(1).id]
  expect(await broker.read({ ref: result.results[0].ref })).toContain('SOURCE_UNAVAILABLE')
  expect(read).not.toHaveBeenCalled()
})

it('enforces bounded derived metadata before accepting an oversized index', () => {
  expect(() => CompactDescriptorIndex.from([source(1)], { read: () => '' }, 10)).toThrow('derived-cache limit')
  expect(() => CompactDescriptorIndex.from([{ ...source(1), summary: 'x'.repeat(16385) }], { read: () => '' })).toThrow('descriptor exceeds')
})


it('snapshots each retained scan hit and keeps its reader bound after further scans', async () => {
  const read = vi.fn((id: string) => id)
  const index = CompactDescriptorIndex.from(Array.from({ length: 1200 }, (_, row) => source(row)), { read })
  const page = rankSourcePage('', () => index.scan(), 0, 10)
  const ids = page.hits.map(hit => hit.source.id)
  expect(new Set(ids).size).toBe(10)
  for (const ignored of index.scan()) void ignored
  expect(page.hits.map(hit => hit.source.id)).toEqual(ids)
  for (const hit of page.hits) expect(await hit.source.read()).toBe(hit.source.id)
  const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: kinds => index.scan(kinds), excluded: () => [] })
  const result = JSON.parse(broker.search({ query: '[object-1]' }))
  expect(await broker.read({ ref: result.results[0].ref })).toContain(source(1).id)
  expect(read).toHaveBeenLastCalledWith(source(1).id, 'revision:1', expect.any(AbortSignal))
})

it('never lets cached identity classification bypass encoded credentials or a changed ID', async () => {
  const sources = [source(1), { ...source(2), id: 'document:password%3Dprivate-value' }, { ...source(3), id: 'document:%ZZ' }]
  const index = CompactDescriptorIndex.from(sources, { read: () => 'body' })
  const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => index.scan(), excluded: () => [] })
  const result = JSON.parse(broker.search({ query: '' }))
  expect(result.results).toHaveLength(1)
  expect(result.results[0].resource.name).toBe('object-1')
  const cards = [...index.sources()]
  cards[0].id = 'document:password=changed-secret'
  const mutated = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => cards, excluded: () => [] })
  expect(JSON.parse(mutated.search({ query: '' })).results).toEqual([])
})

it('keeps case-insensitive ranking and trust order when classified metadata is later edited', () => {
  const originals = Array.from({ length: 8 }, (_, row) => ({ ...source(row), trust: (['host', 'user', 'observed', 'untrusted'] as const)[row % 4], title: row % 2 ? 'PARCEL' : 'parcel', summary: 'Flood Exposure 測定' }))
  const index = CompactDescriptorIndex.from(originals, { read: () => '' })
  const cards = [...index.sources()]
  cards[0].title = 'RENAMED'; cards[0].summary = 'SPECIAL'
  for (const query of ['', 'PARCEL', 'EXPOSURE', '測定', 'special']) {
    const expected = rankSourcePage(query, () => cards.map(card => ({ ...card })), 0, 8)
    const actual = rankSourcePage(query, () => cards, 0, 8)
    expect(actual.hits.map(hit => [hit.source.id, hit.score])).toEqual(expected.hits.map(hit => [hit.source.id, hit.score]))
  }
})
