import { boundedText, estimateTokens } from '../../../../src/lib/context/budget'
import { redactContext } from '../../../../src/lib/context/policy'
import type { ProviderEvidence, ProviderHost, ProviderResult } from '../../../../src/lib/context/providers/types'

export const EMPTY_USAGE = { estimated: true } as const
export function providerQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('POLICY_REFUSED')
  return redactContext(value).slice(0, 512)
}
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_RESPONSE')
  return input as Record<string, unknown>
}
export function bank(host: ProviderHost): string {
  host.signal.throwIfAborted()
  if (!host.authorised() || !/^[a-zA-Z0-9_-]{1,64}$/.test(host.namespace) || host.namespace === 'default') throw new Error('POLICY_REFUSED')
  if (!Number.isSafeInteger(host.maxTokens) || host.maxTokens < 0 || !Number.isSafeInteger(host.maxResults) || host.maxResults < 1 || !Number.isFinite(host.timeoutMs)) throw new Error('BUDGET_LIMIT')
  return encodeURIComponent(host.namespace)
}
export function failed(host: ProviderHost, error: unknown): ProviderResult {
  const message = String(error)
  const code = (['POLICY_REFUSED', 'INVALID_RESPONSE', 'BUDGET_LIMIT', 'UNSUPPORTED'] as const).find(code => message.includes(code)) ?? 'PROVIDER_OFFLINE'
  return { status: 'failed', operationId: host.idempotencyKey, code, recovery: code === 'POLICY_REFUSED' ? 'Enable the required processing policy in connection settings, or use built-in memory.' : 'Use the authorised local canonical records; inspect connection diagnostics before retrying.' }
}
export function boundedEvidence(items: ProviderEvidence[], host: ProviderHost): { evidence: ProviderEvidence[]; complete: boolean } {
  let remaining = Math.max(0, Math.min(host.maxTokens, 8000) - 32)
  const evidence: ProviderEvidence[] = []
  let complete = items.length <= host.maxResults
  for (const item of items.slice(0, Math.min(10, host.maxResults))) {
    if (remaining < 100) { complete = false; break }
    const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && redactContext(value) === value && [...value].every(character => character.charCodeAt(0) >= 32)
    if (!id(item.sourceId) || typeof item.text !== 'string'
      || (item.canonicalId !== undefined && !id(item.canonicalId))
      || (item.revision !== undefined && (!Number.isSafeInteger(item.revision) || item.revision < 1))
      || (item.observedAt !== undefined && (typeof item.observedAt !== 'string' || item.observedAt.length > 64 || !Number.isFinite(Date.parse(item.observedAt))))
      || (item.sourceIds !== undefined && (!Array.isArray(item.sourceIds) || item.sourceIds.length > 32 || !item.sourceIds.every(id)))) throw new Error('INVALID_RESPONSE')
    const metadata = { sourceId: item.sourceId.slice(0, 128), authority: 'provider-derived' as const, ...(item.canonicalId ? { canonicalId: item.canonicalId.slice(0, 128) } : {}), ...(item.revision !== undefined ? { revision: item.revision } : {}), ...(item.observedAt ? { observedAt: item.observedAt.slice(0, 64) } : {}), ...(item.sourceIds ? { sourceIds: item.sourceIds.slice(0, 32).map(id => id.slice(0, 128)) } : {}) }
    const overhead = estimateTokens({ ...metadata, text: '' })
    if (overhead + 32 > remaining) { complete = false; break }
    const page = boundedText(redactContext(item.text), remaining - overhead - 32)
    const selected = { ...metadata, text: page.text }
    evidence.push(selected)
    remaining -= estimateTokens(selected)
    complete &&= page.complete
  }
  return { evidence, complete }
}
