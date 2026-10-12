import { estimateTokens } from '../budget'
import { validateProjectContext } from '../memory-schema'
import { redactContext } from '../policy'
import type { MemoryProviderDef, ProviderHost } from './types'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && redactContext(value) === value && [...value].every(character => character.charCodeAt(0) >= 32)
const count = (value: unknown): boolean => value === undefined || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e9
const keys = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).every(key => allowed.includes(key))

export function providerDescriptorIssues(value: unknown): string[] {
  try {
    const identifier = (value: unknown): boolean => id(value) && /^[a-zA-Z0-9_.:-]+$/.test(value)
    if (!object(value) || !keys(value, ['id', 'label', 'apiVersion', 'location', 'capabilities', 'dispatch']) || !identifier(value.id)
      || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 200 || redactContext(value.label) !== value.label
      || value.apiVersion !== 1 || typeof value.dispatch !== 'function') return ['INVALID_PROVIDER_DESCRIPTOR']
    const location = value.location
    if (!object(location) || !(location.kind === 'builtin' && keys(location, ['kind'])
      || location.kind === 'managed-local' && keys(location, ['kind', 'runtimeId']) && identifier(location.runtimeId)
      || location.kind === 'external' && keys(location, ['kind', 'connectionId']) && identifier(location.connectionId))) return ['INVALID_PROVIDER_LOCATION']
    const capabilities = value.capabilities
    const flags = ['lexicalSearch', 'semanticSearch', 'temporalSearch', 'readById', 'upsert', 'deleteBySource', 'deleteScope', 'export', 'reflection', 'usageReporting']
    return object(capabilities) && keys(capabilities, [...flags, 'scopeIsolation']) && flags.every(key => typeof capabilities[key] === 'boolean')
      && ['native', 'dedicated-instance', 'unsupported'].includes(String(capabilities.scopeIsolation)) ? [] : ['INVALID_PROVIDER_CAPABILITIES']
  } catch { return ['INVALID_PROVIDER_DESCRIPTOR'] }
}

/** Validate the native adapter boundary too: TypeScript types do not constrain
 * a contributed JavaScript adapter or a restored operation payload. The host
 * must additionally match writes to its committed canonical scope snapshot. */
export function providerRequestIssues(value: unknown, provider: MemoryProviderDef, host: Pick<ProviderHost, 'idempotencyKey' | 'maxTokens' | 'maxResults' | 'paidProcessingAllowed'>): string[] {
  try {
    if (providerDescriptorIssues(provider).length || !object(value)) return ['INVALID_REQUEST']
    const capabilities = provider.capabilities
    switch (value.operation) {
      case 'probe': return keys(value, ['operation']) ? [] : ['INVALID_REQUEST']
      case 'search': {
        if (!capabilities.lexicalSearch && !capabilities.semanticSearch) return ['UNSUPPORTED']
        if (!keys(value, ['operation', 'query', 'before', 'after']) || typeof value.query !== 'string' || !value.query.trim() || value.query.length > 4000 || redactContext(value.query) !== value.query) return ['INVALID_REQUEST']
        const validDate = (value: unknown): boolean => value === undefined || typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
        if (!validDate(value.before) || !validDate(value.after) || value.before && value.after && Date.parse(String(value.before)) < Date.parse(String(value.after))) return ['INVALID_REQUEST']
        return (value.before !== undefined || value.after !== undefined) && !capabilities.temporalSearch ? ['UNSUPPORTED'] : []
      }
      case 'read': return !capabilities.readById ? ['UNSUPPORTED'] : keys(value, ['operation', 'id']) && id(value.id) ? [] : ['INVALID_REQUEST']
      case 'upsert': {
        if (!capabilities.upsert) return ['UNSUPPORTED']
        if (!keys(value, ['operation', 'records']) || !Array.isArray(value.records) || !value.records.length || value.records.some(record => !object(record) || record.status !== 'active')) return ['INVALID_REQUEST']
        return providerResponseIssues({ status: 'ok', operationId: host.idempotencyKey, records: value.records, complete: true, usage: { estimated: true } }, host).length ? ['INVALID_REQUEST'] : []
      }
      case 'delete': return !capabilities.deleteBySource ? ['UNSUPPORTED'] : keys(value, ['operation', 'ids']) && Array.isArray(value.ids) && value.ids.length > 0 && value.ids.length <= 10 && value.ids.every(id) && new Set(value.ids).size === value.ids.length ? [] : ['INVALID_REQUEST']
      case 'delete-scope': return !capabilities.deleteScope ? ['UNSUPPORTED'] : keys(value, ['operation']) ? [] : ['INVALID_REQUEST']
      case 'export': return !capabilities.export ? ['UNSUPPORTED'] : keys(value, ['operation']) ? [] : ['INVALID_REQUEST']
      case 'reflect': return !capabilities.reflection ? ['UNSUPPORTED'] : !host.paidProcessingAllowed ? ['POLICY_REFUSED'] : keys(value, ['operation', 'query']) && typeof value.query === 'string' && Boolean(value.query.trim()) && value.query.length <= 4000 && redactContext(value.query) === value.query ? [] : ['INVALID_REQUEST']
      default: return ['INVALID_REQUEST']
    }
  } catch { return ['INVALID_REQUEST'] }
}

