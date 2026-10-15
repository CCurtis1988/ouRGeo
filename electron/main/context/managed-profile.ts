import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import evidence from '../../../docs/context-mnemosyne-linux-evidence.json'
import { MNEMOSYNE_LOCAL_CANDIDATE as candidate } from './runtime-catalogue'
import type { RuntimeInstallation } from './runtime-installer'
import type { MemoryConnection } from '../../../src/lib/context/providers/connections'
import type { ConformanceReport } from '../../../src/lib/context/providers/conformance'
import type { DeploymentReview } from './providers/certification'
import { connectionDigest } from './providers/routing'
import serverEvidence from '../../../docs/context-mnemosyne-local-server-evidence.json'
import type { MnemosyneLocalServer } from './providers/local-server'

/** Experimental Linux lexical profile only. This release-reviewed fixture
 * evidence is bundled code, never a runtime response or downloaded manifest.
 * Other platforms, embeddings, reflection and external processing stay off. */
export async function managedDeploymentReview(connection: MemoryConnection, installed: RuntimeInstallation, bridgeFile: string): Promise<DeploymentReview> {
  const bridge = createHash('sha256').update(await readFile(bridgeFile)).digest('hex')
  const artifacts = [{ role: 'python', sha256: candidate.python.profiles['linux-x64'].sha256, root: candidate.python.profiles['linux-x64'].root }, { role: 'engine', sha256: candidate.provider.archive.sha256, root: candidate.provider.archive.root }, { role: 'yaml', sha256: candidate.yaml.archive.sha256, root: candidate.yaml.archive.root }]
  if (process.platform !== 'linux' || process.arch !== 'x64' || evidence.version !== 1 || evidence.profile !== candidate.id || bridge !== evidence.bridgeSha256
    || !evidence.networkObservation.positiveControl || evidence.networkObservation.networkSyscalls !== 0 || evidence.networkObservation.runtimeLaunches < 5
    || evidence.derivativeAudit.residualIds !== 0 || evidence.derivativeAudit.temporaryCopies !== 0 || evidence.derivativeAudit.removedSourceIds < 4
    || evidence.conformance.checks.some(check => check.status === 'failed') || installed.profileId !== candidate.id || installed.providerVersion !== candidate.provider.engineVersion
    || installed.artifacts.length !== 3 || artifacts.some(expected => !installed.artifacts.some(actual => actual.role === expected.role && actual.sha256 === expected.sha256 && actual.root === expected.root))
    || connection.location !== 'managed-local' || connection.runtimeId !== candidate.id || connection.adapter !== 'mnemosyne' || connection.endpoint !== 'on-device'
    || connection.destinations.some(item => item.destination !== (item.purpose === 'storage' ? 'on-device' : 'disabled'))) throw new Error('PROVIDER_UNCERTIFIED: restage and review the exact experimental Linux lexical runtime.')
  const hash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
  return { id: 'managed-linux-lexical-review-v1', adapter: 'mnemosyne', adapterVersion: candidate.provider.commit, providerId: 'mnemosyne-managed', connectionId: connection.id, connectionDigest: connectionDigest(connection),
    reviewedAt: evidence.observedAt, expiresAt: new Date(Date.parse(evidence.observedAt) + 90 * 86400_000).toISOString(), isolation: 'dedicated-instance', timeoutMs: 15000, maxTokens: 2000,
    conformance: evidence.conformance as ConformanceReport,
    audits: { 'authenticated-transport': { status: 'passed', evidenceSha256: hash }, 'scope-access-control': { status: 'passed', evidenceSha256: hash }, 'derivative-deletion': { status: 'passed', evidenceSha256: hash },
      'processing-destinations': { status: 'passed', evidenceSha256: hash }, 'bounded-billing': { status: 'passed', evidenceSha256: hash }, recovery: { status: 'passed', evidenceSha256: hash } },
    operations: { search: { processing: 'non-billable' }, read: { processing: 'non-billable' }, upsert: { processing: 'non-billable' }, delete: { processing: 'non-billable' } } }
}

export async function localServerDeploymentReview(connection: MemoryConnection, installed: RuntimeInstallation, bridgeFile: string, server: MnemosyneLocalServer): Promise<DeploymentReview> {
  if (!connection.localServer || !server.owns(connection) || serverEvidence.profile !== 'mnemosyne-local-server-v1' || serverEvidence.upstreamCommit !== candidate.provider.commit
    || serverEvidence.bridgeSha256 !== evidence.bridgeSha256 || !serverEvidence.recoveryVerified || serverEvidence.derivativeAudit.residualIds !== 0 || serverEvidence.derivativeAudit.temporaryCopies !== 0
    || !serverEvidence.authentication.invalidTokenRefused || !serverEvidence.authentication.crossNamespaceRefused || !serverEvidence.authentication.scopeRevocationPreservesOtherScope
    || !serverEvidence.networkObservation.positiveControl || serverEvidence.networkObservation.externalConnectAttempts !== 0 || serverEvidence.conformance.checks.some(check => check.status === 'failed')
    || connection.destinations.some(item => item.destination !== (item.purpose === 'storage' ? connection.endpoint : 'disabled'))) throw new Error('PROVIDER_UNCERTIFIED: start and review the owned authenticated Linux local-server profile.')
  const local = { ...connection, location: 'managed-local' as const, endpoint: 'on-device', credentialRef: null,
    destinations: connection.destinations.map(item => ({ ...item, destination: item.purpose === 'storage' ? 'on-device' : 'disabled' })) }
  const base = await managedDeploymentReview(local, installed, bridgeFile)
  const hash = createHash('sha256').update(JSON.stringify(serverEvidence)).digest('hex')
  return { ...base, id: 'local-server-linux-lexical-review-v1', providerId: 'mnemosyne-local-server', connectionDigest: connectionDigest(connection), reviewedAt: serverEvidence.observedAt,
    expiresAt: new Date(Date.parse(serverEvidence.observedAt) + 90 * 86400_000).toISOString(), conformance: serverEvidence.conformance as ConformanceReport,
    audits: Object.fromEntries(Object.keys(base.audits).map(name => [name, { status: 'passed', evidenceSha256: hash }])) as DeploymentReview['audits'] }
}
