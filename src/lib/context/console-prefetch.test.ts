import { expect, it, vi } from 'vitest'
import { consoleFailurePrefetch } from './console-prefetch'
import type { ContextSource } from './types'
const read = vi.fn()
const source = (id: string, summary: string): ContextSource => ({ id, kind: 'console', scope: 'workspace', title: 'Failure at 2026-10-10T00:00:00Z', summary, revision: '1', trust: 'untrusted', read })
it('resolves a named join failure among noisy errors without reading their bodies', () => {
  expect(consoleFailurePrefetch([source('join', 'Join columns parcel_id missing'), source('knit', 'object income not found')], 'Help fix the parcel_id join error.')).toEqual(['join'])
  expect(read).not.toHaveBeenCalled()
})
it('leaves generic and equally matching failures open for scoped retrieval', () => {
  const sources = [source('a', 'parcel_id missing'), source('b', 'parcel_id missing')]
  expect(consoleFailurePrefetch(sources, 'Fix that error.')).toEqual([])
  expect(consoleFailurePrefetch(sources, 'Fix parcel_id.')).toEqual([])
  expect(consoleFailurePrefetch([sources[0]], 'Fix that error.')).toEqual(['a'])
  expect(consoleFailurePrefetch([{ ...sources[0], title: 'Execution at 2026-10-10' }], 'Fix parcel_id.')).toEqual([])
})
