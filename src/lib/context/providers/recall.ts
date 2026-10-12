/** Search returns canonical identities, never provider prose or namespaces.
 * The broker reads current local records through its ordinary scoped handles. */
export interface MemoryRecallRequest {
  query: string
  scope: 'global' | 'project'
  before?: string
  after?: string
}
export interface MemoryRecallResult {
  status: 'ok' | 'unavailable' | 'degraded'
  hits: { id: string; revision: number; scope: 'global' | 'project' }[]
  coverage: 'provider' | 'local-only' | 'local-fallback'
  reason?: 'PROVIDER_OFFLINE' | 'SOURCE_BUSY' | 'STALE_REFERENCE' | 'BUDGET_LIMIT' | 'UNSUPPORTED'
}
