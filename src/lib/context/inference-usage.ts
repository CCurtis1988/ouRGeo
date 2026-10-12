import type { ContextTrace } from './types'
import { restoreUsage, type UsageCounters } from './usage'

export const inferenceProviders = ['openai', 'openai-subscription', 'anthropic', 'claude-cli', 'google', 'ollama', 'lmstudio', 'llamacpp', 'jan', 'localai', 'vllm', 'sglang', 'mistralrs', 'xinference', 'openllm'] as const
export type InferenceUsageProvider = typeof inferenceProviders[number]
export type InferenceAccountingScope = 'global' | `project:${string}`
export interface InferenceUsageInput {
  chatId: string
  turnId: string
  invocation: number
  attempt: number
  accountingScope: 'invocation' | 'transport-run'
  provider: InferenceUsageProvider
  estimatedInputTokens?: number
  delivery: ContextTrace['state']
  reported?: UsageCounters
  final: boolean
}
export interface InferenceUsageReceipt extends InferenceUsageInput {
  id: string
  scope: InferenceAccountingScope
  createdAt: string
  updatedAt: string
}
export interface InferenceUsageSummary {
  cost?: import('./chat-budget').ChatBudgetSummary
  turns: number
  receipts: number
  estimatedInputTokens: number | null
  reportedInputTokens: number | null
  reportedOutputTokens: number | null
  reportedCachedInputTokens: number | null
  reportedCacheWriteTokens: number | null
  reportedReasoningTokens: number | null
  reportedTotalTokens: number | null
  localDurationMs: number | null
  unknownInputReceipts: number
  unknownOutputReceipts: number
  uncertainReceipts: number
  transportRuns: number
  incomplete: boolean
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu
const count = (value: unknown, max = 1_000_000_000): boolean => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
const counterFields = ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'localDurationMs', 'reasoningIncludedInOutput'] as const

export function validateInferenceUsage(input: InferenceUsageInput, scope: string): void {
  if (!input || Object.keys(input).some(key => !['chatId', 'turnId', 'invocation', 'attempt', 'accountingScope', 'provider', 'estimatedInputTokens', 'delivery', 'reported', 'final'].includes(key))
      || typeof input.chatId !== 'string' || typeof input.turnId !== 'string' || !uuid.test(input.chatId) || !uuid.test(input.turnId)
      || typeof scope !== 'string' || !(scope === 'global' || (scope.startsWith('project:') && uuid.test(scope.slice(8))))
      || !count(input.invocation, 32) || input.invocation < 1 || !count(input.attempt, 32)
      || !['invocation', 'transport-run'].includes(input.accountingScope) || !inferenceProviders.includes(input.provider)
      || !['prepared', 'sent', 'acknowledged', 'uncertain'].includes(input.delivery) || typeof input.final !== 'boolean'
      || (input.estimatedInputTokens !== undefined && !count(input.estimatedInputTokens))) throw new Error('Use a host-scoped invocation receipt with bounded token counters; context excerpts and model settings are not accepted.')
  if (input.reported !== undefined) {
    if (!input.reported || typeof input.reported !== 'object' || Array.isArray(input.reported)
        || Object.keys(input.reported).some(key => !counterFields.includes(key as typeof counterFields[number]))) throw new Error('Record only numeric provider usage counters, without response content.')
    for (const [field, value] of Object.entries(input.reported)) {
      if (value === undefined) continue
      if (field === 'reasoningIncludedInOutput' ? typeof value !== 'boolean'
        : field === 'localDurationMs' ? typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 86_400_000 : !count(value)) throw new Error('The provider usage counters are invalid. Preserve the previous receipt and inspect the reported usage.')
    }
    if (input.reported.cachedInputTokens !== undefined && input.reported.inputTokens !== undefined && input.reported.cachedInputTokens > input.reported.inputTokens
      || input.reported.reasoningIncludedInOutput === true && input.reported.reasoningTokens !== undefined && input.reported.outputTokens !== undefined && input.reported.reasoningTokens > input.reported.outputTokens) throw new Error('Cached or reasoning token subsets exceed their reported total. Preserve the previous receipt for review.')
  }
}

/** The canonical worker supplies scope and time. Identity includes retries and
 * the accounting view; repeated streaming observations update one receipt. */
