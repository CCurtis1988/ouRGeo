import type { ContextTrace } from './types'
import { restoreUsage, updateUsage, type UsageReport } from './usage'

export type UsageScope = { projectId: string; chatId?: string } | { projectId: null; chatId: string }

export interface UsageAggregate {
  turns: number
  plannedInvocations: number
  estimatedInput: number
  receipts: number
  input: number | null
  output: number | null
  cached: number | null
  cacheWrites: number | null
  reasoning: number | null
  total: number | null
  localDurationMs: number | null
  incomplete: boolean
  uncertainTurns: number
  transportRuns: number
}

const sumKnown = (reports: UsageReport[], field: keyof UsageReport): number | null => {
  const values = reports.map(report => report[field]).filter((value): value is number => typeof value === 'number')
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function reportedTotal(report: UsageReport): number | undefined {
  if (report.totalTokens !== undefined) return report.totalTokens
  if (report.inputTokens === undefined || report.outputTokens === undefined) return undefined
  // A provider may expose reasoning without explaining whether it is included
  // in output. Preserve that uncertainty rather than adding it a second time.
  if (report.reasoningTokens !== undefined && report.reasoningIncludedInOutput === undefined) return undefined
  return report.inputTokens + report.outputTokens + (report.reasoningIncludedInOutput === false ? report.reasoningTokens ?? 0 : 0)
}

/** Aggregate only host-scoped receipts. A trace can appear on a user message and
 * its partial/final answer; replaying those copies must not multiply usage.
 * Estimates remain separate from reported usage and never stand in for a bill. */
export function aggregateContextUsage(traces: Iterable<ContextTrace>, scope: UsageScope): UsageAggregate {
  const turns = new Map<string, { trace: ContextTrace; reports: UsageReport[]; planned: number }>()
  for (const trace of traces) {
    if (trace.identity.projectId !== scope.projectId || (scope.chatId !== undefined && trace.identity.chatId !== scope.chatId)) continue
    const key = JSON.stringify([trace.identity.projectId, trace.identity.chatId, trace.turnId])
    const previous = turns.get(key)
    const planned = Math.max(previous?.planned ?? 0, trace.invocations.length)
    const reports = restoreUsage(trace.usage, trace.invocations.length).reduce(updateUsage, previous?.reports ?? [])
    turns.set(key, { trace: previous && previous.trace.invocations.length > trace.invocations.length ? { ...trace, invocations: previous.trace.invocations } : trace, reports, planned })
  }
  let estimatedInput = 0, plannedInvocations = 0, incomplete = false, uncertainTurns = 0, transportRuns = 0
  const reports: UsageReport[] = []
  for (const turn of turns.values()) {
    plannedInvocations += turn.planned
    estimatedInput += turn.trace.invocations.reduce((sum, invocation) => sum + invocation.inputTokens, 0)
    if (turn.trace.state === 'uncertain' || turn.trace.state === 'sent') uncertainTurns += 1
    // A transport-run receipt covers its internal calls. If a transport also
    // exposes individual observations, its run total takes precedence for that
    // host invocation/attempt rather than counting both views of the same work.
    const runKeys = new Set(turn.reports.filter(report => report.scope === 'transport-run').map(report => `${report.invocation}:${report.attempt}`))
    const selected = turn.reports.filter(report => report.scope === 'transport-run' || !runKeys.has(`${report.invocation}:${report.attempt}`))
    transportRuns += selected.filter(report => report.scope === 'transport-run').length
    const covered = new Set(selected.map(report => report.invocation))
    if (covered.size < turn.planned || selected.some(report => report.inputTokens === undefined || report.outputTokens === undefined || reportedTotal(report) === undefined)) incomplete = true
    reports.push(...selected)
  }
  const totals = reports.map(reportedTotal)
  return {
    turns: turns.size, plannedInvocations, estimatedInput, receipts: reports.length,
    input: sumKnown(reports, 'inputTokens'), output: sumKnown(reports, 'outputTokens'),
    cached: sumKnown(reports, 'cachedInputTokens'), cacheWrites: sumKnown(reports, 'cacheWriteTokens'),
    reasoning: sumKnown(reports, 'reasoningTokens'), localDurationMs: sumKnown(reports, 'localDurationMs'),
    total: totals.length && totals.every((value): value is number => value !== undefined) ? totals.reduce((sum, value) => sum + value, 0) : null,
    incomplete: incomplete || uncertainTurns > 0, uncertainTurns, transportRuns,
  }
}
