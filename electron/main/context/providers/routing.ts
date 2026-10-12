import { createHash } from 'node:crypto'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { OutboxJob } from '../../../../src/lib/context/providers/outbox'
import type { MemoryProviderDef } from '../../../../src/lib/context/providers/types'
import type { MaintenancePolicy } from '../../../../src/lib/context/providers/maintenance'
import { providerDescriptorIssues } from '../../../../src/lib/context/providers/validation'
import type { WorkspaceLease } from '../scope'
import type { OutboxRoute } from '../outbox-runner'
import { prepareMaintenanceRoute, type MaintenanceRoutePort } from '../maintenance-route'
import { connectionUrl } from './transport'

type Operation = 'search' | 'read' | 'upsert' | 'delete'
export type CertifiedOperation =
  | { processing: 'non-billable' }
  | { processing: 'paid'; estimateMicros: number; pricingVersion: string; pricingExpiresAt: string; boundedOperation: true }

/** Issued only by ouRGeo's reviewed deployment registry, never endpoint probe
 * results, project bundles, provider self-descriptions or renderer settings.
 * Passing the reusable conformance fixture does not issue this certificate. */
export interface ProviderCertificate {
  id: string
  bindingId: string
  bindingPolicyRevision: number
  connectionId: string
  connectionDigest: string
  adapterVersion: string
  providerId: string
  scope: 'global' | `project:${string}`
  isolation: 'native' | 'dedicated-instance'
  expiresAt: string
  timeoutMs: number
  maxTokens: number
  operations: Partial<Record<Operation, CertifiedOperation>>
}
export interface ProviderRoutingPort {
  lease: () => WorkspaceLease
  currentJob: (id: string, lease: WorkspaceLease) => Promise<OutboxJob | null>
  connection: (id: string) => Promise<MemoryConnection | undefined>
  certificate: (bindingId: string) => Promise<ProviderCertificate | undefined>
  credential: (reference: string) => Promise<string | undefined>
  /** Must check live connection/binding/certificate generations AND memory
   * processing/disclosure consent. Budget consent is an additional boundary. */
  authorised: (lease: WorkspaceLease, connection: MemoryConnection, certificate: ProviderCertificate, job: OutboxJob) => boolean
  provider: (connection: MemoryConnection, token: string | undefined, certificate: ProviderCertificate) => MemoryProviderDef | Promise<MemoryProviderDef>
  maintenancePolicy: () => Promise<MaintenancePolicy>
  maintenance: MaintenanceRoutePort
}

/** Keep endpoints/namespaces out of routine diagnostics. Any credential,
 * disclosure, revision or destination change invalidates deployment approval. */
export function connectionDigest(connection: MemoryConnection): string {
  return createHash('sha256').update(JSON.stringify([connection.id, connection.revision, connection.adapter, connection.endpoint, connection.location,
    connection.scope, connection.namespaceRef, connection.credentialRef, connection.runtimeId ?? null, [...connection.destinations].sort((a, b) => a.purpose.localeCompare(b.purpose))])).digest('hex')
}
function jobDigest(job: OutboxJob): string {
  const binding = job.binding, operation = job.operation
  return createHash('sha256').update(JSON.stringify([
    [binding.id, binding.scope, binding.adapter, binding.adapterVersion, binding.namespaceRef, binding.connectionRef, binding.policyRevision, binding.enabled, binding.writesCertified],
    [operation.id, operation.bindingId, operation.scope, operation.canonicalId, operation.revision, operation.policyRevision, operation.operation, operation.attempts, operation.reconciliationAttempts ?? 0],
    job.record ? Object.keys(job.record).sort().map(key => [key, job.record![key as keyof typeof job.record]]) : null,
  ])).digest('hex')
}
const future = (date: unknown, now: number): boolean => typeof date === 'string' && date.length <= 64 && Number.isFinite(Date.parse(date)) && Date.parse(date) > now
const identifier = (value: unknown): boolean => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
function validateCertificate(certificate: ProviderCertificate, job: OutboxJob, connection: MemoryConnection, now: number): void {
  const binding = job.binding
  if (!certificate || !identifier(certificate.id) || !identifier(certificate.providerId) || certificate.bindingId !== binding.id
    || certificate.connectionId !== connection.id || certificate.bindingPolicyRevision !== binding.policyRevision || certificate.scope !== binding.scope
    || certificate.adapterVersion !== binding.adapterVersion || certificate.connectionDigest !== connectionDigest(connection)
    || !['native', 'dedicated-instance'].includes(certificate.isolation) || !future(certificate.expiresAt, now)
    || !Number.isSafeInteger(certificate.timeoutMs) || certificate.timeoutMs < 100 || certificate.timeoutMs > 15000
    || !Number.isSafeInteger(certificate.maxTokens) || certificate.maxTokens < 256 || certificate.maxTokens > 8000) throw new Error('PROVIDER_UNCERTIFIED: review the exact deployment and processing profile before routing memory.')
}