export function mergeInferenceUsage(previous: InferenceUsageReceipt | undefined, input: InferenceUsageInput, id: string, scope: InferenceAccountingScope, now: string): InferenceUsageReceipt {
  validateInferenceUsage(input, scope)
  if (previous && (previous.id !== id || previous.chatId !== input.chatId || previous.turnId !== input.turnId || previous.invocation !== input.invocation || previous.attempt !== input.attempt
      || previous.provider !== input.provider || previous.scope !== scope || previous.accountingScope !== input.accountingScope)) throw new Error('This usage identity belongs to another invocation. Preserve the existing receipt.')
  const reported = { ...previous?.reported }
  for (const field of counterFields) {
    const next = input.reported?.[field], old = reported[field]
    if (next === undefined) continue
    if (previous?.final && old !== undefined && next !== old) throw new Error('Conflicting final usage counters need review; the existing receipt is preserved.')
    if (typeof next === 'boolean' && typeof old === 'boolean' && next !== old) throw new Error('Conflicting reasoning accounting needs review; the existing receipt is preserved.')
    Object.assign(reported, { [field]: typeof next === 'number' && typeof old === 'number' ? Math.max(old, next) : next })
  }
  const delivery = previous?.delivery === 'uncertain' || input.delivery === 'uncertain' ? 'uncertain'
    : previous?.delivery === 'acknowledged' ? 'acknowledged'
      : input.delivery === 'acknowledged' && input.final ? 'acknowledged'
        : previous?.delivery === 'sent' || input.delivery === 'sent' || input.delivery === 'acknowledged' ? 'sent' : 'prepared'
  const receipt: InferenceUsageReceipt = { ...input, id, scope, createdAt: previous?.createdAt ?? now, updatedAt: now, delivery,
    final: !!previous?.final || input.final,
    ...(input.estimatedInputTokens !== undefined || previous?.estimatedInputTokens !== undefined ? { estimatedInputTokens: Math.max(input.estimatedInputTokens ?? 0, previous?.estimatedInputTokens ?? 0) } : {}),
    ...(Object.keys(reported).length ? { reported } : {}) }
  validateInferenceUsage({ chatId: receipt.chatId, turnId: receipt.turnId, invocation: receipt.invocation, attempt: receipt.attempt, accountingScope: receipt.accountingScope,
    provider: receipt.provider, estimatedInputTokens: receipt.estimatedInputTokens, reported: receipt.reported, delivery: receipt.delivery, final: receipt.final }, scope)
  return receipt
}

/** No source handles, excerpts, targets, model names or arbitrary metadata are
 * copied. A transcript-run total supersedes its matching invocation view. */
export function inferenceUsageInputs(trace: ContextTrace, provider: InferenceUsageProvider, final = false): InferenceUsageInput[] {
  const reports = restoreUsage(trace.usage, trace.invocations.length)
  const result: InferenceUsageInput[] = []
  trace.invocations.slice(0, 32).forEach((invocation, index) => {
    const observed = reports.filter(report => report.invocation === index + 1)
    if (!observed.some(report => report.attempt === 0)) observed.push({ invocation: index + 1, attempt: 0, scope: 'invocation' })
    for (const { invocation: number, attempt, scope, ...reported } of observed) result.push({ chatId: trace.identity.chatId, turnId: trace.turnId, invocation: number,
      attempt, accountingScope: scope, provider, estimatedInputTokens: invocation.inputTokens, delivery: trace.state, final,
      ...(Object.keys(reported).length ? { reported } : {}) })
  })
  return result
}

export function summariseInferenceUsage(receipts: Iterable<InferenceUsageReceipt>): InferenceUsageSummary {
  const byIdentity = new Map<string, InferenceUsageReceipt>()
  for (const receipt of receipts) byIdentity.set(receipt.id, receipt)
  const unique = [...byIdentity.values()]
  const key = (receipt: InferenceUsageReceipt): string => JSON.stringify([receipt.scope, receipt.chatId, receipt.turnId, receipt.invocation, receipt.attempt])
  const runs = new Set(unique.filter(receipt => receipt.accountingScope === 'transport-run').map(key))
  const selected = unique.filter(receipt => receipt.accountingScope === 'transport-run' || !runs.has(key(receipt)))
  const sum = (values: (number | undefined)[]): number | null => values.some(value => value !== undefined) ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null
  const total = (receipt: InferenceUsageReceipt): number | undefined => {
    const report = receipt.reported
    if (report?.totalTokens !== undefined) return report.totalTokens
    if (report?.inputTokens === undefined || report.outputTokens === undefined || report.reasoningTokens !== undefined && report.reasoningIncludedInOutput === undefined) return undefined
    return report.inputTokens + report.outputTokens + (report.reasoningIncludedInOutput === false ? report.reasoningTokens ?? 0 : 0)
  }
  const unknownInputReceipts = selected.filter(receipt => receipt.reported?.inputTokens === undefined).length
  const unknownOutputReceipts = selected.filter(receipt => receipt.reported?.outputTokens === undefined).length
  const uncertainReceipts = selected.filter(receipt => receipt.delivery === 'sent' || receipt.delivery === 'uncertain').length
  return { turns: new Set(selected.map(receipt => JSON.stringify([receipt.scope, receipt.chatId, receipt.turnId]))).size, receipts: selected.length,
    estimatedInputTokens: sum(selected.map(receipt => receipt.estimatedInputTokens)), reportedInputTokens: sum(selected.map(receipt => receipt.reported?.inputTokens)),
    reportedOutputTokens: sum(selected.map(receipt => receipt.reported?.outputTokens)), reportedCachedInputTokens: sum(selected.map(receipt => receipt.reported?.cachedInputTokens)),
    reportedCacheWriteTokens: sum(selected.map(receipt => receipt.reported?.cacheWriteTokens)), reportedReasoningTokens: sum(selected.map(receipt => receipt.reported?.reasoningTokens)),
    reportedTotalTokens: selected.length && selected.every(receipt => total(receipt) !== undefined) ? sum(selected.map(total)) : null,
    localDurationMs: sum(selected.map(receipt => receipt.reported?.localDurationMs)), unknownInputReceipts, unknownOutputReceipts, uncertainReceipts,
    transportRuns: selected.filter(receipt => receipt.accountingScope === 'transport-run').length,
    incomplete: !!(unknownInputReceipts || unknownOutputReceipts || uncertainReceipts || selected.some(receipt => !receipt.final || total(receipt) === undefined)) }
}
