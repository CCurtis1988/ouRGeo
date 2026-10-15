import type { MemoryProviderDef, ProviderEvidence } from '../../../../src/lib/context/providers/types'
import type { JsonTransport } from './transport'
import { ProviderHttpError } from './transport'
import { bank, boundedEvidence, EMPTY_USAGE, failed, object, providerQuery } from './shared'
import { redactContext } from '../../../../src/lib/context/policy'

export const HINDSIGHT_PROFILE = {
  repository: 'vectorize-io/hindsight', release: 'v0.10.2',
  commit: '5fc4ce20917b916240cef27c212c387a177f115b',
  automaticWritesCertified: false,
} as const

/** API mapping is pinned to the immutable OpenAPI document. Certification of
 * a deployment's isolation/deletion is separate from a successful health call. */
export function createHindsightProvider(connectionId: string, request: JsonTransport, processing: 'approved-external' | 'verified-local-chunks' = 'approved-external'): MemoryProviderDef {
  return { id: 'hindsight', label: 'Hindsight', apiVersion: 1, location: { kind: 'external', connectionId },
    capabilities: { lexicalSearch: true, semanticSearch: processing !== 'verified-local-chunks', temporalSearch: true, readById: true, upsert: true, deleteBySource: true, deleteScope: false, export: false, reflection: processing !== 'verified-local-chunks', usageReporting: true, scopeIsolation: 'native' },
    dispatch: async (operation, host) => {
      try {
        const prefix = `/v1/default/banks/${bank(host)}`
        const ok = (evidence: ProviderEvidence[] = []) => ({ status: 'ok' as const, operationId: host.idempotencyKey, records: [], usage: EMPTY_USAGE, ...boundedEvidence(evidence, host) })
        switch (operation.operation) {
          case 'probe': {
            const health = object(await request('/health', 'GET', undefined, host))
            if (!['ok', 'healthy'].includes(String(health.status))) throw new Error('INVALID_RESPONSE')
            return ok()
          }
          case 'search': {
            // Recall may use a configured remote embedder/reranker. Storage
            // being local does not supply consent for that processing.
            if (processing !== 'verified-local-chunks' && !host.paidProcessingAllowed) throw new Error('POLICY_REFUSED')
            if ((operation.before && !Number.isFinite(Date.parse(operation.before))) || (operation.after && !Number.isFinite(Date.parse(operation.after)))) throw new Error('POLICY_REFUSED')
            const data = object(await request(`${prefix}/memories/recall`, 'POST', { query: providerQuery(operation.query), budget: 'low', max_tokens: Math.min(8000, host.maxTokens), trace: false,
              ...(operation.before || operation.after ? { temporal_window: { start: operation.after ?? '1900-01-01T00:00:00Z', end: operation.before ?? '9999-12-31T23:59:59Z' } } : {}),
            }, host))
            if (!Array.isArray(data.results)) throw new Error('INVALID_RESPONSE')
            const limit = processing === 'verified-local-chunks' ? Math.min(10, host.maxResults) : data.results.length
            const results = data.results.slice(0, limit).map(value => {
              const item = object(value)
              if (typeof item.id !== 'string' || typeof item.text !== 'string') throw new Error('INVALID_RESPONSE')
              return { sourceId: item.id, ...(typeof item.document_id === 'string' ? { canonicalId: item.document_id } : {}), text: item.text, authority: 'provider-derived' as const,
                ...(typeof item.mentioned_at === 'string' ? { observedAt: item.mentioned_at } : {}),
              }
            })
            if (processing === 'verified-local-chunks') for (const result of results) {
              if (!result.canonicalId || !/^[a-f0-9-]{36}$/i.test(result.canonicalId)) throw new Error('INVALID_RESPONSE')
              const document = object(await request(`${prefix}/documents/${encodeURIComponent(result.canonicalId)}`, 'GET', undefined, host))
              const metadata = document.document_metadata ? object(document.document_metadata) : null
              if (document.id !== result.canonicalId || document.bank_id !== host.namespace || metadata?.ourgeo_id !== result.canonicalId) throw new Error('INVALID_RESPONSE')
              if (typeof metadata.ourgeo_revision !== 'string' || !/^[1-9][0-9]{0,9}$/.test(metadata.ourgeo_revision) || typeof document.original_text !== 'string') throw new Error('INVALID_RESPONSE')
              Object.assign(result, { revision: Number(metadata.ourgeo_revision), text: document.original_text })
              // In chunks-only mode mentioned_at is ingestion time. The host's
              // canonical timestamp is explicit document metadata, so date
              // filtering cannot quietly use today's ingestion date instead.
              result.observedAt = typeof metadata.ourgeo_updated_at === 'string' && Number.isFinite(Date.parse(metadata.ourgeo_updated_at)) ? metadata.ourgeo_updated_at : undefined
            }
            // Hindsight's temporal window ranks a retrieval arm; it does not
            // filter other arms. A date-filtered read must enforce that here.
            const filtered = results.filter(item => (!operation.before && !operation.after) || (item.observedAt && Number.isFinite(Date.parse(item.observedAt))
              && (!operation.before || Date.parse(item.observedAt) <= Date.parse(operation.before))
              && (!operation.after || Date.parse(item.observedAt) >= Date.parse(operation.after))))
            const selected = ok(filtered)
            // Intentionally out-of-window evidence is ineligible, not omitted
            // eligible content. Completeness is the bounded filtered envelope.
            return { ...selected, complete: selected.complete && data.results.length <= limit, usage: usage(data.usage) }
          }
          case 'read': {
            if (!/^[a-f0-9-]{36}$/i.test(operation.id)) throw new Error('POLICY_REFUSED')
            let data: unknown
            try { data = await request(`${prefix}/documents/${encodeURIComponent(operation.id)}`, 'GET', undefined, host) }
            catch (error) { if (error instanceof ProviderHttpError && error.status === 404) return ok(); throw error }
            const doc = object(data)
            if (doc.id !== operation.id || doc.bank_id !== host.namespace || typeof doc.original_text !== 'string') throw new Error('INVALID_RESPONSE')
            const metadata = doc.document_metadata ? object(doc.document_metadata) : null
            const revision = metadata?.ourgeo_id === operation.id && typeof metadata.ourgeo_revision === 'string' && /^[1-9][0-9]{0,9}$/.test(metadata.ourgeo_revision) ? Number(metadata.ourgeo_revision) : undefined
            return ok([{ sourceId: doc.id, canonicalId: operation.id, ...(revision ? { revision } : {}), text: doc.original_text, authority: 'provider-derived' }])
          }
          case 'upsert': {
            if (processing !== 'verified-local-chunks' && !host.paidProcessingAllowed) throw new Error('POLICY_REFUSED')
            if (!operation.records.length || operation.records.length > Math.min(10, host.maxResults)) throw new Error('BUDGET_LIMIT')
            if (operation.records.some(record => !/^[a-f0-9-]{36}$/i.test(record.id) || typeof record.statement !== 'string' || record.statement.length > 4000 || !record.statement.trim() || redactContext(record.statement) !== record.statement || !Number.isSafeInteger(record.revision) || record.revision < 1 || !Number.isFinite(Date.parse(record.updatedAt)))) throw new Error('POLICY_REFUSED')
            // Synchronous document replacement is retryable by canonical ID.
            // The asynchronous operation_id API has distinct semantics and is
            // not used as a promise of synchronous billing idempotence.
            const data = object(await request(`${prefix}/memories`, 'POST', { items: operation.records.map(record => ({ content: record.statement, document_id: record.id, timestamp: record.updatedAt, metadata: { ourgeo_id: record.id, ourgeo_revision: String(record.revision), ourgeo_updated_at: record.updatedAt } })), async: false }, host))
            if (data.success !== true || data.items_count !== operation.records.length) throw new Error('INVALID_RESPONSE')
            if (processing === 'verified-local-chunks') await purgeLocalRetainHistory(prefix, request, host)
            return { ...ok(), records: operation.records, usage: usage(data.usage) }
          }
          case 'delete': {
            if (operation.ids.length > 10) throw new Error('BUDGET_LIMIT')
            if (processing === 'verified-local-chunks') await purgeLocalRetainHistory(prefix, request, host)
            for (const id of operation.ids) {
              if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('POLICY_REFUSED')
              let value: unknown
              try { value = await request(`${prefix}/documents/${encodeURIComponent(id)}`, 'DELETE', undefined, host) }
              catch (error) { if (error instanceof ProviderHttpError && error.status === 404) continue; throw error }
              const data = object(value)
              if (data.success !== true || data.document_id !== id) throw new Error('INVALID_RESPONSE')
            }
            return ok()
          }
          case 'reflect': {
            if (processing === 'verified-local-chunks') throw new Error('UNSUPPORTED')
            if (!host.paidProcessingAllowed) throw new Error('POLICY_REFUSED')
            const data = object(await request(`${prefix}/reflect`, 'POST', { query: providerQuery(operation.query), budget: 'low', max_tokens: Math.min(2000, host.maxTokens), include: { facts: {} } }, host))
            if (typeof data.text !== 'string') throw new Error('INVALID_RESPONSE')
            const based = data.based_on ? object(data.based_on) : null
            const facts: unknown[] = based && Array.isArray(based.memories) ? based.memories : []
            const sourceIds = facts.slice(0, 32).map(value => {
              const id = object(value).id
              if (typeof id !== 'string' || !id) throw new Error('INVALID_RESPONSE')
              return id
            })
            const selected = ok([{ sourceId: `reflection:${host.idempotencyKey}`, text: data.text, authority: 'provider-derived', sourceIds }])
            return { ...selected, complete: selected.complete && facts.length <= 32, usage: usage(data.usage) }
          }
          default: throw new Error('UNSUPPORTED')
        }
      } catch (error) { return failed(host, error) }
    },
  }
}

