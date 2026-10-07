import { expect, it } from 'vitest'
import { normaliseUsage, restoreUsage, totalUsage, updateUsage } from './usage'

it('includes cache and reasoning subsets once while preserving their reported breakdown', () => {
  expect(normaliseUsage({ prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 20 } }, 'openai-chat'))
    .toEqual({ inputTokens: 100, outputTokens: 30, cachedInputTokens: 80, reasoningTokens: 20, reasoningIncludedInOutput: true, totalTokens: 130 })
  expect(normaliseUsage({ input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 30 }, 'anthropic')).toEqual({ inputTokens: 100, outputTokens: 30, cachedInputTokens: 80, cacheWriteTokens: 10, totalTokens: 130 })
  expect(normaliseUsage({ promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 20, cachedContentTokenCount: 80 }, 'google')).toEqual({ inputTokens: 100, outputTokens: 10, reasoningTokens: 20, cachedInputTokens: 80, reasoningIncludedInOutput: false, totalTokens: 130 })
})

it('reconciles cumulative stream updates without erasing partial usage from failed requests', () => {
  const report = { invocation: 1, scope: 'invocation' as const, attempt: 0, inputTokens: 100, outputTokens: 10 }
  let reports = updateUsage([], report)
  reports = updateUsage(reports, { ...report, outputTokens: 30 })
  reports = updateUsage(reports, { invocation: 2, scope: 'invocation', attempt: 0, inputTokens: 140 })
  expect(totalUsage(reports)).toEqual({ input: 240, output: 30, cached: 0, reasoning: 0, unreportedInput: 0, unreportedOutput: 1 })
  expect(reports).toHaveLength(2)
})

it('does not turn absent, malformed or impossible provider counters into zero-cost claims', () => {
  expect(normaliseUsage({}, 'openai-chat')).toBeNull()
  expect(normaliseUsage({ prompt_tokens: -1, completion_tokens: Infinity }, 'openai-chat')).toBeNull()
  expect(normaliseUsage({ prompt_tokens: 20, prompt_tokens_details: { cached_tokens: 500 } }, 'openai-chat')).toEqual({ inputTokens: 20, reasoningIncludedInOutput: true })
  expect(normaliseUsage({ prompt_eval_count: 100, eval_count: 20, total_duration: 500000000 }, 'ollama')).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, localDurationMs: 500 })
})

it('quarantines forged imported counters and unknown invocation references', () => {
  expect(restoreUsage([
    { invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 10, outputTokens: NaN, cachedInputTokens: 500, extra: 'untrusted' },
    { invocation: 2, attempt: 0, scope: 'invocation', inputTokens: 999 },
    { invocation: 1, attempt: -1, scope: 'invocation', inputTokens: 999 },
  ], 1)).toEqual([{ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 10 }])
})
