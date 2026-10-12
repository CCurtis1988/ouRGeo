import type { MaintenanceCharge, MaintenanceReservation } from '../../../src/lib/context/providers/maintenance'
import type { ProviderResult } from '../../../src/lib/context/providers/types'
import type { OutboxRoute } from './outbox-runner'

export interface MaintenanceRoutePort {
  reserve: (reservation: MaintenanceReservation) => Promise<MaintenanceCharge>
  markDispatched: (id: string) => Promise<void>
  settle: (id: string, result: ProviderResult | undefined, dispatched: boolean, prepared?: boolean) => Promise<void>
}

/** Wrap only a host-certified/authorised route. A budget cannot grant access,
 * choose a provider, approve a destination or certify deletion. Reconciliation
 * reads use their own reservation IDs, while the outbox keeps its receipt ID. */
export async function prepareMaintenanceRoute(route: OutboxRoute, reservation: MaintenanceReservation, operationId: string, port: MaintenanceRoutePort, signal: AbortSignal): Promise<OutboxRoute> {
  if (!route.host.paidProcessingAllowed || !route.authorised() || signal.aborted) throw new Error('Paid processing is not authorised for this route.')
  const charge = await port.reserve(reservation)
  if (charge.state !== 'reserved') throw new Error('This paid operation already has a receipt. Reconcile it before scheduling new work.')
  if (!route.authorised() || signal.aborted) {
    await port.settle(reservation.id, undefined, false)
    throw new Error('The route changed before dispatch; no paid request was sent.')
  }
  let prepared = false
  return {
    ...route,
    beforeDispatch: async () => {
      if (!route.authorised() || signal.aborted) throw new Error('The route is no longer authorised.')
      await route.beforeDispatch?.()
      await port.markDispatched(reservation.id)
      prepared = true
    },
    settle: async (result, dispatched) => {
      // Shape/bounds are validated by the runner before reaching this hook.
      // The host remaps the operation receipt to this invocation's reservation;
      // a repeated reconciliation read must not consume the old write receipt.
      const receipt = result?.operationId === operationId ? { ...result, operationId: reservation.id } : undefined
      await port.settle(reservation.id, receipt, dispatched, prepared)
      await route.settle(result, dispatched)
    },
  }
}
