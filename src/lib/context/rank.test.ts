import { expect, it } from 'vitest'
import { rankSources, rankSourcePage } from './rank'
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

it('matches complete rankings and totals over bounded lexical and fused pages', () => {
  let seed = 12345
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  const trusts = ['host', 'user', 'observed', 'untrusted'] as const
  const sources = Array.from({ length: 503 }, (_, index) => {
    const kind = index % 3 === 0 ? 'console' : index % 5 === 0 ? 'environment' : 'memory'
    return source(`source:${String(index).padStart(4, '0')}`, { kind, title: ['Theme decision', 'EPSG:27700', 'Été palette', 'Failed execution', 'Unrelated record'][next() % 5],
      summary: ['roads schema', 'error: invalid geometry', 'theme palette colours', 'project decision', 'unrelated'][next() % 5], trust: trusts[next() % trusts.length],
      timestamp: new Date(1_000_000 + next() % 1_000_000).toISOString(), ...(kind === 'environment' ? { resource: { environment: '.GlobalEnv', name: index % 2 ? 'roads' : 'rivers' } } : {}) })
  })
  const eligible = (source: ContextSource): boolean => !source.id.endsWith('7')
  for (const query of ['', 'theme', 'EPSG:27700', 'that error', '[roads]', 'Été palette']) {
    for (const semantic of [[], ['source:0400', 'source:0001', 'source:0450', 'source:0017', 'foreign-source']]) {
      const full = rankSources(query, sources, semantic, 'provider', eligible)
      for (const start of [0, 5, 21, 90, 500]) {
        const page = rankSourcePage(query, () => sources, start, 7, semantic, 'provider', eligible)
        expect(page.total).toBe(full.length)
        expect(page.hits).toEqual(full.slice(start, start + 7))
      }
    }
  }
})

it('validates identifiers only for matches while retaining a complete broad-discovery count', () => {
  let validations = 0, scans = 0
  function *sources(): Generator<ContextSource> {
    scans++
    for (let index = 0; index < 10000; index++) yield source(`source:${index}`, { title: index === 4321 ? 'exact target' : 'unrelated', summary: '' })
  }
  const narrow = rankSourcePage('exact target', sources, 0, 5, [], 'semantic', () => { validations++; return true })
  expect(narrow.total).toBe(1)
  expect(narrow.hits[0].source.id).toBe('source:4321')
  expect(validations).toBe(1)
  expect(scans).toBe(1)
  const broad = rankSourcePage('', sources, 45, 5)
  expect(broad.total).toBe(10000)
  expect(broad.hits).toHaveLength(5)
  expect(scans).toBe(2)
  expect(() => rankSourcePage('', sources, Infinity, 5)).toThrow('BUDGET_LIMIT')
})