/** The chunks-only experimental profile disables copied ingestion history.
 * Hindsight retains task payloads independently of documents. Remove terminal
 * retain receipts in this host-owned namespace, never documents or other task
 * types. Active retains block deletion to prevent late source resurrection.
 * This does not erase PostgreSQL dead pages/WAL and issues no qualification. */
async function purgeLocalRetainHistory(prefix: string, request: JsonTransport, host: Parameters<JsonTransport>[3]): Promise<void> {
  const list = object(await request(`${prefix}/operations?type=batch_retain&limit=100&offset=0`, 'GET', undefined, host))
  if (list.bank_id !== host.namespace || !Number.isSafeInteger(list.total) || Number(list.total) < 0 || Number(list.total) > 100 || !Array.isArray(list.operations) || list.operations.length !== list.total) throw new Error('BUDGET_LIMIT')
  for (const value of list.operations) {
    const item = object(value)
    if (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(item.id) || item.task_type !== 'batch_retain') throw new Error('INVALID_RESPONSE')
    // The parent batch may still say pending until the status endpoint rolls
    // up its terminal children. Cancellation alone is cooperative and cannot
    // prove that an in-flight worker has stopped writing.
    const status = object(await request(`${prefix}/operations/${item.id}`, 'GET', undefined, host))
    if (status.operation_id !== item.id || !['completed', 'failed'].includes(String(status.status))) throw new Error('POLICY_REFUSED')
    let result: unknown
    try { result = await request(`${prefix}/operations/${item.id}/delete`, 'DELETE', undefined, host) }
    catch (error) { if (error instanceof ProviderHttpError && error.status === 404) continue; throw error }
    const receipt = object(result)
    if (receipt.success !== true || receipt.operation_id !== item.id) throw new Error('INVALID_RESPONSE')
  }
}

function usage(input: unknown): { inputTokens?: number; outputTokens?: number; estimated: boolean } {
  if (!input || typeof input !== 'object') return EMPTY_USAGE
  const value = object(input)
  const valid = (tokens: unknown): tokens is number => Number.isSafeInteger(tokens) && Number(tokens) >= 0
  return { ...(valid(value.input_tokens) ? { inputTokens: value.input_tokens } : {}), ...(valid(value.output_tokens) ? { outputTokens: value.output_tokens } : {}), estimated: !(valid(value.input_tokens) && valid(value.output_tokens)) }
}
