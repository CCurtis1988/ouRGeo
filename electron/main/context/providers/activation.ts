import type { MemoryRecallRequest, MemoryRecallResult } from '../../../../src/lib/context/providers/recall'
import { providerDescriptorIssues } from '../../../../src/lib/context/providers/validation'
import { providerQuery } from './shared'
import { randomUUID } from 'node:crypto'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { ProviderBinding, OutboxJob } from '../../../../src/lib/context/providers/outbox'
import type { CanonicalScopeSnapshot } from '../../../../src/lib/context/providers/types'
import type { MaintenanceStatus } from '../../../../src/lib/context/providers/maintenance'
import type { ProviderActivationPreview, ProviderActivationStatus } from '../../../../src/lib/context/providers/activation'
import type { WorkspaceLease } from '../scope'
import { OutboxRunner } from '../outbox-runner'
import { DeploymentRegistry } from './certification'
import { connectionDigest } from './routing'
import { createProviderWorkerPort } from './worker-port'
import { createJsonTransport } from './transport'
import { createHindsightProvider } from './hindsight'
import type { ProviderRoutingPort } from './routing'

type Dispatch = Parameters<typeof createProviderWorkerPort>[0]
interface State { connections: MemoryConnection[]; bindings: ProviderBinding[] }
interface Prepared { public: ProviderActivationPreview; connection: MemoryConnection; binding: ProviderBinding; lease: WorkspaceLease; generation: number; ids: string[] }
export interface ActivationHost {
  dispatch: Dispatch
  lease: () => WorkspaceLease
  registry: DeploymentRegistry
  /** Native host consent to the exact preview, never a model tool response. */
  approve: (preview: ProviderActivationPreview, connection: MemoryConnection) => Promise<boolean>
  fetcher?: typeof fetch
  now?: () => number
  prepareManaged?: (connections: MemoryConnection[]) => Promise<void>
  provider?: ProviderRoutingPort['provider']
}

/** Activation is a transaction over canonical state. A review enables no
 * writes until the user approves this scope and future processing explicitly. */
