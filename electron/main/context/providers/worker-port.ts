import type { OutboxJob, OutboxReceipt } from '../../../../src/lib/context/providers/outbox'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { MaintenanceCharge, MaintenanceStatus } from '../../../../src/lib/context/providers/maintenance'
import type { WorkspaceLease } from '../scope'
import type { OutboxPort } from '../outbox-runner'
import { resolveProviderRoute, type ProviderRoutingPort } from './routing'

type Dispatch = (operation: string, value?: unknown, guard?: () => void) => Promise<unknown>
type ReviewedRouting = Omit<ProviderRoutingPort, 'currentJob' | 'connection' | 'credential' | 'maintenancePolicy' | 'maintenance'>

/** The same purpose-specific worker operations used by main; no generic
 * renderer IPC exposes jobs, certificates, credentials or spend reservations.
 * Constructing this port neither starts a runner nor certifies a connection. */
export function createProviderWorkerPort(dispatch: Dispatch, routing: ReviewedRouting): OutboxPort {
  const scopes = (lease = routing.lease()): string[] => ['global', ...(lease.projectId ? [`project:${lease.projectId}`] : [])]
  const guard = (lease: WorkspaceLease): (() => void) => () => {
    if (routing.lease().id !== lease.id || routing.lease().projectId !== lease.projectId) throw new Error('SCOPE_CHANGED: the provider operation belongs to an earlier workspace.')
  }
  const current = async (id: string, selected: string[], lease = routing.lease()): Promise<OutboxJob | null> => {
    const check = guard(lease), allowed = selected.filter(scope => scopes(lease).includes(scope))
    check()
    if (!allowed.length) return null
    const result = await dispatch('currentOutbox', { id, scopes: allowed }, check) as OutboxJob | null
    check()
    return result
  }
  const resolved: ProviderRoutingPort = {
    ...routing,
    currentJob: (id, lease) => current(id, scopes(lease), lease),
    connection: async id => {
      const lease = routing.lease(), check = guard(lease)
      const result = await dispatch('scopedConnection', { id, scopes: scopes(lease) }, check) as MemoryConnection | undefined
      check(); return result
    },
    credential: async reference => {
      const lease = routing.lease(), check = guard(lease)
      const result = await dispatch('scopedCredential', { reference, scopes: scopes(lease) }, check) as string | undefined
      check(); return result
    },
    maintenancePolicy: async () => (await dispatch('maintenanceStatus') as MaintenanceStatus).policy,
    maintenance: {
      reserve: async input => await dispatch('reserveMaintenance', input) as MaintenanceCharge,
      markDispatched: async id => { await dispatch('dispatchMaintenance', id) },
      settle: async (id, result, dispatched, prepared) => { await dispatch('settleMaintenance', { id, result, dispatched, prepared }) },
    },
  }
  const claim = async (operation: 'claimOutbox' | 'claimPendingOutbox', selected: string[], now: number): Promise<OutboxJob | null> => {
    const lease = routing.lease(), check = guard(lease), allowed = selected.filter(scope => scopes(lease).includes(scope))
    check()
    if (!allowed.length) return null
    const result = await dispatch(operation, { scopes: allowed, now }, check) as OutboxJob | null
    try { check(); return result }
    catch (error) {
      // A late claim never sent data. Repair its lease rather than misclassify
      // it as uncertain billed ingestion after the process restarts.
      if (result) await dispatch('completeOutbox', { id: result.operation.id, receipt: { status: operation === 'claimPendingOutbox' ? 'pending' : 'retry' } satisfies OutboxReceipt, now })
      throw error
    }
  }
  return {
    scopes: () => scopes(), claim: (selected, now) => claim('claimOutbox', selected, now), claimPending: (selected, now) => claim('claimPendingOutbox', selected, now), current,
    complete: async (id, receipt, now) => { await dispatch('completeOutbox', { id, receipt, now }) },
    resolve: (job, reconciliation, signal) => resolveProviderRoute(job, reconciliation, signal, resolved),
  }
}
