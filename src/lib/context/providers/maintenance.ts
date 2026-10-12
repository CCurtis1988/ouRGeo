/** Integer millionths of USD avoid rounding a series of small charges to zero.
 * These are estimated application limits, never a provider invoice guarantee. */
export interface MaintenancePolicy {
  revision: number
  enabled: boolean
  currency: 'USD'
  mode: 'estimated'
  dailyMicros: number
  monthlyMicros: number
}
export interface MaintenanceReservation {
  id: string
  scope: 'global' | `project:${string}`
  connectionId: string
  policyRevision: number
  purpose: 'retrieval' | 'ingestion' | 'reflection' | 'embedding' | 'summarisation' | 'deletion'
  estimateMicros: number
  /** A host-reviewed operation must have bounded billable work; this does not
   * assert that its estimated dollar charge is an enforceable invoice cap. */
  boundedOperation: true
}
export interface MaintenanceCharge extends MaintenanceReservation {
  state: 'reserved' | 'dispatched' | 'uncertain' | 'settled' | 'released'
  createdAt: string
  dispatchedAt?: string
  actualMicros?: number
  reportedEstimateMicros?: number
}
export interface MaintenanceSummary {
  currency: 'USD'
  mode: 'estimated'
  dailySpentMicros: number
  monthlySpentMicros: number
  outstandingMicros: number
  unresolvedOperations: number
  exceeded: boolean
}
export interface MaintenanceStatus { policy: MaintenancePolicy; summary: MaintenanceSummary }

export function chargeMicros(dollars: unknown): number | undefined {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0 || dollars > 1e6) return undefined
  const micros = Math.ceil(dollars * 1e6)
  return Number.isSafeInteger(micros) ? micros : undefined
}
