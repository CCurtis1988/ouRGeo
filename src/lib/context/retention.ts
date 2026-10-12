import type { ContextTrace, MemoryRecord } from './types'

export const DAY_MS = 86_400_000
export const TRACE_RETENTION_MS = 7 * DAY_MS
let configuredTraceDays = 7
export function traceRetentionDays(days?: number): number {
  if (days !== undefined && Number.isSafeInteger(days) && days >= 1 && days <= 7) configuredTraceDays = days
  return configuredTraceDays
}

/** Age can request a review, never rewrite an explicit user preference. An
 * expiry is a separate, deliberately recorded validity boundary. */
export function memoryRetention(record: MemoryRecord, now = Date.now()): { expired: boolean; review: boolean } {
  const expiry = record.expiresAt ? Date.parse(record.expiresAt) : NaN
  return {
    expired: (Number.isFinite(expiry) && expiry <= now)
      || (record.status === 'candidate' && now - Date.parse(record.candidateSince ?? record.createdAt) >= 30 * DAY_MS),
    review: record.status === 'active' && record.category === 'preference' && record.assertion === 'inferred'
      && now - Date.parse(record.lastSupportedAt ?? record.editedAt ?? record.createdAt) >= 180 * DAY_MS,
  }
}

export function traceExpired(trace: ContextTrace, fallback: number, now = Date.now(), days = traceRetentionDays()): boolean {
  const timestamp = trace.recordedAt ?? fallback
  const limit = Number.isSafeInteger(days) && days >= 1 && days <= 7 ? days * DAY_MS : TRACE_RETENTION_MS
  return !Number.isFinite(timestamp) || timestamp > now || now - timestamp >= limit
}

/** Usage receipts have a different lifetime from diagnostic evidence. Keep
 * counters for totals without retaining old excerpts as an archival copy. */
export function accountingOnlyTrace(trace: ContextTrace): ContextTrace {
  return { turnId: trace.turnId, identity: trace.identity, state: trace.state, recordedAt: trace.recordedAt,
    selected: [], excluded: [], target: '', evidenceExpired: true, retrievalCalls: trace.retrievalCalls,
    returnedTokens: trace.returnedTokens, usage: trace.usage,
    invocations: trace.invocations.map(call => ({ inputTokens: call.inputTokens, window: call.window, estimated: true })) }
}