/** Preparation reads protected local metadata only. There is no fan-out,
 * endpoint probing, ingestion or factory-controlled prompt construction. */
export async function resolveProviderRoute(job: OutboxJob, reconciliation: boolean, signal: AbortSignal, port: ProviderRoutingPort, now: () => number = Date.now): Promise<OutboxRoute> {
  job = structuredClone(job)
  const lease = { ...port.lease() }, binding = job.binding, operation: Operation = reconciliation ? 'read' : job.operation.operation
  const checkLease = (): void => {
    signal.throwIfAborted()
    if (port.lease().id !== lease.id || port.lease().projectId !== lease.projectId || !binding.enabled || !binding.writesCertified
      || job.operation.bindingId !== binding.id || job.operation.scope !== binding.scope || job.operation.policyRevision !== binding.policyRevision
      || binding.scope !== 'global' && binding.scope !== `project:${lease.projectId}`) throw new Error('SCOPE_CHANGED: refresh the active provider binding before routing memory.')
  }
  checkLease()
  const current = await port.currentJob(job.operation.id, lease)
  checkLease()
  if (!current || jobDigest(current) !== jobDigest(job)) throw new Error('STALE_OPERATION: resolve the current canonical job before provider preparation.')
  const source = await port.connection(binding.connectionRef)
  checkLease()
  const connection = source ? structuredClone(source) : undefined
  if (!connection || connection.id !== binding.connectionRef || connection.adapter !== binding.adapter || connection.scope !== binding.scope
    || connection.namespaceRef !== binding.namespaceRef || connection.state !== 'reachable') throw new Error('PROVIDER_UNAVAILABLE: inspect the scoped connection before routing memory.')
  const managed = connection.location === 'managed-local'
  if (managed) {
    if (connection.adapter !== 'mnemosyne' || !connection.runtimeId || connection.endpoint !== 'on-device' || connection.credentialRef
      || !/^[a-f0-9-]{36}$/.test(connection.namespaceRef) || connection.destinations.some(item => item.destination !== (item.purpose === 'storage' ? 'on-device' : 'disabled'))) throw new Error('PROCESSING_UNVERIFIED: use the reviewed managed local profile.')
  } else connectionUrl({ endpoint: connection.endpoint, local: connection.location === 'loopback' })
  if (connection.location === 'server' && !connection.credentialRef) throw new Error('CREDENTIAL_UNAVAILABLE: remote memory requires protected authentication.')
  const purposes = ['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync']
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(connection.namespaceRef) || connection.namespaceRef === 'default'
    || connection.destinations.length !== 7 || new Set(connection.destinations.map(item => item.purpose)).size !== 7
    || connection.destinations.some(item => !purposes.includes(item.purpose))
    || connection.destinations.some(item => item.destination === 'unknown')
    || connection.destinations.find(item => item.purpose === 'storage')?.destination !== connection.endpoint) throw new Error('PROCESSING_UNVERIFIED: review every processing destination before provider routing.')
  if (!managed) for (const item of connection.destinations) if (item.destination !== 'disabled') connectionUrl({ endpoint: item.destination, local: connection.location === 'loopback' })
  const value = await port.certificate(binding.id)
  checkLease()
  if (!value) throw new Error('PROVIDER_UNCERTIFIED: reachability does not certify scope isolation, deletion or bounded processing.')
  const certificate = structuredClone(value)
  validateCertificate(certificate, job, connection, now())
  const profile = certificate.operations[operation]
  if (!profile || !['paid', 'non-billable'].includes(profile.processing)) throw new Error('UNSUPPORTED: this deployment is not certified for the requested memory operation.')
  if (profile.processing === 'paid' && (!profile.boundedOperation || !Number.isSafeInteger(profile.estimateMicros) || profile.estimateMicros < 1
    || profile.estimateMicros > 1e12 || !identifier(profile.pricingVersion) || !future(profile.pricingExpiresAt, now()))) throw new Error('PRICING_UNAVAILABLE: review a current bounded processing estimate before paid dispatch.')
  const authorised = (): boolean => {
    try { checkLease(); return future(certificate.expiresAt, now()) && (profile.processing !== 'paid' || future(profile.pricingExpiresAt, now())) && port.authorised(lease, connection, certificate, job) }
    catch { return false }
  }
  if (!authorised()) throw new Error('POLICY_REFUSED: memory processing consent was revoked or changed.')
  const fresh = await port.currentJob(job.operation.id, lease)
  if (!authorised() || !fresh || jobDigest(fresh) !== jobDigest(job)) throw new Error('STALE_OPERATION: the canonical job changed during certification lookup.')
  const token = connection.credentialRef ? await port.credential(connection.credentialRef) : undefined
  if (!authorised()) throw new Error('POLICY_REFUSED: the scope or processing policy changed during credential lookup.')
  if (connection.credentialRef && !token) throw new Error('CREDENTIAL_UNAVAILABLE: reconnect through protected settings before routing memory.')
  const provider = await port.provider(connection, token, certificate)
  if (!authorised()) throw new Error('POLICY_REFUSED: memory policy changed during provider preparation.')
  const locationMatches = managed ? provider.location.kind === 'managed-local' && provider.location.runtimeId === connection.runtimeId
    : provider.location.kind === 'external' && provider.location.connectionId === connection.id
  if (providerDescriptorIssues(provider).length || provider.id !== certificate.providerId || !locationMatches || provider.capabilities.scopeIsolation !== certificate.isolation
    || !provider.capabilities.deleteBySource || !provider.capabilities.readById || !provider.capabilities.upsert) throw new Error('PROVIDER_UNCERTIFIED: the installed adapter does not match the approved deployment capabilities.')
  const route: OutboxRoute = { provider, host: { namespace: connection.namespaceRef, policyRevision: binding.policyRevision, timeoutMs: certificate.timeoutMs,
    maxTokens: certificate.maxTokens, maxResults: 1, paidProcessingAllowed: profile.processing === 'paid' }, authorised, settle: async () => undefined }
  if (profile.processing === 'non-billable') return route
  const policy = await port.maintenancePolicy()
  if (!authorised()) throw new Error('POLICY_REFUSED: memory consent changed during budget preparation.')
  return prepareMaintenanceRoute(route, {
    id: `${job.operation.id}:${operation}:${reconciliation ? job.operation.reconciliationAttempts ?? 0 : job.operation.attempts}`,
    scope: certificate.scope, connectionId: connection.id, policyRevision: policy.revision,
    purpose: operation === 'read' ? 'retrieval' : operation === 'upsert' ? 'ingestion' : 'deletion', estimateMicros: profile.estimateMicros, boundedOperation: true,
  }, job.operation.id, port.maintenance, signal)
}
