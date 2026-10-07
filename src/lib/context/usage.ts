export interface UsageCounters {
  inputTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  reasoningIncludedInOutput?: boolean
  totalTokens?: number
  localDurationMs?: number
}
export interface UsageReport extends UsageCounters {
  invocation: number
  scope: 'invocation' | 'transport-run'
  attempt: number
}
export type UsageProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google' | 'ollama'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined

/** Persisted counters are untrusted input. Recover valid observations without
 * carrying arbitrary fields or non-finite values into accounting/UI. */
export function restoreUsage(value: unknown, invocations: number): UsageReport[] {
  if (!Array.isArray(value) || value.length > 32) return []
  return value.flatMap(item => {
    const raw = object(item)
    const invocation = count(raw.invocation), attempt = count(raw.attempt)
    if (!invocation || invocation > invocations || attempt === undefined || attempt > 32 || !['invocation', 'transport-run'].includes(String(raw.scope))) return []
    const counters: UsageCounters = {}
    for (const key of ['inputTokens', 'cachedInputTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens', 'totalTokens'] as const) {
      const number = count(raw[key])
      if (number !== undefined) counters[key] = number
    }
    if (typeof raw.reasoningIncludedInOutput === 'boolean') counters.reasoningIncludedInOutput = raw.reasoningIncludedInOutput
    if (typeof raw.localDurationMs === 'number' && Number.isFinite(raw.localDurationMs) && raw.localDurationMs >= 0 && raw.localDurationMs <= 86_400_000) counters.localDurationMs = raw.localDurationMs
    if (!Object.keys(counters).some(key => key !== 'reasoningIncludedInOutput')) return []
    if (counters.cachedInputTokens !== undefined && counters.inputTokens !== undefined && counters.cachedInputTokens > counters.inputTokens) delete counters.cachedInputTokens
    return [{ ...counters, invocation, attempt, scope: raw.scope as UsageReport['scope'] }]
  }).reduce(updateUsage, [] as UsageReport[])
}

/** Provider counters are observations, not prices or prompt occupancy. Missing
 * fields remain unknown. Cache/reasoning subsets never get added twice.
 * OpenAI: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
 * Claude: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 * Gemini: https://ai.google.dev/api/generate-content#UsageMetadata */
export function normaliseUsage(value: unknown, protocol: UsageProtocol): UsageCounters | null {
  const usage = object(value)
  let result: UsageCounters
  if (protocol === 'anthropic') {
    const input = count(usage.input_tokens), read = count(usage.cache_read_input_tokens), write = count(usage.cache_creation_input_tokens)
    result = { inputTokens: input === undefined ? undefined : input + (read ?? 0) + (write ?? 0), cachedInputTokens: read, cacheWriteTokens: write, outputTokens: count(usage.output_tokens) }
  } else if (protocol === 'google') {
    result = { inputTokens: count(usage.promptTokenCount), cachedInputTokens: count(usage.cachedContentTokenCount), outputTokens: count(usage.candidatesTokenCount), reasoningTokens: count(usage.thoughtsTokenCount), reasoningIncludedInOutput: false, totalTokens: count(usage.totalTokenCount) }
  } else if (protocol === 'ollama') {
    const rawDuration = usage.total_duration
    const duration = typeof rawDuration === 'number' && Number.isSafeInteger(rawDuration) && rawDuration >= 0 && rawDuration <= 86_400_000_000_000 ? rawDuration : undefined
    result = { inputTokens: count(usage.prompt_eval_count), outputTokens: count(usage.eval_count), ...(duration !== undefined ? { localDurationMs: duration / 1_000_000 } : {}) }
  } else {
    const input = object(protocol === 'openai-chat' ? usage.prompt_tokens_details : usage.input_tokens_details)
    const output = object(protocol === 'openai-chat' ? usage.completion_tokens_details : usage.output_tokens_details)
    result = { inputTokens: count(protocol === 'openai-chat' ? usage.prompt_tokens : usage.input_tokens), cachedInputTokens: count(input.cached_tokens), cacheWriteTokens: count(input.cache_write_tokens),
      outputTokens: count(protocol === 'openai-chat' ? usage.completion_tokens : usage.output_tokens), reasoningTokens: count(output.reasoning_tokens), reasoningIncludedInOutput: true, totalTokens: count(usage.total_tokens) }
  }
  if (result.inputTokens !== undefined && !Number.isSafeInteger(result.inputTokens)) delete result.inputTokens
  if (result.cachedInputTokens !== undefined && result.inputTokens !== undefined && result.cachedInputTokens > result.inputTokens) delete result.cachedInputTokens
  if (result.reasoningTokens !== undefined && result.reasoningIncludedInOutput && result.outputTokens !== undefined && result.reasoningTokens > result.outputTokens) delete result.reasoningTokens
  if (result.totalTokens === undefined && result.inputTokens !== undefined && result.outputTokens !== undefined) result.totalTokens = result.inputTokens + result.outputTokens + (result.reasoningIncludedInOutput === false ? result.reasoningTokens ?? 0 : 0)
  const entries = Object.entries(result).filter(([, value]) => value !== undefined)
  return entries.some(([key]) => key !== 'reasoningIncludedInOutput') ? Object.fromEntries(entries) as UsageCounters : null
}

export function updateUsage(reports: UsageReport[], report: UsageReport): UsageReport[] {
  if (!Number.isSafeInteger(report.invocation) || report.invocation < 1 || !Number.isSafeInteger(report.attempt) || report.attempt < 0
    || !['invocation', 'transport-run'].includes(report.scope)) return reports
  const same = (item: UsageReport): boolean => item.invocation === report.invocation && item.scope === report.scope && item.attempt === report.attempt
  const previous = reports.find(same)
  const result = { ...previous, ...report }
  // Stream usage is cumulative for one request. Replace its observation;
  // summing every message_delta would invent a charge for each streamed token.
  return [...reports.filter(item => !same(item)), result].slice(-32)
}

export function totalUsage(reports: UsageReport[]): { input: number; output: number; cached: number; reasoning: number; unreportedInput: number; unreportedOutput: number } {
  return reports.reduce((total, report) => ({ input: total.input + (report.inputTokens ?? 0), output: total.output + (report.outputTokens ?? 0), cached: total.cached + (report.cachedInputTokens ?? 0), reasoning: total.reasoning + (report.reasoningTokens ?? 0),
    unreportedInput: total.unreportedInput + Number(report.inputTokens === undefined), unreportedOutput: total.unreportedOutput + Number(report.outputTokens === undefined) }), { input: 0, output: 0, cached: 0, reasoning: 0, unreportedInput: 0, unreportedOutput: 0 })
}
