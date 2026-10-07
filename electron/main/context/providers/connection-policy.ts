import { randomUUID } from 'node:crypto'
import type { MemoryConnection, MemoryConnectionInput, ProcessingDestination } from '../../../../src/lib/context/providers/connections'
import { connectionUrl } from './transport'
import { redactContext } from '../../../../src/lib/context/policy'

/** Setup inputs have a separate boundary from model tools. The host chooses
 * scope/credential identities; endpoint reachability never enables ingestion. */
export function prepareConnection(input: unknown, projectId: string | null): { connection: MemoryConnection; token?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a provider and enter its connection details.')
  const value = input as Partial<MemoryConnectionInput>
  if (!['mnemosyne', 'hindsight'].includes(String(value.adapter)) || !['loopback', 'server'].includes(String(value.location)) || !['global', 'project'].includes(String(value.scope))) throw new Error('Choose a supported provider, location and memory scope.')
  if (value.scope === 'project' && !projectId) throw new Error('Save the workspace as a project before connecting project memory.')
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80 || redactContext(value.label) !== value.label || /[\r\n]/.test(value.label)) throw new Error('Use a short connection label without credentials.')
  if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new Error('Enter a bounded HTTPS endpoint or explicit loopback address.')
  if (value.token !== undefined && (typeof value.token !== 'string' || value.token.length > 4096 || /[\r\n]/.test(value.token))) throw new Error('Enter a single-line authentication token of at most 4,096 characters.')
  const endpoint = connectionUrl({ endpoint: value.endpoint, local: value.location === 'loopback', token: value.token }).href
  const namespace = value.namespace || `ourgeo_${randomUUID().replaceAll('-', '')}`
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace) || namespace === 'default' || redactContext(namespace) !== namespace) throw new Error('Use a dedicated namespace of at most 64 letters, digits, underscores or hyphens; the shared default bank is refused.')
  const purposes = ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const
  if (!Array.isArray(value.destinations) || value.destinations.length !== purposes.length || purposes.some(purpose => value.destinations!.filter(item => item?.purpose === purpose).length !== 1)) throw new Error('Declare each processing destination, including disabled or unknown services.')
  const destinations: ProcessingDestination[] = value.destinations.map(item => {
    if (typeof item.destination !== 'string' || item.destination.length > 2048) throw new Error('Use bounded processing destination addresses.')
    const destination = ['disabled', 'unknown'].includes(item.destination) ? item.destination
      : connectionUrl({ endpoint: item.destination, local: value.location === 'loopback' }).href
    return { purpose: item.purpose, destination }
  })
  return { connection: { id: randomUUID(), revision: 1, adapter: value.adapter!, label: value.label.trim(), endpoint,
    location: value.location!, scope: value.scope === 'global' ? 'global' : `project:${projectId}`, namespaceRef: namespace,
    credentialRef: value.token ? randomUUID() : null, destinations, state: 'configured', certification: 'pending', createdAt: new Date().toISOString() },
    ...(value.token ? { token: value.token } : {}) }
}