export class ProviderActivation {
  private state: State = { connections: [], bindings: [] }
  private generation = 0
  private jobs = new Map<string, OutboxJob>()
  private previews = new Map<string, Prepared>()
  private runner: OutboxRunner
  private waking?: Promise<void>
  private timer?: ReturnType<typeof setTimeout>
  private requested = false
  private recalls = new Map<string, AbortController>()
  private breakers = new Map<string, { failures: number; retryAt: number }>()
  private stopped = false
  private paidAllowed = false
  private now: () => number
  constructor(private host: ActivationHost) {
    this.now = host.now ?? Date.now
    const dispatch: Dispatch = async (operation, value, guard) => {
      const generation = this.generation
      const result = await host.dispatch(operation, value, guard)
      if (operation === 'currentOutbox' && result) {
        if (generation !== this.generation) throw new Error('POLICY_REFUSED: canonical memory changed during lookup.')
        const job = result as OutboxJob
        this.jobs.set(job.operation.id, structuredClone(job))
      }
      return result
    }
    const worker = createProviderWorkerPort(dispatch, {
      lease: host.lease,
      certificate: async id => {
        const binding = this.state.bindings.find(binding => binding.id === id), connection = this.state.connections.find(connection => connection.id === binding?.connectionRef)
        return binding && connection ? host.registry.certificate(connection, binding) : undefined
      },
      authorised: (lease, connection, certificate, job) => {
        const binding = this.state.bindings.find(binding => binding.id === job.binding.id), live = this.state.connections.find(item => item.id === connection.id)
        return !this.stopped && host.lease().id === lease.id && host.lease().projectId === lease.projectId && Boolean(binding && live
          && host.registry.certificate(live, binding)?.id === certificate.id && connectionDigest(live) === certificate.connectionDigest
          && JSON.stringify(this.jobs.get(job.operation.id)) === JSON.stringify(job))
      },
      provider: (connection, token, certificate) => {
        if (host.provider) return host.provider(connection, token, certificate)
        if (connection.adapter !== 'hindsight') throw new Error('UNSUPPORTED: certify the Mnemosyne connection adapter before activating it.')
        return createHindsightProvider(connection.id, createJsonTransport({ endpoint: connection.endpoint, local: connection.location === 'loopback', token }, host.fetcher))
      },
    })
    const scopes = worker.scopes
    worker.scopes = () => scopes().filter(scope => this.state.bindings.some(binding => binding.scope === scope && this.state.connections.some(connection => connection.id === binding.connectionRef && (this.paidAllowed || connection.location === 'managed-local') && host.registry.certificate(connection, binding))))
    this.runner = new OutboxRunner(worker, this.now)
  }
  invalidate(): void {
    for (const controller of this.recalls.values()) controller.abort()
    this.recalls.clear()
    this.generation++; this.jobs.clear(); this.previews.clear(); this.runner.cancel()
    this.state = { connections: [], bindings: [] }
    clearTimeout(this.timer)
  }
  stop(): void { this.stopped = true; this.invalidate() }
  private scopes(): string[] { const lease = this.host.lease(); return ['global', ...(lease.projectId ? [`project:${lease.projectId}`] : [])] }
  private async refresh(): Promise<void> {
    const generation = this.generation, lease = this.host.lease()
    const check = () => { if (this.stopped || generation !== this.generation || lease.id !== this.host.lease().id) throw new Error('SCOPE_CHANGED: refresh provider activation in the active workspace.') }
    check()
    const state = await this.host.dispatch('scopedProviderState', this.scopes(), check) as State
    check()
    await this.host.prepareManaged?.(state.connections)
    check(); this.state = state
  }
  async status(): Promise<ProviderActivationStatus[]> {
    const lease = this.host.lease().id
    try { await this.refresh() } catch (error) {
      // An acknowledged mutation can revoke an overlapping status read. One
      // fresh metadata retry is safe only within the same workspace lease.
      if (this.stopped || lease !== this.host.lease().id) throw error
      await this.refresh()
    }
    return this.state.connections.map(connection => {
      const binding = this.state.bindings.find(binding => binding.connectionRef === connection.id && binding.enabled)
        ?? this.state.bindings.find(binding => binding.connectionRef === connection.id)
      const reviewed = Boolean(this.host.registry.review(connection))
      return { connectionId: connection.id, state: reviewed ? binding?.enabled ? 'active' : binding ? 'paused' : 'ready' : 'review-required',
        recovery: reviewed ? 'Review this scope before enabling future processing. Pausing does not delete remote copies.' : 'Complete review of this exact deployment, destinations, isolation, deletion and billing before activation.' }
    })
  }
  cancelRecall(id: string): void { this.recalls.get(id)?.abort() }
  /** Only the reviewed local lexical profile is currently certified for recall.
   * External search needs its own billing/disclosure review before it can run. */
  async recall(input: MemoryRecallRequest, id: string, suppliedLease: string): Promise<MemoryRecallResult> {
    const query = providerQuery(input.query)
    if (!['global', 'project'].includes(input.scope) || suppliedLease !== this.host.lease().id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('SCOPE_CHANGED')
    if (input.before || input.after) return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'UNSUPPORTED' }
    if (this.recalls.has(id) || this.recalls.size >= 2) return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'SOURCE_BUSY' }
    const controller = new AbortController(), generation = this.generation, lease = this.host.lease()
    this.recalls.set(id, controller)
    const check = (): void => {
      controller.signal.throwIfAborted()
      if (this.stopped || generation !== this.generation || lease.id !== this.host.lease().id) throw new Error('SCOPE_CHANGED')
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let connectionId: string | undefined
    let timedOut = false
    const started = Date.now()
    const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('PROVIDER_OFFLINE')), { once: true }))
    timer = setTimeout(() => { timedOut = true; controller.abort() }, 3000); timer.unref()
    try {
      check(); await Promise.race([this.refresh(), aborted]); check()
      const scope = input.scope === 'global' ? 'global' : lease.projectId ? `project:${lease.projectId}` : null
      const binding = this.state.bindings.find(item => item.scope === scope && item.enabled)
      const connection = this.state.connections.find(item => item.id === binding?.connectionRef)
      const certificate = binding && connection ? this.host.registry.certificate(connection, binding) : undefined
      if (!scope || !binding || !connection || !certificate || !this.host.provider) return { status: 'unavailable', hits: [], coverage: 'local-only' }
      if (connection.location !== 'managed-local' || certificate.operations.search?.processing !== 'non-billable') return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'UNSUPPORTED' }
      connectionId = connection.id
      const breaker = this.breakers.get(connectionId)
      if (breaker && breaker.retryAt > this.now()) return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'PROVIDER_OFFLINE' }
      const authorised = (): boolean => {
        try {
          check()
          const liveBinding = this.state.bindings.find(item => item.id === binding.id), liveConnection = this.state.connections.find(item => item.id === connection.id)
          return Boolean(liveBinding && liveConnection && this.host.registry.certificate(liveConnection, liveBinding)?.id === certificate.id
            && connectionDigest(liveConnection) === certificate.connectionDigest)
        } catch { return false }
      }
      clearTimeout(timer)
      timer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(1, Math.min(3000, certificate.timeoutMs) - (Date.now() - started))); timer.unref()
      // Include setup in the deadline; adapters cannot hold chat indefinitely.
      const work = async (): Promise<MemoryRecallResult> => {
        const snapshot = await this.host.dispatch('bindingSnapshot', { bindingId: binding.id, scope }, check) as CanonicalScopeSnapshot
        check()
        const provider = await this.host.provider!(connection, undefined, certificate)
        check()
        if (!authorised() || providerDescriptorIssues(provider).length || provider.id !== certificate.providerId
          || provider.location.kind !== 'managed-local' || provider.location.runtimeId !== connection.runtimeId || !provider.capabilities.lexicalSearch || provider.capabilities.scopeIsolation !== certificate.isolation) throw new Error('POLICY_REFUSED')
        if (await this.host.dispatch('bindingSnapshotCurrent', { bindingId: binding.id, scope, generation: snapshot.generation }, check) !== true) return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'STALE_REFERENCE' }
        check()
        if (!authorised()) throw new Error('POLICY_REFUSED')
        const result = await provider.dispatch({ operation: 'search', query }, { namespace: binding.namespaceRef, signal: controller.signal,
          timeoutMs: Math.min(3000, certificate.timeoutMs), policyRevision: binding.policyRevision, maxTokens: Math.min(1200, certificate.maxTokens),
          maxResults: 5, idempotencyKey: id, paidProcessingAllowed: false, authorised })
        check()
        if (!authorised()) throw new Error('POLICY_REFUSED')
        const current = await this.host.dispatch('bindingSnapshotCurrent', { bindingId: binding.id, scope, generation: snapshot.generation }, check)
        check()
        if (current !== true) return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'STALE_REFERENCE' }
        if (result.status !== 'ok' || result.operationId !== id || result.records.length || !Array.isArray(result.evidence)
          || result.evidence.length > 5) throw new Error('INVALID_RESPONSE')
        const hits: MemoryRecallResult['hits'] = []
        for (const evidence of result.evidence) {
          const record = snapshot.records.find(record => record.id === evidence.canonicalId && record.id === evidence.sourceId && record.revision === evidence.revision)
          if (!record || !record.statement.startsWith(evidence.text) || evidence.authority !== 'provider-derived') throw new Error('INVALID_RESPONSE')
          if (!hits.some(hit => hit.id === record.id)) hits.push({ id: record.id, revision: record.revision, scope: record.scope })
        }
        this.breakers.delete(connection.id)
        return { status: 'ok', hits, coverage: 'provider' }
      }
      return await Promise.race([work(), aborted])
    } catch {
      if (generation !== this.generation || suppliedLease !== this.host.lease().id || this.stopped) throw new Error('SCOPE_CHANGED')
      if (connectionId && (!controller.signal.aborted || timedOut)) {
        const failures = (this.breakers.get(connectionId)?.failures ?? 0) + 1
        this.breakers.set(connectionId, { failures, retryAt: failures >= 3 ? this.now() + 30000 : 0 })
      }
      return { status: 'degraded', hits: [], coverage: 'local-fallback', reason: 'PROVIDER_OFFLINE' }
    } finally { clearTimeout(timer); if (this.recalls.get(id) === controller) this.recalls.delete(id) }
  }
  async preview(id: string, ids: string[], suppliedLease: string, operation: 'activate' | 'import' = 'activate'): Promise<ProviderActivationPreview> {
    if (suppliedLease !== this.host.lease().id || !Array.isArray(ids) || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('Refresh the workspace and choose at most 1,000 canonical memories.')
    await this.refresh()
    const lease = this.host.lease(), generation = this.generation
    const connection = this.state.connections.find(connection => connection.id === id)
    if (!connection) throw new Error('Choose a connection in the active scope.')
    const active = this.state.bindings.find(item => item.connectionRef === connection.id && item.enabled)
    if (operation === 'import' && (!active || !ids.length || !this.host.registry.certificate(connection, active))) throw new Error('Activate this reviewed provider and select committed memories before importing.')
    const binding = operation === 'import' ? active! : this.host.registry.binding(connection)
    if (operation === 'activate' && this.state.bindings.some(item => item.scope === binding.scope && item.enabled)) throw new Error('Pause the current primary provider before reviewing a migration.')
    const check = () => { if (generation !== this.generation || lease.id !== this.host.lease().id) throw new Error('SCOPE_CHANGED: prepare a new activation preview.') }
    const snapshot = await this.host.dispatch('scopeSnapshot', binding.scope, check) as CanonicalScopeSnapshot
    check()
    if (ids.some(id => !snapshot.records.some(record => record.id === id))) throw new Error('Choose active committed memories from this scope only.')
    const maintenance = await this.host.dispatch('maintenanceStatus', undefined, check) as MaintenanceStatus
    check()
    const certificate = this.host.registry.certificate(connection, binding)!, profile = certificate.operations.upsert!
    if (profile.processing === 'paid' && !maintenance.policy.enabled) throw new Error('Configure an estimated maintenance budget before activating paid processing.')
    const estimate = profile.processing === 'paid' ? profile.estimateMicros * ids.length : 0
    if (profile.processing === 'paid' && (estimate + maintenance.summary.outstandingMicros + maintenance.summary.dailySpentMicros > maintenance.policy.dailyMicros
      || estimate + maintenance.summary.outstandingMicros + maintenance.summary.monthlySpentMicros > maintenance.policy.monthlyMicros)) throw new Error('The selected import exceeds the estimated maintenance budget. Choose fewer records.')
    for (const [ref, preview] of this.previews) if (Date.parse(preview.public.expiresAt) <= this.now()) this.previews.delete(ref)
    if (this.previews.size >= 8) throw new Error('Finish or let pending activation previews expire before opening another.')
    const preview: ProviderActivationPreview = { ref: randomUUID(), connectionId: id, label: connection.label, scope: binding.scope === 'global' ? 'global' : 'project', selectedCount: ids.length,
      operation, estimatedIngestionMicros: estimate, currency: 'USD', futureWrites: true, expiresAt: new Date(this.now() + 60000).toISOString() }
    this.previews.set(preview.ref, { public: preview, connection, binding, lease, generation: snapshot.generation, ids: [...ids] })
    return preview
  }
  async activate(ref: string): Promise<boolean> {
    const prepared = this.previews.get(ref)
    this.previews.delete(ref)
    if (!prepared || Date.parse(prepared.public.expiresAt) <= this.now() || prepared.lease.id !== this.host.lease().id) throw new Error('STALE_SELECTION: prepare a new activation preview.')
    if (!await this.host.approve(prepared.public, prepared.connection)) return false
    await this.refresh()
    const check = () => {
      const current = this.state.connections.find(connection => connection.id === prepared.connection.id)
      if (prepared.lease.id !== this.host.lease().id || Date.parse(prepared.public.expiresAt) <= this.now() || !current
        || connectionDigest(current) !== connectionDigest(prepared.connection) || !this.host.registry.certificate(current, prepared.binding)
        || prepared.public.operation === 'import' && !this.state.bindings.some(binding => binding.id === prepared.binding.id && binding.enabled && binding.policyRevision === prepared.binding.policyRevision)) throw new Error('STALE_SELECTION: review the changed deployment before activation.')
    }
    check()
    // Dispatch invalidates live routing state synchronously. This queued guard
    // checks immutable consent/lease; the worker checks connection revision
    // and canonical generation atomically against the approved selection.
    const queued = () => {
      if (prepared.lease.id !== this.host.lease().id || Date.parse(prepared.public.expiresAt) <= this.now()
        || !this.host.registry.certificate(prepared.connection, prepared.binding)) throw new Error('STALE_SELECTION: prepare a new activation preview.')
    }
    await this.host.dispatch(prepared.public.operation === 'import' ? 'importBinding' : 'activateBinding', { binding: prepared.binding, generation: prepared.generation, ids: prepared.ids, connectionRevision: prepared.connection.revision }, queued)
    this.invalidate(); this.wake()
    return true
  }
  async pause(id: string): Promise<void> {
    await this.refresh()
    const binding = this.state.bindings.find(binding => binding.connectionRef === id && binding.enabled)
    if (!binding) throw new Error('Choose an active provider in the current scope.')
    const lease = this.host.lease()
    this.invalidate()
    await this.host.dispatch('configureBinding', { ...binding, enabled: false, policyRevision: binding.policyRevision + 1 }, () => { if (lease.id !== this.host.lease().id) throw new Error('SCOPE_CHANGED') })
  }
  /** Bounded batches and backoff; errors leave canonical records/outbox intact.
   * There is no paid fan-out or automatic switch to another cloud provider. */
  wake(): void {
    if (this.stopped) return
    this.requested = true
    if (this.waking) return
    clearTimeout(this.timer)
    this.waking = (async () => {
      while (this.requested && !this.stopped) {
        this.requested = false
        await this.refresh()
        const maintenance = await this.host.dispatch('maintenanceStatus') as MaintenanceStatus
        this.paidAllowed = maintenance.policy.enabled
        const local = this.state.connections.some(connection => connection.location === 'managed-local' && this.state.bindings.some(binding => binding.connectionRef === connection.id && this.host.registry.certificate(connection, binding)))
        if (maintenance.policy.enabled || local) await this.runner.run(4)
      }
    })().catch(() => { /* Status/queue remain available for recovery; no unbounded immediate retries. */ }).finally(() => {
      this.waking = undefined
      if (!this.stopped && this.requested) { this.wake(); return }
      if (!this.stopped && this.state.bindings.some(binding => binding.enabled)) this.timer = setTimeout(() => this.wake(), 10000)
      this.timer?.unref()
    })
  }
}
