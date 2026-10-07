import { expect, it } from 'vitest'
import { rankSources } from './rank'
import type { ContextSource } from './types'

const source = (id: string, extra: Partial<ContextSource> = {}): ContextSource => ({ id, kind: 'memory', scope: 'project', title: 'Project CRS decision', summary: 'Choose EPSG:27700 for buffering roads.', revision: '1', trust: 'user', read: () => { throw new Error('Ranking must never fetch a source.') }, ...extra })

it('keeps exact same-name objects in distinct environments ahead of prose mentions', () => {
  const results = rankSources('Which columns are in [roads]?', [
    source('memory:mention', { title: 'roads', summary: 'roads columns roads schema' }),
    source('environment:global', { kind: 'environment', title: '.GlobalEnv::roads', resource: { environment: '.GlobalEnv', name: 'roads' }, trust: 'observed' }),
    source('environment:study', { kind: 'environment', title: 'study::roads', resource: { environment: 'study', name: 'roads' }, trust: 'observed' }),
  ])
  expect(results.slice(0, 2).map(hit => hit.source.id)).toEqual(['environment:global', 'environment:study'])
  expect(results.slice(0, 2).every(hit => hit.reason === 'exact identifier')).toBe(true)
})

it('uses recency for an equally relevant last error while preserving exact older decisions', () => {
  const old = source('console:a', { kind: 'console', title: 'Failed execution', summary: 'error: invalid geometry', timestamp: '2026-10-01T00:00:00Z', trust: 'observed' })
  const recent = { ...old, id: 'console:z', timestamp: '2026-10-07T00:00:00Z' }
  expect(rankSources('that error', [old, recent])[0].source.id).toBe(recent.id)
  const decision = source('memory:older', { title: 'EPSG:27700', timestamp: old.timestamp })
  expect(rankSources('EPSG:27700', [source('memory:newer', { timestamp: recent.timestamp }), decision])[0].source.id).toBe(decision.id)
})

it('fuses lexical and provider ordinal ranks without treating similarity as a probability', () => {
  const sources = [source('memory:a'), source('memory:b'), source('memory:c', { title: 'Different wording', summary: 'A projected reference system.' })]
  const hits = rankSources('EPSG:27700', sources, ['memory:c', 'memory:b'])
  expect(hits[0].source.id).toBe('memory:b')
  expect(hits.find(hit => hit.source.id === 'memory:c')?.reason).toBe('semantic rank')
  expect(hits.some(hit => hit.source.id === 'foreign-provider-source')).toBe(false)
})