/** Metadata-only diagnostics for the SDK boundary and conformance fixtures.
 * Passing this check establishes shape/bounds, never scope certification or
 * permission to ingest records. Canonical ownership remains with the host. */
export function providerResponseIssues(value: unknown, host: Pick<ProviderHost, 'idempotencyKey' | 'maxTokens' | 'maxResults'>): string[] {
  try {
    if (!object(value) || value.operationId !== host.idempotencyKey) return ['INVALID_OPERATION_RECEIPT']
    if (value.status === 'failed') {
      return keys(value, ['status', 'operationId', 'code', 'recovery']) && ['UNSUPPORTED', 'PROVIDER_OFFLINE', 'POLICY_REFUSED', 'INVALID_RESPONSE', 'BUDGET_LIMIT'].includes(String(value.code))
        && typeof value.recovery === 'string' && value.recovery.length <= 1000 && redactContext(value.recovery) === value.recovery ? [] : ['INVALID_FAILURE']
    }
    if (!['ok', 'pending'].includes(String(value.status)) || !keys(value, ['status', 'operationId', 'records', 'evidence', 'usage', 'complete']) || typeof value.complete !== 'boolean') return ['INVALID_RESULT_SHAPE']
    if (!Number.isSafeInteger(host.maxResults) || host.maxResults < 1 || !Number.isSafeInteger(host.maxTokens) || host.maxTokens < 0) return ['INVALID_LIMITS']
    const limit = Math.min(10, host.maxResults)
    if (!Array.isArray(value.records) || value.records.length > limit || value.evidence !== undefined && (!Array.isArray(value.evidence) || value.evidence.length > limit)) return ['RESULT_COUNT_LIMIT']
    if (value.records.length + ((value.evidence ?? []) as unknown[]).length > limit) return ['RESULT_COUNT_LIMIT']
    const placeholder = '00000000-0000-4000-8000-000000000001'
    const recordIds = new Set<string>()
    for (const record of value.records) {
      if (!object(record) || !['global', 'project'].includes(String(record.scope)) || record.scope === 'global' && record.projectId !== null
        || record.scope === 'project' && (typeof record.projectId !== 'string' || !/^[a-f0-9-]{36}$/i.test(record.projectId))
        || record.pinned !== undefined && typeof record.pinned !== 'boolean'
        || !keys(record, ['id', 'revision', 'scope', 'projectId', 'category', 'statement', 'evidence', 'assertion', 'createdAt', 'updatedAt', 'status', 'supersedes', 'lineage', 'pinned', 'editedAt'])
        || validateProjectContext({ version: 1, revision: 0, memories: [{ ...record, scope: 'project', projectId: placeholder }] }, placeholder).memories.length !== 1
        || recordIds.has(String(record.id))) return ['INVALID_CANONICAL_RECORD']
      recordIds.add(String(record.id))
    }
    const evidenceIds = new Set<string>()
    for (const evidence of (value.evidence ?? []) as unknown[]) {
      if (!object(evidence) || !keys(evidence, ['sourceId', 'canonicalId', 'revision', 'text', 'observedAt', 'authority', 'sourceIds']) || !id(evidence.sourceId)
        || evidence.canonicalId !== undefined && !id(evidence.canonicalId) || evidence.revision !== undefined && (!count(evidence.revision) || evidence.revision === 0)
        || typeof evidence.text !== 'string' || evidence.text.length > 32000 || redactContext(evidence.text) !== evidence.text || evidence.authority !== 'provider-derived'
        || evidence.observedAt !== undefined && (typeof evidence.observedAt !== 'string' || evidence.observedAt.length > 64 || !Number.isFinite(Date.parse(evidence.observedAt)))
        || evidence.sourceIds !== undefined && (!Array.isArray(evidence.sourceIds) || evidence.sourceIds.length > 32 || !evidence.sourceIds.every(id))
        || evidenceIds.has(String(evidence.sourceId))) return ['INVALID_EVIDENCE']
      evidenceIds.add(String(evidence.sourceId))
    }
    const usage = value.usage
    if (!object(usage) || !keys(usage, ['inputTokens', 'outputTokens', 'cost', 'currency', 'estimated']) || typeof usage.estimated !== 'boolean'
      || usage.currency !== undefined && usage.currency !== 'USD'
      || !count(usage.inputTokens) || !count(usage.outputTokens) || usage.cost !== undefined && (typeof usage.cost !== 'number' || !Number.isFinite(usage.cost) || usage.cost < 0 || usage.cost > 1e6 || usage.currency !== 'USD')) return ['INVALID_USAGE']
    return estimateTokens(value) <= Math.min(8000, host.maxTokens) ? [] : ['RESULT_TOKEN_LIMIT']
  } catch { return ['INVALID_RESPONSE'] }
}
