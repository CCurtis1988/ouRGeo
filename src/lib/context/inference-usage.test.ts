import { expect, it } from 'vitest'
import type { ContextTrace } from './types'
import { inferenceUsageInputs, mergeInferenceUsage, summariseInferenceUsage, validateInferenceUsage, type InferenceUsageInput } from './inference-usage'

const input = (extra: Partial<InferenceUsageInput> = {}): InferenceUsageInput => ({ chatId: '11111111-1111-4111-8111-111111111111', turnId: '22222222-2222-4222-8222-222222222222', invocation: 1, attempt: 0,
  accountingScope: 'invocation', provider: 'openai', estimatedInputTokens: 100, delivery: 'sent', final: false, ...extra })
const time = '2026-10-08T00:00:00.000Z'
it('updates cumulative observations once and keeps cached/reasoning subsets separate from the total', () => {
  const first = mergeInferenceUsage(undefined, input({ reported: { inputTokens: 100, outputTokens: 5, cachedInputTokens: 40 } }), 'id', 'global', time)
  const second = mergeInferenceUsage(first, input({ reported: { outputTokens: 20, reasoningTokens: 10, reasoningIncludedInOutput: true }, final: true, delivery: 'acknowledged' }), 'id', 'global', time)
  const summary = summariseInferenceUsage([second, second])
  expect(summary.receipts).toBe(1)
  expect(summary.reportedInputTokens).toBe(100)
  expect(summary.reportedOutputTokens).toBe(20)
  expect(summary.reportedCachedInputTokens).toBe(40)
  expect(summary.reportedReasoningTokens).toBe(10)
  expect(summary.reportedTotalTokens).toBe(120)
  expect(summary.incomplete).toBe(false)
})
it('never changes uncertainty to acknowledgement through a late final callback', () => {
  const previous = mergeInferenceUsage(undefined, input({ delivery: 'uncertain' }), 'id', 'global', time)
  const late = mergeInferenceUsage(previous, input({ final: true, delivery: 'acknowledged', reported: { inputTokens: 3, outputTokens: 4 } }), 'id', 'global', time)
  expect(late.delivery).toBe('uncertain')
  expect(summariseInferenceUsage([late]).uncertainReceipts).toBe(1)
})
it('preserves unknown usage and ambiguous reasoning rather than inventing zero cost or adding it twice', () => {
  const unknown = mergeInferenceUsage(undefined, input(), 'unknown', 'global', time)
  expect(summariseInferenceUsage([unknown]).reportedInputTokens).toBeNull()
  const ambiguous = mergeInferenceUsage(undefined, input({ reported: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 } }), 'ambiguous', 'global', time)
  expect(summariseInferenceUsage([ambiguous]).reportedTotalTokens).toBeNull()
  const separate = mergeInferenceUsage(undefined, input({ reported: { inputTokens: 10, outputTokens: 5, reasoningTokens: 3, reasoningIncludedInOutput: false } }), 'separate', 'global', time)
  expect(summariseInferenceUsage([separate]).reportedTotalTokens).toBe(18)
})
it('counts retries separately and prefers a transport-run receipt over its matching invocation view', () => {
  const first = mergeInferenceUsage(undefined, input({ reported: { inputTokens: 10, outputTokens: 5 } }), 'first', 'global', time)
  const run = mergeInferenceUsage(undefined, input({ accountingScope: 'transport-run', reported: { inputTokens: 30, outputTokens: 20 } }), 'run', 'global', time)
  const retry = mergeInferenceUsage(undefined, input({ attempt: 1, reported: { inputTokens: 2, outputTokens: 1 } }), 'retry', 'global', time)
  const summary = summariseInferenceUsage([first, run, retry])
  expect(summary.receipts).toBe(2)
  expect(summary.reportedInputTokens).toBe(32)
  expect(summary.transportRuns).toBe(1)
})
it('refuses arbitrary fields, invalid identities, impossible subsets and contradictory final counters', () => {
  expect(() => validateInferenceUsage({ ...input(), content: 'private excerpt' } as InferenceUsageInput, 'global')).toThrow('excerpts')
  expect(() => validateInferenceUsage(input({ provider: 'https://private.example' as 'openai' }), 'global')).toThrow()
  expect(() => validateInferenceUsage(input({ reported: { inputTokens: 1, cachedInputTokens: 2 } }), 'global')).toThrow('subsets')
  const settled = mergeInferenceUsage(undefined, input({ final: true, reported: { inputTokens: 10 } }), 'id', 'global', time)
  expect(() => mergeInferenceUsage(settled, input({ reported: { inputTokens: 11 } }), 'id', 'global', time)).toThrow('final usage')
  expect(settled.reported?.inputTokens).toBe(10)
})
it('extracts only content-free identities and counters from traces, including cancelled unreported invocations', () => {
  const trace: ContextTrace = { turnId: input().turnId, identity: { chatId: input().chatId, projectId: null, workspaceEpoch: 1, policyRevision: 0 },
    target: 'private-destination', state: 'uncertain', selected: [], excluded: ['private-source'], limitations: ['private-failure'], invocations: [{ inputTokens: 100, window: 32000, estimated: true, sentRefs: ['private-reference'] }], retrievalCalls: 1, returnedTokens: 3,
    usage: [{ invocation: 1, attempt: 1, scope: 'invocation', inputTokens: 40, outputTokens: 10 }] }
  const receipts = inferenceUsageInputs(trace, 'openai', true)
  expect(receipts.map(receipt => receipt.attempt)).toEqual([1, 0])
  expect(JSON.stringify(receipts)).not.toContain('private-')
  expect(receipts.find(receipt => receipt.attempt === 0)?.reported).toBeUndefined()
})
