import type { MemoryRecord } from '../types'

export interface ProviderBinding {
  id: string
  scope: string
  adapter: 'mnemosyne' | 'hindsight'
  adapterVersion: string
  namespaceRef: string
  connectionRef: string
  policyRevision: number
  enabled: boolean
  writesCertified: boolean
}

export interface OutboxOperation {
  id: string
  bindingId: string
  scope: string
  canonicalId: string
  revision: number
  policyRevision: number
  operation: 'upsert' | 'delete'
  status: 'queued' | 'running' | 'pending' | 'confirmed' | 'failed' | 'cancelled'
  attempts: number
  createdAt: string
  nextAttemptAt: string
  leaseUntil?: string
  reconciliationAttempts?: number
  reason?: 'revoked' | 'superseded' | 'retry-limit' | 'provider-offline' | 'awaiting-completion' | 'reconciliation-limit'
}

export interface OutboxJob {
  operation: OutboxOperation
  binding: ProviderBinding
  record?: MemoryRecord
}

export type OutboxReceipt = { status: 'confirmed' } | { status: 'retry' } | { status: 'pending' }
