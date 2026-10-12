import type { MemoryRecord } from '../types'
import type { MemoryProviderDef, ProviderHost, ProviderRequest, ProviderResult } from './types'
import { providerDescriptorIssues, providerResponseIssues } from './validation'

type Scope = 'first' | 'second'
export interface ConformanceScope {
  /** Must be fresh synthetic namespaces, never a personal/project binding. */
  isolatedFixture: true
  /** Optional project identity for exercising portable project records. */
  projectId?: string
  provider: MemoryProviderDef
  host: (operationId: string) => ProviderHost
  commitCanonical: (records: MemoryRecord[]) => Promise<void>
}
export interface ConformanceHarness {
  writesAcknowledged: boolean
  scopes: Record<Scope, ConformanceScope>
}
export interface ConformanceReport {
  version: 1
  certification: 'not-issued'
  checks: { name: string; status: 'passed' | 'failed' | 'unsupported'; reason?: string }[]
}

/** Execute only explicitly acknowledged synthetic fixtures. Results are useful
 * certification evidence, not certification: deployment processing, native
 * isolation, deletion of derivatives and billing limits need separate audits. */
export async function runProviderConformance(harness: ConformanceHarness): Promise<ConformanceReport> {
  if (!harness.writesAcknowledged || Object.values(harness.scopes).some(scope => scope.isolatedFixture !== true)) throw new Error('Synthetic write fixtures require an acknowledged isolated harness.')
  if (Object.values(harness.scopes).some(scope => providerDescriptorIssues(scope.provider).length)) throw new Error('The provider descriptor does not satisfy API version 1.')
  if (Object.values(harness.scopes).some(scope => scope.projectId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(scope.projectId))) throw new Error('Fixture project identities must be UUIDs.')
  const firstHost = harness.scopes.first.host(crypto.randomUUID()), secondHost = harness.scopes.second.host(crypto.randomUUID())
  if (firstHost.namespace === secondHost.namespace) throw new Error('Conformance namespaces must be distinct.')
  const report: ConformanceReport = { version: 1, certification: 'not-issued', checks: [] }
  const fixture = (statement: string, scope: Scope): MemoryRecord => ({ id: crypto.randomUUID(), revision: 1, scope: harness.scopes[scope].projectId ? 'project' : 'global', projectId: harness.scopes[scope].projectId ?? null, category: 'preference', statement,
    evidence: [], assertion: 'user-declared', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'active', supersedes: [] })
  const marker = crypto.randomUUID()
  const original = fixture(`Synthetic conformance ${marker}: metric units.`, 'first'), keeper = fixture(`Synthetic retained ${marker}: CSV output.`, 'first'), other = fixture(`Synthetic separate ${marker}: plain text output.`, 'second')
  keeper.createdAt = keeper.updatedAt = '2026-01-03T00:00:00.000Z'
  const own: Record<Scope, string[]> = { first: [original.id, keeper.id], second: [other.id] }
  const check = async (name: string, action: () => Promise<void>): Promise<void> => {
    try { await action(); report.checks.push({ name, status: 'passed' }) }
    catch (error) { report.checks.push({ name, status: 'failed', reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CHECK_FAILED' }) }
  }
  const require = (condition: unknown, code: string): void => { if (!condition) throw new Error(code) }
  const call = async (scope: Scope, request: ProviderRequest, operationId = crypto.randomUUID(), override: Partial<ProviderHost> = {}): Promise<ProviderResult> => {
    const adapter = harness.scopes[scope], host = { ...adapter.host(operationId), ...override }
    require(host.namespace === (scope === 'first' ? firstHost.namespace : secondHost.namespace) && host.idempotencyKey === operationId, 'HARNESS_SCOPE_CHANGED')
    const controller = new AbortController()
    const signal = AbortSignal.any([host.signal, controller.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([adapter.provider.dispatch(request, { ...host, signal }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('PROVIDER_TIMEOUT')) }, Math.max(1, Math.min(15000, host.timeoutMs)))
      })])
      require(!providerResponseIssues(result, host).length, 'INVALID_RESPONSE')
      return result
    } finally { if (timer) clearTimeout(timer) }
  }
  const ok = (result: ProviderResult): boolean => result.status === 'ok' && result.complete
  const evidence = (result: ProviderResult, id: string, revision?: number): boolean => result.status !== 'failed'
    && (result.records.some(record => record.id === id && (revision === undefined || record.revision === revision))
      || Boolean(result.evidence?.some(item => (item.canonicalId ?? item.sourceId) === id && (revision === undefined || item.revision === revision))))
  const verified = (result: ProviderResult, id: string, revision?: number): boolean => ok(result) && evidence(result, id, revision)
  const absent = (result: ProviderResult, id: string): boolean => ok(result) && !evidence(result, id)
  const optional = async (name: string, supported: boolean, action: () => Promise<void>): Promise<void> => {
    if (supported) await check(name, action)
    else report.checks.push({ name, status: 'unsupported', reason: 'CAPABILITY_UNAVAILABLE' })
  }

  await check('probe and response contract', async () => { require(ok(await call('first', { operation: 'probe' })), 'PROBE_FAILED') })
  await check('permission revocation', async () => { const result = await call('first', { operation: 'search', query: marker }, undefined, { authorised: () => false }); require(result.status === 'failed' && result.code === 'POLICY_REFUSED', 'REVOCATION_IGNORED') })
  await check('cancellation', async () => { const controller = new AbortController(); controller.abort(); require((await call('first', { operation: 'search', query: marker }, undefined, { signal: controller.signal })).status === 'failed', 'CANCELLATION_IGNORED') })
  if (Object.values(harness.scopes).some(scope => !scope.provider.capabilities.upsert || !scope.provider.capabilities.deleteBySource || !scope.provider.capabilities.readById || scope.provider.capabilities.scopeIsolation === 'unsupported')) {
    report.checks.push({ name: 'write lifecycle', status: 'unsupported', reason: 'READ_ONLY_CAPABILITIES' })
    return report
  }
  try {
    await check('canonical ingestion and idempotent retry', async () => {
      await harness.scopes.first.commitCanonical([original, keeper])
      await harness.scopes.second.commitCanonical([other])
      const operationId = crypto.randomUUID()
      require(ok(await call('first', { operation: 'upsert', records: [original, keeper] }, operationId)), 'INGESTION_FAILED')
      require(ok(await call('first', { operation: 'upsert', records: [original, keeper] }, operationId)), 'RETRY_FAILED')
      require(ok(await call('second', { operation: 'upsert', records: [other] })), 'INGESTION_FAILED')
      require(verified(await call('first', { operation: 'read', id: original.id }), original.id, 1), 'READ_FAILED')
    })
    await check('namespace isolation', async () => {
      const read = await call('second', { operation: 'read', id: original.id })
      require(absent(read, original.id) || read.status === 'failed' && read.code === 'POLICY_REFUSED', 'CROSS_SCOPE_READ')
      const found = await call('second', { operation: 'search', query: marker })
      require(ok(found) && evidence(found, other.id) && !evidence(found, original.id) && !evidence(found, keeper.id), 'CROSS_SCOPE_SEARCH')
    })
    await check('bounded response', async () => {
      const result = await call('first', { operation: 'search', query: marker }, undefined, { maxResults: 1, maxTokens: 256 })
      require(result.status !== 'failed' || result.code === 'BUDGET_LIMIT', 'BOUNDED_READ_FAILED')
    })
    await check('revision replacement', async () => {
      const corrected = { ...original, statement: `Synthetic conformance ${marker}: miles.`, revision: 2, updatedAt: '2026-01-02T00:00:00.000Z' }
      await harness.scopes.first.commitCanonical([corrected, keeper])
      require(ok(await call('first', { operation: 'upsert', records: [corrected] })), 'UPDATE_FAILED')
      const read = await call('first', { operation: 'read', id: original.id })
      require(verified(read, original.id, 2) && !JSON.stringify(read).includes('metric units'), 'STALE_REVISION')
    })
    await optional('temporal search', harness.scopes.first.provider.capabilities.temporalSearch, async () => {
      const found = await call('first', { operation: 'search', query: marker, after: '2026-01-02T12:00:00.000Z', before: '2026-01-04T00:00:00.000Z' })
      require(ok(found) && evidence(found, keeper.id) && !evidence(found, original.id), 'TEMPORAL_FILTER_IGNORED')
    })
    await optional('scoped export', harness.scopes.first.provider.capabilities.export, async () => {
      const exported = await call('first', { operation: 'export' })
      require(verified(exported, original.id, 2) && evidence(exported, keeper.id) && !evidence(exported, other.id), 'EXPORT_INCOMPLETE_OR_CROSS_SCOPE')
    })
    await optional('reflection permission', harness.scopes.first.provider.capabilities.reflection, async () => {
      const denied = await call('first', { operation: 'reflect', query: marker }, undefined, { paidProcessingAllowed: false })
      require(denied.status === 'failed' && denied.code === 'POLICY_REFUSED', 'REFLECTION_PERMISSION_IGNORED')
    })
    await optional('reflection lineage', harness.scopes.first.provider.capabilities.reflection && harness.scopes.first.host(crypto.randomUUID()).paidProcessingAllowed, async () => {
      // The synthetic write acknowledgement does not grant paid reflection.
      // An approved host fixture must separately reserve that processing.
      const reflected = await call('first', { operation: 'reflect', query: marker })
      require(ok(reflected) && Boolean(reflected.status === 'ok' && reflected.evidence?.length
        && reflected.evidence.every(item => item.sourceIds?.length && item.sourceIds.every(id => [original.id, keeper.id].includes(id)))), 'REFLECTION_LINEAGE_UNVERIFIED')
    })
    await check('source deletion preserves unrelated records', async () => {
      await harness.scopes.first.commitCanonical([keeper])
      const request = { operation: 'delete', ids: [original.id] } as const
      const operationId = crypto.randomUUID()
      require(ok(await call('first', { ...request, ids: [...request.ids] }, operationId)), 'DELETE_FAILED')
      require(ok(await call('first', { ...request, ids: [...request.ids] }, operationId)), 'DELETE_RETRY_FAILED')
      require(absent(await call('first', { operation: 'read', id: original.id }), original.id), 'DELETION_UNVERIFIED')
      require(absent(await call('first', { operation: 'search', query: marker }), original.id), 'DELETION_UNVERIFIED')
      require(verified(await call('first', { operation: 'read', id: keeper.id }), keeper.id) && verified(await call('second', { operation: 'read', id: other.id }), other.id), 'UNRELATED_RECORD_REMOVED')
    })
    await optional('scope deletion and idempotent retry', harness.scopes.first.provider.capabilities.deleteScope, async () => {
      await harness.scopes.first.commitCanonical([])
      const operationId = crypto.randomUUID()
      require(ok(await call('first', { operation: 'delete-scope' }, operationId)), 'SCOPE_DELETE_FAILED')
      require(ok(await call('first', { operation: 'delete-scope' }, operationId)), 'SCOPE_DELETE_RETRY_FAILED')
      for (const id of own.first) require(absent(await call('first', { operation: 'read', id }), id), 'SCOPE_DELETION_UNVERIFIED')
      require(verified(await call('second', { operation: 'read', id: other.id }), other.id), 'OTHER_SCOPE_REMOVED')
    })
  } finally {
    for (const scope of ['first', 'second'] as const) await check(`cleanup ${scope}`, async () => {
      await harness.scopes[scope].commitCanonical([])
      require(ok(await call(scope, { operation: 'delete', ids: own[scope] })), 'CLEANUP_FAILED')
      for (const id of own[scope]) require(absent(await call(scope, { operation: 'read', id } ), id), 'CLEANUP_UNVERIFIED')
    })
  }
  return report
}
