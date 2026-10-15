export type MemoryAdapter = 'mnemosyne' | 'hindsight'
export type ProcessingPurpose = 'storage' | 'embeddings' | 'reranking' | 'extraction' | 'reflection' | 'telemetry' | 'sync'
export interface ProcessingDestination {
  purpose: ProcessingPurpose
  destination: string | 'disabled' | 'unknown'
}
export interface MemoryConnectionInput {
  adapter: MemoryAdapter
  label: string
  endpoint: string
  location: 'loopback' | 'server'
  scope: 'global' | 'project'
  namespace?: string
  token?: string
  destinations: ProcessingDestination[]
}
export interface MemoryConnection {
  id: string
  revision: number
  adapter: MemoryAdapter
  label: string
  endpoint: string
  location: 'loopback' | 'server' | 'managed-local'
  runtimeId?: string
  /** Set only by the native host for its authenticated, owned loopback bridge. */
  localServer?: true
  contribution?: import('./contributions').ProviderContributionRef
  scope: 'global' | `project:${string}`
  namespaceRef: string
  credentialRef: string | null
  destinations: ProcessingDestination[]
  state: 'configured' | 'reachable' | 'failed' | 'disconnected'
  checkedAt?: string
  // A reachable endpoint is not certification of scope isolation or deletion.
  certification: 'pending'
  createdAt: string
}
export type PublicMemoryConnection = Omit<MemoryConnection, 'namespaceRef' | 'credentialRef'> & { authenticated: boolean }

export function publicConnection(connection: MemoryConnection): PublicMemoryConnection {
  const { namespaceRef: _namespace, credentialRef, ...metadata } = connection
  return { ...metadata, authenticated: credentialRef !== null && connection.state !== 'disconnected' }
}
