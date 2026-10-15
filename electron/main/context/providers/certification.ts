import { randomUUID } from 'node:crypto'
import type { MemoryConnection } from '../../../../src/lib/context/providers/connections'
import type { ProviderBinding } from '../../../../src/lib/context/providers/outbox'
import type { ConformanceReport } from '../../../../src/lib/context/providers/conformance'
import { connectionDigest, type CertifiedOperation, type ProviderCertificate } from './routing'
import { HINDSIGHT_PROFILE } from './hindsight'
import { MNEMOSYNE_LOCAL_CANDIDATE } from '../runtime-catalogue'

const requiredChecks = ['probe and response contract', 'permission revocation', 'cancellation', 'canonical ingestion and idempotent retry', 'namespace isolation', 'bounded response', 'revision replacement', 'source deletion preserves unrelated records', 'cleanup first', 'cleanup second']
const requiredAudits = ['authenticated-transport', 'scope-access-control', 'derivative-deletion', 'processing-destinations', 'bounded-billing', 'recovery'] as const
type Audit = typeof requiredAudits[number]
export interface DeploymentReview {
  id: string
  adapter: 'hindsight' | 'mnemosyne'
  adapterVersion: string
  providerId: 'hindsight' | 'mnemosyne-managed' | 'mnemosyne-local-server'
  connectionDigest: string
  connectionId?: string
  reviewedAt: string
  expiresAt: string
  /** Host/release-reviewed evidence, not endpoint assertions or UI ticks. */
  audits: Record<Audit, { status: 'passed'; evidenceSha256: string }>
  conformance: ConformanceReport
  isolation: ProviderCertificate['isolation']
  operations: ProviderCertificate['operations']
  timeoutMs: number
  maxTokens: number
}
const hash = (input: unknown): boolean => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input)
const current = (date: string, now: number): boolean => Number.isFinite(Date.parse(date)) && Date.parse(date) > now
function bounded(profile: CertifiedOperation | undefined, now: number): boolean {
  return Boolean(profile && (profile.processing === 'non-billable' || profile.processing === 'paid'
    && profile.boundedOperation === true && Number.isSafeInteger(profile.estimateMicros) && profile.estimateMicros > 0 && profile.estimateMicros <= 1e12
    && /^[a-zA-Z0-9_.:-]{1,128}$/.test(profile.pricingVersion) && current(profile.pricingExpiresAt, now)))
}

/** Only host-authored reviewed inputs enter this registry. No IPC, bundle,
 * downloaded manifest or probe can add a review. Keeping it empty is valid. */
