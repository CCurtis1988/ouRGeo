import { expect, it, vi } from 'vitest'
import { sourceBrowserPage } from './source-browser'
import type { ContextSource } from './types'
import { CompactDescriptorIndex } from './descriptor-index'
import { ConsoleIndex } from './sources/console-index'

function source(id: string): ContextSource { return { id, kind: 'document', scope: 'workspace', title: id, summary: 'roads metadata', revision: '1', trust: 'user', read: vi.fn(() => 'private body') } }

it('keeps cached console metadata private after descriptor edits and appended failures', () => {
  const index = new ConsoleIndex()
  const events = [{ id: 'command', type: 'input', text: 'print(roads)', timestamp: 0 }]
  const sources = index.update(events, 'workspace:1')
  const read = vi.spyOn(sources[0], 'read')
  expect(sourceBrowserPage('', () => sources, []).cards[0].summary).toBe('print(roads)')
  sources[0].summary = 'password=hidden-after-edit'
  expect(sourceBrowserPage('', () => index.update(events, 'workspace:1'), []).cards[0].summary).not.toContain('hidden-after-edit')
  const changed = index.update([...events, { id: 'failure', type: 'error', text: 'Authorization: Bearer hidden-error', timestamp: 1 }], 'workspace:1')
  expect(sourceBrowserPage('', () => changed, []).cards[0].summary).not.toContain('hidden-error')
  expect(read).not.toHaveBeenCalled()
})

it('rejects controls even when the identity is supplied by a cached packed index', () => {
  const packed = CompactDescriptorIndex.from([source('document:bad%0aidentifier'), source('document:bad\u007fidentifier'), source('document:safe')], { read: () => { throw new Error('Bodies must not be read') } })
  expect(sourceBrowserPage('', () => packed.scan(), []).cards.map(card => card.id)).toEqual(['document:safe'])
})

it('browses ten descriptions at a time without fetching bodies and keeps excluded states distinct', () => {
  const sources = Array.from({ length: 35 }, (_, index) => source(`document:${String(index).padStart(2, '0')}`))
  const first = sourceBrowserPage('', () => sources, ['document:03'])
  expect(first.total).toBe(35)
  expect(first.cards).toHaveLength(10)
  expect(first.cards.find(card => card.id === 'document:03')?.state).toBe('excluded')
  const second = sourceBrowserPage('', () => sources, [], 10)
  expect(second.cards[0].id).toBe('document:10')
  const denied = sourceBrowserPage('', () => sources, ['document:03'], 0, 'excluded')
  expect(denied.total).toBe(1)
  expect(denied.cards[0].reason).toContain('privacy settings')
  const available = sourceBrowserPage('', () => sources, ['document:03'], 0, 'available')
  expect(available.total).toBe(34)
  for (const item of sources) expect(item.read).not.toHaveBeenCalled()
})

it('redacts and bounds adversarial descriptions and rejects credential-bearing identities', () => {
  const item = source('document:safe')
  item.title = `password=do-not-display ${'a'.repeat(500)}`
  item.summary = `Authorization: Bearer confidential\n${'b'.repeat(900)}`
  const secret = source('document:sk-abcdefghijklmnopqrstuv')
  const result = sourceBrowserPage('', () => [item, secret], [])
  expect(result.total).toBe(1)
  expect(result.cards[0].title).not.toContain('do-not-display')
  expect(result.cards[0].summary).not.toContain('confidential')
  expect(result.cards[0].title.length).toBeLessThanOrEqual(160)
  expect(result.cards[0].summary.length).toBeLessThanOrEqual(600)
  expect(Object.keys(result.cards[0])).not.toContain('read')
})

it('supports exact descriptor searches and rejects excessive pagination', () => {
  const result = sourceBrowserPage('document:roads', () => [source('document:roads'), source('document:other')], [])
  expect(result.cards[0].id).toBe('document:roads')
  expect(result.cards[0].reason).toBe('exact identifier')
  expect(() => sourceBrowserPage('', () => [], [], 10001)).toThrow('BUDGET_LIMIT')
})

it('keeps packed pages stable across reused cards and redacts changed or forged metadata', () => {
  const originals = Array.from({ length: 35 }, (_, index) => source(`document:${String(index).padStart(2, '0')}`))
  const packed = CompactDescriptorIndex.from(originals, { read: () => { throw new Error('Bodies are not authorised') } })
  const first = sourceBrowserPage('', () => packed.scan(), [])
  expect(first.cards.map(card => card.id)).toEqual(originals.slice(0, 10).map(item => item.id))
  expect(first.cards.map(card => card.title)).toEqual(first.cards.map(card => card.id))
  const changed = [...packed.sources()][0]
  changed.title = 'password=must-redact'; changed.summary = 'secret=changed-value'
  const forged = { ...source('document:forged'), title: 'password=forged-value', redactionSafe: true }
  const result = sourceBrowserPage('', () => [changed, forged, source('document:%0a'), source('document:%73k-abcdefghijklmnopqrstuv')], [])
  expect(result.total).toBe(2)
  expect(JSON.stringify(result.cards)).not.toMatch(/must-redact|changed-value|forged-value/)
})
