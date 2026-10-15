import type { MemoryProviderDef, ProviderHost } from '../../../../src/lib/context/providers/types'
import type { JsonTransport } from './transport'
import { bank, boundedEvidence, EMPTY_USAGE, failed, object, providerQuery } from './shared'

export const MNEMOSYNE_PROFILE = {
  repository: 'mnemosyne-oss/mnemosyne', release: 'v0.7.4',
  commit: 'e871f39480b9b9156faa4396162f7ec1f3b11525',
  automaticWritesCertified: false,
} as const

export type McpCall = (name: 'mnemosyne_stats' | 'mnemosyne_recall' | 'mnemosyne_get' | 'ourgeo_mnemosyne_snapshot', arguments_: Record<string, unknown>, host: ProviderHost) => Promise<unknown>
export type MnemosyneProcessing = 'unverified' | 'verified-local' | 'approved-external'

/** Read-only until stable canonical-ID mappings, retry behaviour and derivative
 * deletion pass the deployment conformance gate. Unsupported writes fail loudly. */
export function createMnemosyneProvider(connectionId: string, call: McpCall, processing: MnemosyneProcessing = 'unverified'): MemoryProviderDef {
  return { id: 'mnemosyne', label: 'Mnemosyne', apiVersion: 1, location: { kind: 'external', connectionId },
    capabilities: { lexicalSearch: processing !== 'unverified', semanticSearch: false, temporalSearch: false, readById: true, upsert: false, deleteBySource: false, deleteScope: false, export: false, reflection: false, usageReporting: false, scopeIsolation: 'dedicated-instance' },
    dispatch: async (operation, host) => {
      try {
        const namespace = decodeURIComponent(bank(host))
        const ok = () => ({ status: 'ok' as const, operationId: host.idempotencyKey, records: [], usage: EMPTY_USAGE, complete: true })
        switch (operation.operation) {
          case 'probe': {
            const data = object(await call('mnemosyne_stats', { bank: namespace }, host))
            if (data.error) throw new Error('INVALID_RESPONSE')
            return ok()
          }
          case 'search': {
            // In this pin, BeamMemory.recall still computes embeddings when
            // vec_weight=0. Scoring weights are not a processing permission.
            // Only a host-certified local profile or deliberately authorised
            // external processing may send a query into that path.
            if (processing === 'unverified' || (processing === 'approved-external' && !host.paidProcessingAllowed)) throw new Error('POLICY_REFUSED')
            if (operation.before || operation.after) throw new Error('UNSUPPORTED')
            const data = object(await call('mnemosyne_recall', { bank: namespace, query: providerQuery(operation.query), limit: Math.min(10, host.maxResults), vec_weight: 0, fts_weight: 1, importance_weight: 0, temporal_weight: 0, explain: false }, host))
            if (data.status !== 'ok' || data.bank !== namespace || !Array.isArray(data.results)) throw new Error('INVALID_RESPONSE')
            const evidence = data.results.map(value => {
              const item = object(value)
              if (typeof item.id !== 'string' || typeof item.content !== 'string') throw new Error('INVALID_RESPONSE')
              return { sourceId: item.id, text: item.content, authority: 'provider-derived' as const, ...(typeof item.created_at === 'string' ? { observedAt: item.created_at } : {}) }
            })
            return { ...ok(), ...boundedEvidence(evidence, host) }
          }
          case 'read': {
            if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operation.id)) throw new Error('POLICY_REFUSED')
            const data = object(await call('mnemosyne_get', { bank: namespace, memory_id: operation.id }, host))
            if (data.status !== 'ok') throw new Error('INVALID_RESPONSE')
            const memory = object(data.memory)
            if (memory.id !== operation.id || typeof memory.content !== 'string') throw new Error('INVALID_RESPONSE')
            return { ...ok(), ...boundedEvidence([{ sourceId: memory.id, text: memory.content, authority: 'provider-derived' }], host) }
          }
          default: throw new Error('UNSUPPORTED')
        }
      } catch (error) { return failed(host, error) }
    },
  }
}

/** Streamable HTTP only. Host-owned sessions negotiate the protocol and expose
 * no roots, sampling or elicitation; server instructions never become prompts. */
export function createMnemosyneMcpCall(request: JsonTransport, ownedSnapshots = false): McpCall {
  let counter = 0
  let session: string | undefined
  let version = '2025-11-25'
  let initialising: Promise<void> | undefined
  let binding = ''
  return async (name, arguments_, host) => {
    if (!['mnemosyne_stats', 'mnemosyne_recall', 'mnemosyne_get', ...(ownedSnapshots ? ['ourgeo_mnemosyne_snapshot'] : [])].includes(name) || arguments_.bank !== host.namespace) throw new Error('POLICY_REFUSED')
    const key = `${bank(host)}:${host.policyRevision}`
    if (binding !== key) { session = undefined; initialising = undefined; binding = key }
    if (!initialising) initialising = (async () => {
      const id = ++counter
      const data = object(await request('', 'POST', { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ourgeo-context', version: '1' } } }, host, {}, headers => {
        const value = headers.get('Mcp-Session-Id')
        if (value && !/^[\x21-\x7E]{1,1024}$/.test(value)) throw new Error('INVALID_RESPONSE')
        session = value ?? undefined
      }))
      if (binding !== key || data.id !== id || data.error) throw new Error('INVALID_RESPONSE')
      const result = object(data.result)
      if (!['2025-03-26', '2025-06-18', '2025-11-25'].includes(String(result.protocolVersion))) throw new Error('UNSUPPORTED')
      version = String(result.protocolVersion)
      await request('', 'POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, host, { 'MCP-Protocol-Version': version, ...(session ? { 'Mcp-Session-Id': session } : {}) })
    })().catch(error => { if (binding === key) { initialising = undefined; session = undefined }; throw error })
    await initialising
    if (binding !== key) throw new Error('POLICY_REFUSED')
    const id = ++counter
    const data = object(await request('', 'POST', { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: arguments_ } }, host, { 'MCP-Protocol-Version': version, ...(session ? { 'Mcp-Session-Id': session } : {}) }))
    if (data.id !== id || data.error) throw new Error('INVALID_RESPONSE')
    const result = object(data.result)
    if (result.isError) throw new Error('INVALID_RESPONSE')
    if (result.structuredContent) return object(result.structuredContent)
    if (!Array.isArray(result.content)) throw new Error('INVALID_RESPONSE')
    const text = result.content.map(value => object(value)).filter(item => item.type === 'text' && typeof item.text === 'string').map(item => String(item.text)).join('\n')
    return object(JSON.parse(text))
  }
}
