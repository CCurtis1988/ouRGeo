import type { MaintenanceCharge, MaintenancePolicy, MaintenanceReservation, MaintenanceSummary } from '../../../src/lib/context/providers/maintenance'
import { chargeMicros } from '../../../src/lib/context/providers/maintenance'
import type { ProviderResult } from '../../../src/lib/context/providers/types'

export interface MaintenancePort {
  policy: () => MaintenancePolicy | undefined
  charges: () => MaintenanceCharge[]
  putPolicy: (policy: MaintenancePolicy) => void
  putCharge: (charge: MaintenanceCharge) => void
  transaction: <T>(action: () => T) => T
}
const amount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1e12
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
export const defaultMaintenancePolicy: MaintenancePolicy = { revision: 0, enabled: false, currency: 'USD', mode: 'estimated', dailyMicros: 0, monthlyMicros: 0 }

/** All writes use the canonical worker's encrypted transaction. Outstanding
 * charges survive cancellation, crashes, disconnection and period rollover.
 * Unknown usage never releases a reservation or becomes a zero-cost receipt. */
export class MaintenanceLedger {
  constructor(private port: MaintenancePort) {}
  policy(): MaintenancePolicy { return this.port.policy() ?? { ...defaultMaintenancePolicy } }
  configure(input: MaintenancePolicy): MaintenancePolicy {
    return this.port.transaction(() => {
      if (!input || Object.keys(input).some(key => !['revision', 'enabled', 'currency', 'mode', 'dailyMicros', 'monthlyMicros'].includes(key))
        || input.currency !== 'USD' || input.mode !== 'estimated' || typeof input.enabled !== 'boolean'
        || !amount(input.dailyMicros) || !amount(input.monthlyMicros) || input.dailyMicros > input.monthlyMicros
        || input.enabled && (!input.dailyMicros || !input.monthlyMicros) || input.revision !== this.policy().revision + 1) throw new Error('Review the estimated maintenance budget and refresh its policy revision before saving.')
      this.port.putPolicy(input)
      return input
    })
  }
  summary(now = Date.now()): MaintenanceSummary {
    if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Use a valid budget observation time.')
    const today = new Date(now).toISOString().slice(0, 10), month = today.slice(0, 7)
    let dailySpentMicros = 0, monthlySpentMicros = 0, outstandingMicros = 0, unresolvedOperations = 0
    for (const charge of this.port.charges()) {
      if (charge.state === 'settled') {
        const date = (charge.dispatchedAt ?? charge.createdAt).slice(0, 10)
        if (date === today) dailySpentMicros += charge.actualMicros!
        if (date.slice(0, 7) === month) monthlySpentMicros += charge.actualMicros!
      } else if (charge.state !== 'released') {
        outstandingMicros += Math.max(charge.estimateMicros, charge.reportedEstimateMicros ?? 0)
        unresolvedOperations++
      }
    }
    const policy = this.policy()
    return { currency: 'USD', mode: 'estimated', dailySpentMicros, monthlySpentMicros, outstandingMicros, unresolvedOperations,
      exceeded: dailySpentMicros + outstandingMicros > policy.dailyMicros || monthlySpentMicros + outstandingMicros > policy.monthlyMicros }
  }
  reserve(input: MaintenanceReservation, now = Date.now()): MaintenanceCharge {
    return this.port.transaction(() => {
      const policy = this.policy()
      if (!input || Object.keys(input).some(key => !['id', 'scope', 'connectionId', 'policyRevision', 'purpose', 'estimateMicros', 'boundedOperation'].includes(key))
        || !identifier(input.id) || !identifier(input.connectionId) || !/^(global|project:[a-f0-9-]{36})$/i.test(input.scope)
        || !['retrieval', 'ingestion', 'reflection', 'embedding', 'summarisation', 'deletion'].includes(input.purpose)
        || !amount(input.estimateMicros) || input.estimateMicros < 1 || input.boundedOperation !== true) throw new Error('A host-reviewed bounded operation and a non-zero spend estimate are required before paid processing.')
      const previous = this.port.charges().find(charge => charge.id === input.id)
      if (previous) {
        if (Object.keys(input).some(key => previous[key as keyof MaintenanceReservation] !== input[key as keyof MaintenanceReservation])) throw new Error('This reservation belongs to a different operation. Review its receipt before retrying.')
        return previous
      }
      if (!policy.enabled || policy.revision !== input.policyRevision) throw new Error('Paid background processing is off or its budget changed. Review maintenance settings before dispatch.')
      const summary = this.summary(now)
      if (summary.dailySpentMicros + summary.outstandingMicros + input.estimateMicros > policy.dailyMicros
        || summary.monthlySpentMicros + summary.outstandingMicros + input.estimateMicros > policy.monthlyMicros) throw new Error('The estimated maintenance budget is covered. Resolve pending receipts or change the budget before dispatch.')
      const charge: MaintenanceCharge = { ...input, state: 'reserved', createdAt: new Date(now).toISOString() }
      this.port.putCharge(charge)
      return charge
    })
  }
  markDispatched(id: string, now = Date.now()): void {
    this.port.transaction(() => {
      const charge = this.require(id), policy = this.policy()
      if (charge.state !== 'reserved' || !policy.enabled || policy.revision !== charge.policyRevision || this.summary(now).exceeded) throw new Error('This operation cannot be dispatched. Review its policy and existing receipt before retrying.')
      this.port.putCharge({ ...charge, state: 'dispatched', dispatchedAt: new Date(now).toISOString() })
    })
  }
  settle(id: string, result: ProviderResult | undefined, dispatched: boolean, prepared = false): void {
    this.port.transaction(() => {
      const charge = this.require(id)
      if (result && result.operationId !== id) throw new Error('The usage receipt does not match this reservation.')
      if (!dispatched) {
        // Only the route whose atomic mark succeeded may release a prepared
        // dispatch. A competing duplicate route must not free its reservation.
        if (charge.state === 'reserved' || charge.state === 'dispatched' && prepared) this.port.putCharge({ ...charge, state: 'released' })
        return
      }
      if (charge.state === 'reserved' || charge.state === 'released') throw new Error('Record dispatch before accepting a billed receipt.')
      const actual = result && result.status !== 'failed' && typeof result.usage?.estimated === 'boolean' && result.usage.currency === 'USD' ? chargeMicros(result.usage.cost) : undefined
      const final = result?.status === 'ok' && result.complete === true && !result.usage.estimated
      if (charge.state === 'settled') {
        // Late duplicate receipts are idempotent; contradictory final invoices
        // need review rather than silently rewriting already reported spend.
        if (actual !== undefined && final && actual !== charge.actualMicros) throw new Error('Conflicting usage receipts need review; the previous charge is preserved.')
        return
      }
      if (actual !== undefined && final) this.port.putCharge({ ...charge, state: 'settled', actualMicros: actual })
      else this.port.putCharge({ ...charge, state: 'uncertain', ...(actual !== undefined ? { reportedEstimateMicros: Math.max(actual, charge.reportedEstimateMicros ?? 0) } : {}) })
    })
  }
  private require(id: string): MaintenanceCharge {
    const charge = this.port.charges().find(charge => charge.id === id)
    if (!charge) throw new Error('Choose an existing maintenance reservation.')
    return charge
  }
}
