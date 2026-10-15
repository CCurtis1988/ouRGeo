import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'
import { createManagedMnemosyne, type CanonicalSnapshotPort } from './managed-mnemosyne'
import type { JsonTransport } from './transport'

export const MNEMOSYNE_LOCAL_SERVER_PROFILE = 'mnemosyne-local-server-v1'
/** The external transport retains the same pinned snapshot/canonical-ID
 * contract. Authentication and namespace ownership are verified by the host;
 * arbitrary upstream MCP endpoints do not acquire these capabilities. */
export function createLocalServerMnemosyne(connectionId: string, transport: JsonTransport, canonical?: CanonicalSnapshotPort): MemoryProviderDef {
  const provider = createManagedMnemosyne(MNEMOSYNE_LOCAL_SERVER_PROFILE, { request: (payload, host) => transport('/rpc', 'POST', { ...payload as Record<string, unknown>, invocationId: host.idempotencyKey }, host) }, canonical)
  return { ...provider, id: 'mnemosyne-local-server', label: 'Mnemosyne local server', location: { kind: 'external', connectionId } }
}
