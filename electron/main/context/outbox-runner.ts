import type { OutboxJob, OutboxReceipt } from '../../../src/lib/context/providers/outbox'
import type { MemoryProviderDef, ProviderHost, ProviderRequest, ProviderResult } from '../../../src/lib/context/providers/types'
import { providerDescriptorIssues, providerRequestIssues, providerResponseIssues } from '../../../src/lib/context/providers/validation'

export interface OutboxRoute {
  provider: MemoryProviderDef
  host: Omit<ProviderHost, 'signal' | 'idempotencyKey' | 'authorised'>
  /** Checks the live host policy; endpoint self-descriptions cannot certify it. */
  authorised: () => boolean
  /** Durably mark any paid reservation before calling the provider. */
  beforeDispatch?: () => Promise<void>
  /** Idempotently reconciles the reservation, including a late billed receipt. */
  settle: (result: ProviderResult | undefined, dispatched: boolean) => Promise<void>
}
export interface OutboxPort {
  scopes: () => string[]
  claim: (scopes: string[], now: number) => Promise<OutboxJob | null>
  claimPending: (scopes: string[], now: number) => Promise<OutboxJob | null>
  current: (id: string, scopes: string[]) => Promise<OutboxJob | null>
  complete: (id: string, receipt: OutboxReceipt, now: number) => Promise<void>
  /** Resolve only certified host-owned bindings and reserve any paid spend
   * before returning. This preparation must not send source content. */
  resolve: (job: OutboxJob, reconciliation: boolean, signal: AbortSignal) => Promise<OutboxRoute>
}

function receipt(job: OutboxJob, result: ProviderResult | undefined, reconciliation: boolean): OutboxReceipt {
  if (!result || result.operationId !== job.operation.id || result.status !== 'ok' || result.complete !== true || !Array.isArray(result.records)
    || result.records.length > 1 || (result.evidence !== undefined && (!Array.isArray(result.evidence) || result.evidence.length > 1))) return { status: job.operation.operation === 'upsert' ? 'pending' : 'retry' }
  if (reconciliation) {
    // A similar extracted fact or a truncated read cannot prove the canonical
    // document revision finished processing. Never re-retain to find out.
    return { status: result.evidence?.some(source => source && source.canonicalId === job.operation.canonicalId && source.revision === job.operation.revision
      && source.authority === 'provider-derived' && source.text === job.record?.statement) ? 'confirmed' : 'pending' }
  }
  if (job.operation.operation === 'delete') return { status: result.records.length === 0 && !result.evidence?.length ? 'confirmed' : 'retry' }
  return { status: result.records.some(record => record && record.id === job.operation.canonicalId && record.revision === job.operation.revision
    && record.scope === job.record?.scope && record.projectId === job.record.projectId && record.statement === job.record.statement) ? 'confirmed' : 'pending' }
}

/** One bounded worker per host. Scope switches/revocations cancel dispatch;
 * completion receipts can still repair a late write without disclosing content
 * to a new scope. Canonical records never come back from a provider response. */
