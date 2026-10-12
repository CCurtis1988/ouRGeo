import { afterEach, expect, it } from 'vitest'
import { accountingOnlyTrace, DAY_MS, memoryRetention, traceExpired, traceRetentionDays } from './retention'
import type { ContextTrace, MemoryRecord } from './types'

const now = Date.parse('2026-10-08T00:00:00Z')
const memory = (extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Prefer metres', evidence: [], assertion: 'inferred', status: 'active', supersedes: [], createdAt: new Date(now - 181 * DAY_MS).toISOString(), updatedAt: new Date(now).toISOString(), ...extra })
afterEach(() => traceRetentionDays(7))

it('requests review of unsupported inferred preferences without expiring explicit preferences or treating synchronisation as evidence', () => {
  expect(memoryRetention(memory(), now)).toEqual({ expired: false, review: true })
  expect(memoryRetention(memory({ assertion: 'user-declared' }), now)).toEqual({ expired: false, review: false })
  expect(memoryRetention(memory({ lastSupportedAt: new Date(now - DAY_MS).toISOString() }), now).review).toBe(false)
  expect(memoryRetention(memory({ editedAt: new Date(now - DAY_MS).toISOString() }), now).review).toBe(false)
  expect(memoryRetention(memory({ category: 'decision' }), now).review).toBe(false)
})

it('expires suggestions at thirty days and applies a recorded validity boundary independently of preference age', () => {
  expect(memoryRetention(memory({ status: 'candidate', createdAt: new Date(now - 30 * DAY_MS).toISOString() }), now).expired).toBe(true)
  expect(memoryRetention(memory({ expiresAt: new Date(now).toISOString(), assertion: 'user-declared' }), now).expired).toBe(true)
  expect(memoryRetention(memory({ expiresAt: new Date(now + 1).toISOString() }), now).expired).toBe(false)
})

const trace = (): ContextTrace => ({ turnId: 'turn', identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 0 }, target: 'secret-server', state: 'acknowledged', selected: [{ ref: 'ctx_secret', sourceId: 'private-doc', kind: 'document', scope: 'workspace', title: 'Private title', revision: '1', reason: 'private reason', content: 'private excerpt', estimatedTokens: 10, completeness: 'complete' }], invocations: [{ inputTokens: 25, window: 32000, estimated: true, sentRefs: ['ctx_secret'] }], retrievalCalls: 1, returnedTokens: 10, excluded: ['private-doc'], limitations: ['private failure'], usage: [{ invocation: 1, attempt: 1, scope: 'invocation', inputTokens: 25, outputTokens: 5 }] })

it('bounds diagnostic retention and uses the original receipt time rather than refreshing it on reads', () => {
  expect(traceExpired(trace(), now - 7 * DAY_MS, now)).toBe(true)
  traceRetentionDays(1)
  expect(traceExpired(trace(), now - DAY_MS, now)).toBe(true)
  traceRetentionDays(100)
  expect(traceRetentionDays()).toBe(1)
  expect(traceExpired({ ...trace(), recordedAt: now - 8 * DAY_MS }, now, now)).toBe(true)
})

it('retains immutable counters while removing every diagnostic excerpt and source reference', () => {
  const original = trace(), shell = accountingOnlyTrace(original)
  expect(shell.usage).toEqual(original.usage)
  expect(shell.invocations).toEqual([{ inputTokens: 25, window: 32000, estimated: true }])
  expect(shell.evidenceExpired).toBe(true)
  expect(JSON.stringify(shell)).not.toMatch(/private|ctx_secret|secret-server/i)
  expect(original.selected).toHaveLength(1)
})
