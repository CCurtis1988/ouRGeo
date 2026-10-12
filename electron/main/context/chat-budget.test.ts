import { afterEach, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStorage } from './storage'
import type { ChatBudgetPolicy } from '../../../src/lib/context/chat-budget'
import type { InferenceUsageInput } from '../../../src/lib/context/inference-usage'

const stores: MemoryStorage[] = [], directories: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const receipt = (extra: Partial<InferenceUsageInput> = {}): InferenceUsageInput => ({ chatId: randomUUID(), turnId: randomUUID(), invocation: 1, attempt: 0, accountingScope: 'invocation', provider: 'openai', delivery: 'sent', estimatedInputTokens: 1000, final: false, ...extra })
const policy = (revision = 1): ChatBudgetPolicy => ({ revision, enabled: true, dailyMicros: 10000, monthlyMicros: 20000, prices: [{ provider: 'openai', model: 'fixture', inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000, cachedMicrosPerMillion: 100_000, writeMicrosPerMillion: 1_500_000, reviewedAt: new Date().toISOString() }] })
function fixture(path = ':memory:', key = randomBytes(32)) { const store = new MemoryStorage(path, Buffer.from(key)); stores.push(store); return store }
it('commits input and a conservative output/cache reservation atomically before dispatch', () => {
  const store = fixture(), input = receipt()
  store.chatBudget().configure(policy())
  store.prepareInferenceUsage(input, 'global', 'fixture', 1000)
  expect(store.inferenceUsageSummary('global')).toMatchObject({ receipts: 1, incomplete: true, uncertainReceipts: 1 })
  expect(store.chatBudget().summary()).toMatchObject({ outstandingMicros: 3500, pendingReceipts: 1 })
  expect(() => store.prepareInferenceUsage(input, 'global', 'fixture', 1000)).toThrow('already prepared')
  expect(store.chatBudget().summary().pendingReceipts).toBe(1)
  const next = receipt({ estimatedInputTokens: 5000 })
  expect(() => store.prepareInferenceUsage(next, 'global', 'fixture', 2000)).toThrow('budget is covered')
  expect(store.inferenceUsageSummary('global').receipts).toBe(1)
})
it('uses frozen reviewed prices to reconcile cache and reasoning subsets once without inventing an invoice', () => {
  const store = fixture(), input = receipt(), scope = `project:${randomUUID()}` as const
  store.chatBudget().configure(policy())
  store.prepareInferenceUsage(input, scope, 'fixture', 1000)
  store.chatBudget().configure({ ...policy(2), prices: [{ ...policy().prices[0], inputMicrosPerMillion: 9_000_000 }] })
  const final = { ...input, final: true, delivery: 'acknowledged' as const, reported: { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, cacheWriteTokens: 100, reasoningTokens: 20, reasoningIncludedInOutput: false } }
  store.recordInferenceUsage(final, scope)
  store.recordInferenceUsage(final, scope)
  expect(store.chatBudget().summary(scope)).toMatchObject({ estimatedMicros: 1110, outstandingMicros: 0, pendingReceipts: 0 })
  expect(store.chatBudget().summary('global').estimatedMicros).toBe(0)
  expect(store.chatBudget().summary(scope, randomUUID()).estimatedMicros).toBe(0)
  expect(() => store.recordInferenceUsage({ ...final, reported: { ...final.reported, outputTokens: 999 } }, scope)).toThrow('final usage')
  expect(store.chatBudget().summary(scope).estimatedMicros).toBe(1110)
})
it('retains interrupted receipts and reservations across restart, cancellation and UTC rollover', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ourgeo-chat-budget-')); directories.push(directory)
  const path = join(directory, 'canonical.sqlite'), key = randomBytes(32), store = fixture(path, key), input = receipt()
  store.chatBudget().configure(policy())
  store.prepareInferenceUsage(input, 'global', 'fixture', 1000)
  store.recordInferenceUsage({ ...input, final: true, delivery: 'uncertain' }, 'global')
  stores.splice(stores.indexOf(store), 1); store.close()
  const restarted = fixture(path, key)
  expect(restarted.chatBudget().summary(undefined, undefined, Date.now() + 90 * 86_400_000)).toMatchObject({ outstandingMicros: 3500, pendingReceipts: 1 })
  expect(restarted.inferenceUsageSummary('global').incomplete).toBe(true)
  for (const file of readdirSync(directory).filter(file => /sqlite(?:-wal)?$/u.test(file))) {
    const bytes = readFileSync(join(directory, file))
    expect(bytes.includes(Buffer.from(input.chatId))).toBe(false)
    expect(bytes.includes(Buffer.from('fixture'))).toBe(false)
  }
})
it('refuses stale or missing prices and opaque subscription processing while a budget is enabled', () => {
  const store = fixture(), config = policy()
  const old = { ...config.prices[0], reviewedAt: new Date(Date.now() - 31 * 86_400_000).toISOString() }
  expect(() => store.chatBudget().configure({ ...config, prices: [old] })).toThrow('30 days')
  store.chatBudget().configure(config)
  expect(() => store.prepareInferenceUsage(receipt(), 'global', 'unknown', 1000)).toThrow('pricing is missing')
  expect(() => store.prepareInferenceUsage(receipt({ provider: 'claude-cli' }), 'global', 'fixture', 1000)).toThrow('internal processing')
  expect(store.inferenceUsageSummary('global').receipts).toBe(0)
})
it('allows explicit zero rates and retains unpriced usage without describing it as free', () => {
  const store = fixture(), input = receipt()
  store.prepareInferenceUsage(input, 'global', 'fixture', 1000)
  expect(store.chatBudget().summary()).toMatchObject({ estimatedMicros: null, pendingUnknownPriceReceipts: 1 })
  store.recordInferenceUsage({ ...input, final: true, reported: { inputTokens: 10, outputTokens: 5 } }, 'global')
  expect(store.chatBudget().summary()).toMatchObject({ estimatedMicros: null, unknownPriceReceipts: 1, pendingReceipts: 0 })
  store.chatBudget().configure({ ...policy(), prices: [{ ...policy().prices[0], inputMicrosPerMillion: 0, outputMicrosPerMillion: 0, cachedMicrosPerMillion: 0, writeMicrosPerMillion: 0 }] })
  const local = receipt()
  store.prepareInferenceUsage(local, 'global', 'fixture', 1000)
  expect(store.chatBudget().summary().outstandingMicros).toBe(0)
})
it('lets expired prices be retained when disabling a budget without refreshing their review date', () => {
  const store = fixture(), config = policy(), now = Date.now()
  store.chatBudget().configure(config, now)
  const disabled = { ...config, revision: 2, enabled: false }
  expect(store.chatBudget().configure(disabled, now + 31 * 86_400_000)).toEqual(disabled)
  expect(() => store.chatBudget().configure({ ...disabled, revision: 3, prices: [{ ...config.prices[0], outputMicrosPerMillion: 3 }] }, now + 31 * 86_400_000)).toThrow('30 days')
})
it('reconciles a transport-run alias with its prepared invocation and keeps unknown output reserved', () => {
  const store = fixture(), input = receipt({ provider: 'claude-cli' })
  store.prepareInferenceUsage(input, 'global', 'subscription', 1000)
  store.recordInferenceUsage({ ...input, final: true, accountingScope: 'transport-run', reported: { inputTokens: 1000, outputTokens: 50 } }, 'global')
  expect(store.chatBudget().summary()).toMatchObject({ pendingReceipts: 0, unknownPriceReceipts: 1, estimatedMicros: null })
  const next = receipt()
  store.prepareInferenceUsage(next, 'global', 'unknown', 1000)
  store.recordInferenceUsage({ ...next, final: true, reported: { inputTokens: 1000 } }, 'global')
  expect(store.chatBudget().summary().pendingReceipts).toBe(1)
})
