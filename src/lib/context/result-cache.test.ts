import { afterEach, expect, it, vi } from 'vitest'
import { cacheResult, clearResultCache, resolveResult, resultSources } from './result-cache'
import type { ContextIdentity, ContextSource } from './types'

const identity: ContextIdentity = { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 0 }
const source = (id: string): ContextSource => ({ id, kind: 'result', scope: 'conversation', title: id, summary: 'Raw result', revision: '1', trust: 'observed', read: () => 'Result' })
afterEach(() => { clearResultCache(); vi.useRealTimers() })

it('releases idle result handles at the deadline without needing a later lookup', () => {
  vi.useFakeTimers()
  cacheResult(identity, 'first', source('first'), 'data')
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(60 * 60_000)
  // No follow-up access ran the expiry loop; the timer removed the final entry
  // and itself, releasing the source's raw-content closure.
  expect(vi.getTimerCount()).toBe(0)
  expect(resolveResult(identity, 'first')).toBeUndefined()
})

it('counts a replaced handle once while preserving authorised neighbouring results', () => {
  const text = 'x'.repeat(3 * 1024 * 1024 / 2)
  cacheResult(identity, 'first', source('first'), text)
  cacheResult(identity, 'first', source('first-new'), text)
  cacheResult(identity, 'second', source('second'), text)
  expect(resultSources(identity).map(item => item.id)).toEqual(['first-new', 'second'])
  expect(resultSources({ ...identity, workspaceEpoch: 2 })).toEqual([])
  clearResultCache(identity.chatId)
  expect(resultSources(identity)).toEqual([])
})