export class OutboxRunner {
  private running?: Promise<number>
  private generation = 0
  private active = new Map<string, { job: OutboxJob; abort: AbortController }>()
  constructor(private port: OutboxPort, private now: () => number = Date.now, private preparationTimeoutMs = 15000) {}
  run(maximum = 4): Promise<number> {
    if (this.running) return this.running
    const generation = this.generation
    const run = async (): Promise<number> => {
      let processed = 0
      for (; processed < Math.max(1, Math.min(10, maximum)) && this.generation === generation; processed++) {
        const scopes = this.port.scopes()
        if (!scopes.length) break
        // Recover uncertain writes before allowing a new revision to overtake
        // them. Read-only reconciliation has its own bounded retry policy.
        const pending = await this.port.claimPending(scopes, this.now())
        const job = pending ?? await this.port.claim(scopes, this.now())
        if (!job) break
        if (this.generation !== generation || !this.port.scopes().includes(job.operation.scope)) {
          await this.port.complete(job.operation.id, { status: pending ? 'pending' : 'retry' }, this.now())
          break
        }
        await this.deliver(job, pending !== null, generation)
      }
      return processed
    }
    this.running = run().finally(() => { this.running = undefined })
    return this.running
  }
  cancel(canonicalId?: string): void {
    if (!canonicalId) this.generation++
    for (const { job, abort } of this.active.values()) if (!canonicalId || job.operation.canonicalId === canonicalId) abort.abort()
  }
  private async deliver(job: OutboxJob, reconciliation: boolean, generation: number): Promise<void> {
    const abort = new AbortController()
    this.active.set(job.operation.id, { job, abort })
    let route: OutboxRoute | undefined, result: ProviderResult | undefined, invoked = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      const stop = (): void => reject(new Error('Provider delivery cancelled or timed out. Its receipt remains pending.'))
      abort.signal.addEventListener('abort', stop, { once: true })
      timeout = setTimeout(() => abort.abort(), Number.isFinite(this.preparationTimeoutMs) ? Math.max(1, Math.min(15000, this.preparationTimeoutMs)) : 15000)
    })
    try {
      const preparing = this.port.resolve(job, reconciliation, abort.signal)
      // Local preparation cannot hold the runner indefinitely. A late route
      // has not sent content and must release only its own unsent reservation.
      void preparing.then(async late => { if (abort.signal.aborted) await late.settle(undefined, false) }).catch(() => { /* No automatic dispatch follows a failed or cancelled preparation. */ })
      route = await Promise.race([preparing, cancelled])
      if (providerDescriptorIssues(route.provider).length) throw new Error('INVALID_RESPONSE')
      const current = await Promise.race([this.port.current(job.operation.id, this.port.scopes()), cancelled])
      const authorised = (): boolean => !abort.signal.aborted && this.generation === generation && this.port.scopes().includes(job.operation.scope) && route!.authorised()
      if (!current || current.operation.revision !== job.operation.revision || current.binding.policyRevision !== job.binding.policyRevision || !authorised()) throw new Error('POLICY_REFUSED')
      if (route.host.namespace !== job.binding.namespaceRef || route.host.policyRevision !== job.binding.policyRevision || route.provider.capabilities.scopeIsolation === 'unsupported'
        || (reconciliation ? !route.provider.capabilities.readById : job.operation.operation === 'delete' ? !route.provider.capabilities.deleteBySource : !route.provider.capabilities.upsert)) throw new Error('POLICY_REFUSED')
      if (!Number.isFinite(route.host.timeoutMs) || route.host.timeoutMs <= 0 || !Number.isSafeInteger(route.host.maxTokens) || route.host.maxTokens < 1
        || !Number.isSafeInteger(route.host.maxResults) || route.host.maxResults < 1) throw new Error('BUDGET_LIMIT')
      const request: ProviderRequest = reconciliation ? { operation: 'read', id: job.operation.canonicalId }
        : job.operation.operation === 'delete' ? { operation: 'delete', ids: [job.operation.canonicalId] }
          : { operation: 'upsert', records: [job.record!] }
      const host: ProviderHost = { ...route.host, signal: abort.signal, idempotencyKey: job.operation.id, authorised }
      if (providerRequestIssues(request, route.provider, host).length) throw new Error('INVALID_REQUEST')
      if (host.paidProcessingAllowed && !route.beforeDispatch) throw new Error('POLICY_REFUSED')
      clearTimeout(timeout)
      timeout = setTimeout(() => abort.abort(), Math.max(1, Math.min(15000, host.timeoutMs)))
      const preparingDispatch = route.beforeDispatch?.() ?? Promise.resolve()
      void preparingDispatch.then(async () => { if (abort.signal.aborted && !invoked) await route!.settle(undefined, false) }).catch(() => { /* A durable preparation failure does not authorise provider execution. */ })
      await Promise.race([preparingDispatch, cancelled])
      const prepared = await Promise.race([this.port.current(job.operation.id, this.port.scopes()), cancelled])
      if (!authorised() || !prepared || prepared.binding.policyRevision !== job.binding.policyRevision || prepared.operation.revision !== job.operation.revision) throw new Error('POLICY_REFUSED')
      const accepted = (value: ProviderResult): ProviderResult | undefined => providerResponseIssues(value, host).length ? undefined : value
      invoked = true
      const dispatch = route.provider.dispatch(request, host)
      // A contributed adapter ignoring cancellation cannot keep the worker
      // waiting forever. Its eventual receipt still triggers compensation.
      void dispatch.then(async late => {
        if (abort.signal.aborted) {
          const verified = accepted(late)
          await this.port.complete(job.operation.id, receipt(job, verified, reconciliation), this.now())
          await route!.settle(verified, true)
        }
      }).catch(() => { /* The pending receipt is already durable; no hidden retry. */ })
      result = accepted(await Promise.race([dispatch, cancelled]))
      await this.port.complete(job.operation.id, receipt(job, result, reconciliation), this.now())
    } catch {
      await this.port.complete(job.operation.id, { status: job.operation.operation === 'upsert' && (invoked || reconciliation) ? 'pending' : 'retry' }, this.now())
    } finally {
      clearTimeout(timeout)
      this.active.delete(job.operation.id)
      await route?.settle(result, invoked)
    }
  }
}
