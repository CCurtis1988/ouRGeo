import type { MemoryRecord } from '../types'

export interface CanonicalScopeSnapshot { generation: number; records: MemoryRecord[] }

export type ProviderLocation = { kind: 'builtin' } | { kind: 'managed-local'; runtimeId: string } | { kind: 'external'; connectionId: string }
export interface ProviderCapabilities {
  lexicalSearch: boolean
  semanticSearch: boolean
  temporalSearch: boolean
  readById: boolean
  upsert: boolean
  deleteBySource: boolean
  deleteScope: boolean
  export: boolean
  reflection: boolean
  usageReporting: boolean
  scopeIsolation: 'native' | 'dedicated-instance' | 'unsupported'
}
export type ProviderRequest =
  | { operation: 'probe' }
  | { operation: 'search'; query: string; before?: string; after?: string }
  | { operation: 'read'; id: string }
  | { operation: 'upsert'; records: MemoryRecord[] }
  | { operation: 'delete'; ids: string[] }
  | { operation: 'export' }
  | { operation: 'reflect'; query: string }

export interface ProviderHost {
  namespace: string
  signal: AbortSignal
  timeoutMs: number
  policyRevision: number
  maxTokens: number
  maxResults: number
  idempotencyKey: string
  paidProcessingAllowed: boolean
  authorised: () => boolean
}
export interface ProviderEvidence {
  sourceId: string
  canonicalId?: string
  revision?: number
  text: string
  observedAt?: string
  authority: 'provider-derived'
  sourceIds?: string[]
}
export type ProviderResult =
  | { status: 'ok' | 'pending'; operationId: string; records: MemoryRecord[]; evidence?: ProviderEvidence[]; usage: { inputTokens?: number; outputTokens?: number; cost?: number; estimated: boolean }; complete: boolean }
  | { status: 'failed'; operationId: string; code: 'UNSUPPORTED' | 'PROVIDER_OFFLINE' | 'POLICY_REFUSED' | 'INVALID_RESPONSE' | 'BUDGET_LIMIT'; recovery: string }

/** Privileged implementations live in main. Plugins cannot replace prompts,
 * assign namespaces or turn a generic URL into a certified memory provider. */
export interface MemoryProviderDef {
  id: string
  label: string
  apiVersion: 1
  location: ProviderLocation
  capabilities: ProviderCapabilities
  dispatch: (request: ProviderRequest, host: ProviderHost) => Promise<ProviderResult>
}
