import { expect, it } from 'vitest'
import type { ContextTrace } from './types'
import { aggregateContextUsage } from './usage-aggregate'
import type { UsageReport } from './usage'

const receipt = (values: Partial<UsageReport> = {}): UsageReport => ({ invocation: 1, attempt: 0, scope: 'invocation', inputTokens: 100, outputTokens: 30, ...values })
const trace = (values: Partial<ContextTrace> = {}): ContextTrace => ({
  turnId: 'turn', identity: { projectId: 'project', chatId: 'chat', policyRevision: 1, workspaceEpoch: 1 },
  state: 'acknowledged', target: 'synthetic', selected: [], excluded: [], retrievalCalls: 2, returnedTokens: 80,
  invocations: [{ inputTokens: 120, window: 32000, estimated: true }], usage: [receipt()], ...values,
})

it('counts a copied turn once and replaces cumulative stream observations while retaining retries', () => {
  const first = trace({ usage: [receipt({ outputTokens: 10 })] })
  const final = trace({ usage: [receipt(), receipt({ attempt: 1, inputTokens: 110, outputTokens: 20 })] })
  const totals = aggregateContextUsage([first, final, final], { projectId: 'project', chatId: 'chat' })
  expect(totals).toMatchObject({ turns: 1, receipts: 2, input: 210, output: 50, total: 260, estimatedInput: 120, plannedInvocations: 1, incomplete: false })
})

it('sums retrieval follow-ups across a project without mixing another project or chat', () => {
  const second = trace({ turnId: 'second', identity: { projectId: 'project', chatId: 'other', policyRevision: 2, workspaceEpoch: 9 },
    invocations: [{ inputTokens: 120, window: 32000, estimated: true }, { inputTokens: 150, window: 32000, estimated: true }], usage: [receipt(), receipt({ invocation: 2, inputTokens: 140 })] })
  const foreign = trace({ identity: { projectId: 'foreign', chatId: 'chat', policyRevision: 1, workspaceEpoch: 1 } })
  expect(aggregateContextUsage([trace(), second, foreign], { projectId: 'project' })).toMatchObject({ turns: 2, receipts: 3, input: 340, output: 90, estimatedInput: 390 })
  expect(aggregateContextUsage([trace(), second, foreign], { projectId: 'project', chatId: 'chat' })).toMatchObject({ turns: 1, input: 100 })
})

it('keeps scratch usage within the current conversation', () => {
  const current = trace({ identity: { projectId: null, chatId: 'chat', policyRevision: 1, workspaceEpoch: 1 } })
  const previous = trace({ identity: { projectId: null, chatId: 'previous', policyRevision: 1, workspaceEpoch: 1 } })
  expect(aggregateContextUsage([current, previous, trace()], { projectId: null, chatId: 'chat' })).toMatchObject({ turns: 1, input: 100 })
})

it('preserves cache breakdowns and counts separately reported reasoning only once', () => {
  const included = trace({ usage: [receipt({ cachedInputTokens: 80, cacheWriteTokens: 10, reasoningTokens: 20, reasoningIncludedInOutput: true })] })
  const separate = trace({ turnId: 'separate', usage: [receipt({ reasoningTokens: 20, reasoningIncludedInOutput: false })] })
  expect(aggregateContextUsage([included, separate], { projectId: 'project' })).toMatchObject({ input: 200, output: 60, cached: 80, cacheWrites: 10, reasoning: 40, total: 280 })
})

it('keeps absent counters unknown and distinguishes partial and cancelled receipts', () => {
  const partial = trace({ state: 'uncertain', usage: [receipt({ outputTokens: undefined })] })
  expect(aggregateContextUsage([partial], { projectId: 'project' })).toMatchObject({ input: 100, output: null, total: null, incomplete: true, uncertainTurns: 1 })
  expect(aggregateContextUsage([trace({ usage: [] })], { projectId: 'project' })).toMatchObject({ receipts: 0, input: null, output: null, total: null, incomplete: true })
  expect(aggregateContextUsage([trace({ usage: [receipt({ reasoningTokens: 5 })] })], { projectId: 'project' })).toMatchObject({ total: null, incomplete: true })
})

it('uses a whole-run receipt without adding overlapping invocation observations', () => {
  const run = trace({ usage: [receipt(), receipt({ scope: 'transport-run', inputTokens: 300, outputTokens: 90 }), receipt({ scope: 'transport-run', attempt: 1, inputTokens: 400, outputTokens: 100 })] })
  expect(aggregateContextUsage([run], { projectId: 'project' })).toMatchObject({ receipts: 2, input: 700, output: 190, transportRuns: 2, total: 890 })
})

it('keeps accounting after evidence expiry and refuses invalid imported counters', () => {
  const expired = trace({ evidenceExpired: true, usage: [receipt({ inputTokens: -5, cachedInputTokens: Infinity, outputTokens: 30 })] })
  expect(aggregateContextUsage([expired], { projectId: 'project' })).toMatchObject({ input: null, output: 30, cached: null, incomplete: true })
})
