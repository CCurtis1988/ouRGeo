import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'
import { MemoryRuntime } from '../runtimes'
import { bank, boundedEvidence, failed, object, providerQuery } from './shared'
import { estimateTokens } from '../../../../src/lib/context/budget'
import { redactContext } from '../../../../src/lib/context/policy'
import type { CanonicalScopeSnapshot } from '../../../../src/lib/context/providers/types'

export interface CanonicalSnapshot extends CanonicalScopeSnapshot {
  namespace: string
}
export interface CanonicalSnapshotPort {
  /** Host-owned, committed canonical records for exactly this resolved bank.
   * No endpoint or model response can supply this snapshot or its generation. */
  snapshot: (namespace: string, signal: AbortSignal) => Promise<CanonicalSnapshot>
  current: (snapshot: CanonicalSnapshot, signal: AbortSignal) => Promise<boolean>
}

/** Integration is separate from certification and installation. Replacement
 * snapshots are host-owned maintenance, never a model tool. A read-only caller
 * supplies no canonical port and cannot accidentally enable writes. */
export function createManagedMnemosyne(runtimeId: string, runtime: MemoryRuntime, canonical?: CanonicalSnapshotPort): MemoryProviderDef {
  return { id: 'mnemosyne-managed', label: 'Mnemosyne on this device', apiVersion: 1, location: { kind: 'managed-local', runtimeId },
    capabilities: { lexicalSearch: true, semanticSearch: false, temporalSearch: false, readById: true, upsert: Boolean(canonical),
      deleteBySource: Boolean(canonical), deleteScope: false, export: false, reflection: false, usageReporting: false, scopeIsolation: 'dedicated-instance' },
    dispatch: async (request, host) => {
      try {
        bank(host)
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(host.namespace)) throw new Error('POLICY_REFUSED')
        if (request.operation === 'upsert' || request.operation === 'delete') {
          if (!canonical) throw new Error('UNSUPPORTED')
          const snapshot = await canonical.snapshot(host.namespace, host.signal)
          bank(host)
          if (snapshot.namespace !== host.namespace || !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1
            || !Array.isArray(snapshot.records) || snapshot.records.length > 10000 || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) throw new Error('POLICY_REFUSED')
          const scope = snapshot.records[0]?.scope, project = snapshot.records[0]?.projectId
          for (const record of snapshot.records) {
            if (!record || record.status !== 'active' || record.scope !== scope || record.projectId !== project || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.id)
              || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.statement !== 'string' || !record.statement.trim() || record.statement.length > 4000
              || redactContext(record.statement) !== record.statement || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('POLICY_REFUSED')
          }
          let selected = request.operation === 'upsert' ? request.records : []
          if (request.operation === 'upsert' && (!selected.length || selected.length > Math.min(10, host.maxResults)
            || selected.some(record => !snapshot.records.some(saved => saved.id === record.id && saved.revision === record.revision && saved.scope === record.scope && saved.projectId === record.projectId && saved.statement === record.statement)))) throw new Error('POLICY_REFUSED')
          if (request.operation === 'delete' && (!request.ids.length || request.ids.length > 10 || request.ids.some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) || snapshot.records.some(record => record.id === id)))) throw new Error('POLICY_REFUSED')
          selected = selected.map(record => snapshot.records.find(saved => saved.id === record.id)!)
          if (estimateTokens({ records: selected, operationId: host.idempotencyKey, status: 'ok', complete: true, usage: { estimated: true } }) > Math.min(8000, host.maxTokens)) throw new Error('BUDGET_LIMIT')
          if (!await canonical.current(snapshot, host.signal)) throw new Error('POLICY_REFUSED')
          bank(host)
          const receipt = object(await runtime.request({ operation: 'replace', namespace: host.namespace, generation: snapshot.generation,
            records: snapshot.records.map(record => ({ id: record.id, revision: record.revision, text: record.statement, updatedAt: record.updatedAt })) }, host))
          bank(host)
          if (!await canonical.current(snapshot, host.signal)) throw new Error('POLICY_REFUSED')
          bank(host)
          if (receipt.generation !== snapshot.generation || receipt.count !== snapshot.records.length || typeof receipt.idempotent !== 'boolean') throw new Error('INVALID_RESPONSE')
          // Receipts use locally owned canonical records; arbitrary provider
          // prose can never become the authoritative copy of a user's memory.
          return { status: 'ok', operationId: host.idempotencyKey, records: selected, complete: true, usage: { estimated: true } }
        }
        let payload: Record<string, unknown>
        switch (request.operation) {
          case 'probe': payload = { operation: 'probe' }; break
          case 'search':
            if (request.before || request.after) throw new Error('UNSUPPORTED')
            payload = { operation: 'search', query: providerQuery(request.query), limit: Math.min(10, host.maxResults) }; break
          case 'read':
            if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.id)) throw new Error('POLICY_REFUSED')
            payload = { operation: 'read', sourceId: request.id }; break
          default: throw new Error('UNSUPPORTED')
        }
        const data = object(await runtime.request({ ...payload, namespace: host.namespace }, host))
        if (!Array.isArray(data.evidence) || !Number.isSafeInteger(data.generation) || data.complete !== true) throw new Error('INVALID_RESPONSE')
        const evidence = data.evidence.map(value => {
          const item = object(value)
          if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.revision !== 'number' || typeof item.updatedAt !== 'string') throw new Error('INVALID_RESPONSE')
          return { sourceId: item.id, canonicalId: item.id, text: item.text, revision: item.revision, observedAt: item.updatedAt, authority: 'provider-derived' as const }
        })
        if (request.operation === 'probe' && evidence.length || request.operation === 'read' && evidence.some(item => item.sourceId !== request.id)) throw new Error('INVALID_RESPONSE')
        if (canonical && request.operation !== 'probe') {
          const snapshot = await canonical.snapshot(host.namespace, host.signal)
          bank(host)
          if (snapshot.namespace !== host.namespace || data.generation !== snapshot.generation
            || evidence.some(item => !snapshot.records.some(record => record.status === 'active' && record.id === item.canonicalId && record.revision === item.revision && record.statement === item.text && record.updatedAt === item.observedAt))
            || !await canonical.current(snapshot, host.signal)) throw new Error('INVALID_RESPONSE')
          bank(host)
        }
        return { status: 'ok', operationId: host.idempotencyKey, records: [], ...boundedEvidence(evidence, host), usage: { estimated: true } }
      } catch (error) { return failed(host, error) }
    },
  }
}