export class DeploymentRegistry {
  private reviews: DeploymentReview[]
  constructor(reviewed: readonly DeploymentReview[], private now: () => number = Date.now, private eligible: (connection: MemoryConnection) => boolean = () => true) {
    if (reviewed.length > 32 || new Set(reviewed.map(review => review.id)).size !== reviewed.length) throw new Error('Review the bounded deployment registry before activating providers.')
    this.reviews = structuredClone([...reviewed])
  }
  available(): boolean { return this.reviews.length > 0 }
  withdraw(connectionId: string): void { this.reviews = this.reviews.filter(review => review.connectionId !== connectionId) }
  /** Privileged managed-profile review only; no renderer import API exists. */
  registerManaged(review: DeploymentReview): void {
    const others = this.reviews.filter(item => item.connectionDigest !== review.connectionDigest && (!review.connectionId || item.connectionId !== review.connectionId))
    if (!review.connectionId || !/^[a-f0-9-]{36}$/i.test(review.connectionId) || review.adapter !== 'mnemosyne' || review.providerId !== 'mnemosyne-managed' || others.length >= 32) throw new Error('Use a bounded reviewed managed deployment.')
    this.reviews = [...others, structuredClone(review)]
  }
  /** Owned and tested loopback bridge only; no public review import API. */
  registerLocalServer(review: DeploymentReview): void {
    const others = this.reviews.filter(item => item.connectionDigest !== review.connectionDigest && (!review.connectionId || item.connectionId !== review.connectionId))
    if (!review.connectionId || !/^[a-f0-9-]{36}$/i.test(review.connectionId) || review.adapter !== 'mnemosyne' || review.providerId !== 'mnemosyne-local-server' || others.length >= 32) throw new Error('Use the reviewed authenticated local-server profile.')
    this.reviews = [...others, structuredClone(review)]
  }
  /** Native verifier of the pinned operator-started local chunks server. */
  registerLocalHindsight(review: DeploymentReview): void {
    const others = this.reviews.filter(item => item.connectionId !== review.connectionId)
    if (!review.connectionId || !/^[a-f0-9-]{36}$/i.test(review.connectionId) || review.adapter !== 'hindsight' || review.providerId !== 'hindsight' || others.length >= 32) throw new Error('Use the reviewed dedicated Hindsight profile.')
    this.reviews = [...others, structuredClone(review)]
  }
  review(connection: MemoryConnection): DeploymentReview | undefined {
    if (!this.eligible(connection)) return undefined
    const now = this.now(), digest = connectionDigest(connection)
    const found = this.reviews.find(review => review.connectionDigest === digest)
    if (!found || !/^[a-zA-Z0-9_.:-]{1,96}$/.test(found.id) || !hash(found.connectionDigest)
      || found.adapter !== connection.adapter || found.connectionId !== undefined && found.connectionId !== connection.id
      || (found.adapter === 'hindsight' ? found.providerId !== 'hindsight' || found.adapterVersion !== HINDSIGHT_PROFILE.commit || connection.location === 'managed-local'
        : found.adapterVersion !== MNEMOSYNE_LOCAL_CANDIDATE.provider.commit || connection.runtimeId !== MNEMOSYNE_LOCAL_CANDIDATE.id
          || (connection.localServer ? found.providerId !== 'mnemosyne-local-server' || connection.location !== 'loopback' || !connection.credentialRef : found.providerId !== 'mnemosyne-managed' || connection.location !== 'managed-local'))
      || !Number.isFinite(Date.parse(found.reviewedAt)) || Date.parse(found.reviewedAt) > now || !current(found.expiresAt, now)
      || Date.parse(found.expiresAt) - Date.parse(found.reviewedAt) > 90 * 86400_000
      || !['native', 'dedicated-instance'].includes(found.isolation)
      || !Number.isSafeInteger(found.timeoutMs) || found.timeoutMs < 100 || found.timeoutMs > 15000
      || !Number.isSafeInteger(found.maxTokens) || found.maxTokens < 256 || found.maxTokens > 8000
      || !found.audits || requiredAudits.some(name => found.audits[name]?.status !== 'passed' || !hash(found.audits[name]?.evidenceSha256))
      || found.conformance?.version !== 1 || found.conformance.certification !== 'not-issued' || !Array.isArray(found.conformance.checks)
      || found.conformance.checks.length > 32 || new Set(found.conformance.checks.map(check => check.name)).size !== found.conformance.checks.length
      || found.conformance.checks.some(check => check.status === 'failed') || requiredChecks.some(name => !found.conformance.checks.some(check => check.name === name && check.status === 'passed'))
      || !found.operations || !(['read', 'upsert', 'delete'] as const).every(operation => bounded(found.operations[operation], now))
      || (found.adapter === 'hindsight' ? connection.localProfile === 'hindsight-local-chunks-v1'
        ? connection.location !== 'loopback' || !connection.credentialRef || !connection.profileDirectory || (['search', 'read', 'upsert', 'delete'] as const).some(operation => found.operations[operation]?.processing !== 'non-billable')
        : found.operations.upsert?.processing !== 'paid'
        : (['search', 'read', 'upsert', 'delete'] as const).some(operation => found.operations[operation]?.processing !== 'non-billable'))
      || connection.state !== 'reachable' || connection.destinations.length !== 7 || connection.destinations.some(item => item.destination === 'unknown')) return undefined
    return structuredClone(found)
  }
  certificate(connection: MemoryConnection, binding: ProviderBinding): ProviderCertificate | undefined {
    const review = this.review(connection)
    if (!review || !binding.enabled || !binding.writesCertified || binding.connectionRef !== connection.id || binding.adapterVersion !== review.adapterVersion
      || binding.adapter !== review.adapter || binding.scope !== connection.scope || binding.namespaceRef !== connection.namespaceRef) return undefined
    return { id: `${review.id}:${binding.policyRevision}`, bindingId: binding.id, bindingPolicyRevision: binding.policyRevision, connectionId: connection.id,
      connectionDigest: review.connectionDigest, adapterVersion: review.adapterVersion, providerId: review.providerId, scope: connection.scope,
      isolation: review.isolation, expiresAt: review.expiresAt, timeoutMs: review.timeoutMs, maxTokens: review.maxTokens, operations: binding.cleanupOnly ? { delete: review.operations.delete } : review.operations }
  }
  binding(connection: MemoryConnection): ProviderBinding {
    const review = this.review(connection)
    if (!review) throw new Error('PROVIDER_UNCERTIFIED: complete deployment review before activating personal memory.')
    return { id: randomUUID(), scope: connection.scope, adapter: connection.adapter, adapterVersion: review.adapterVersion,
      connectionRef: connection.id, namespaceRef: connection.namespaceRef, policyRevision: 1, enabled: true, writesCertified: true }
  }
}

// No reviewed external deployment has been delivered. Synthetic fixtures and
// source/API pins must never masquerade as a personal-memory approval.
export const REVIEWED_EXTERNAL_DEPLOYMENTS: readonly DeploymentReview[] = []
