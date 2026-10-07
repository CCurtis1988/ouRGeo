import { expect, it, vi } from 'vitest'
import { createManagedMnemosyne, type CanonicalSnapshot, type CanonicalSnapshotPort } from './managed-mnemosyne'
import type { MemoryRuntime } from '../runtimes'
import type { ProviderHost } from '../../../../src/lib/context/providers/types'
import type { MemoryRecord } from '../../../../src/lib/context/types'

function fixture() {
  const host: ProviderHost = { namespace: crypto.randomUUID(), signal: new AbortController().signal, timeoutMs: 5000, policyRevision: 1, maxTokens: 2000, maxResults: 5, idempotencyKey: crypto.randomUUID(), paidProcessingAllowed: false, authorised: () => true }
  const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'preference', statement: 'Use metric units.', evidence: [], assertion: 'user-declared', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', status: 'active', supersedes: [] }
  const snapshot: CanonicalSnapshot = { namespace: host.namespace, generation: 7, records: [record] }
  const port: CanonicalSnapshotPort = { snapshot: vi.fn(async () => snapshot), current: vi.fn(async () => true) }
  const request = vi.fn<MemoryRuntime['request']>(async () => ({ generation: snapshot.generation, count: snapshot.records.length, idempotent: false }))
  const runtime = { request } as unknown as MemoryRuntime
  return { host, record, snapshot, port, request, runtime, adapter: createManagedMnemosyne('synthetic', runtime, port) }
}

it('keeps managed writes unsupported without a host-owned canonical snapshot port', async () => {
  const { host, record, runtime, request } = fixture()
  const provider = createManagedMnemosyne('synthetic', runtime)
  expect(provider.capabilities.upsert).toBe(false)
  expect(await provider.dispatch({ operation: 'upsert', records: [record] }, host)).toMatchObject({ status: 'failed', code: 'UNSUPPORTED' })
  expect(request).not.toHaveBeenCalled()
})

it('rebuilds only committed host records and returns canonical receipts instead of request extras', async () => {
  const { adapter, host, record, request } = fixture()
  const result = await adapter.dispatch({ operation: 'upsert', records: [{ ...record, arbitraryEndpoint: 'https://untrusted.invalid' } as MemoryRecord] }, host)
  expect(result).toMatchObject({ status: 'ok', complete: true, records: [record] })
  expect(JSON.stringify(result)).not.toContain('arbitraryEndpoint')
  expect(request).toHaveBeenCalledWith({ operation: 'replace', namespace: host.namespace, generation: 7, records: [{ id: record.id, revision: 1, text: record.statement, updatedAt: record.updatedAt }] }, host)
})

it('refuses foreign namespaces, uncommitted revisions and content whose receipt exceeds budget before native dispatch', async () => {
  const { adapter, host, record, snapshot, request } = fixture()
  snapshot.namespace = crypto.randomUUID()
  expect(await adapter.dispatch({ operation: 'upsert', records: [record] }, host)).toMatchObject({ status: 'failed', code: 'POLICY_REFUSED' })
  snapshot.namespace = host.namespace
  expect(await adapter.dispatch({ operation: 'upsert', records: [{ ...record, revision: 2 }] }, host)).toMatchObject({ status: 'failed', code: 'POLICY_REFUSED' })
  record.statement = '測定'.repeat(1000)
  expect(await adapter.dispatch({ operation: 'upsert', records: [record] }, host)).toMatchObject({ status: 'failed', code: 'BUDGET_LIMIT' })
  expect(request).not.toHaveBeenCalled()
})

it('deletes through a complete replacement only after the canonical record is removed', async () => {
  const { adapter, host, record, snapshot, request } = fixture()
  expect(await adapter.dispatch({ operation: 'delete', ids: [record.id] }, host)).toMatchObject({ status: 'failed', code: 'POLICY_REFUSED' })
  expect(request).not.toHaveBeenCalled()
  snapshot.records = []; snapshot.generation++
  expect(await adapter.dispatch({ operation: 'delete', ids: [record.id] }, host)).toMatchObject({ status: 'ok', records: [], complete: true })
  expect(request).toHaveBeenCalledWith({ operation: 'replace', namespace: host.namespace, generation: 8, records: [] }, host)
})

it('rejects a changed canonical revision or revocation even if native replacement already completed', async () => {
  const { adapter, host, record, port, request } = fixture()
  vi.mocked(port.current).mockResolvedValueOnce(false)
  expect(await adapter.dispatch({ operation: 'upsert', records: [record] }, host)).toMatchObject({ status: 'failed', code: 'POLICY_REFUSED' })
  expect(request).not.toHaveBeenCalled()
  vi.mocked(port.current).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  expect(await adapter.dispatch({ operation: 'upsert', records: [record] }, host)).toMatchObject({ status: 'failed', code: 'POLICY_REFUSED' })
  expect(request).toHaveBeenCalledOnce()
})

it('refuses stale or invented provider evidence instead of treating it as current canonical memory', async () => {
  const { adapter, host, record, request } = fixture()
  request.mockResolvedValueOnce({ generation: 6, evidence: [{ id: record.id, text: record.statement, revision: 1, updatedAt: record.updatedAt }], complete: true })
  expect(await adapter.dispatch({ operation: 'read', id: record.id }, host)).toMatchObject({ status: 'failed', code: 'INVALID_RESPONSE' })
  request.mockResolvedValueOnce({ generation: 7, evidence: [{ id: record.id, text: 'The provider invented this preference.', revision: 1, updatedAt: record.updatedAt }], complete: true })
  expect(await adapter.dispatch({ operation: 'read', id: record.id }, host)).toMatchObject({ status: 'failed', code: 'INVALID_RESPONSE' })
})
