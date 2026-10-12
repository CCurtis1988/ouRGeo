import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { MemoryConnection } from '../../../src/lib/context/providers/connections'
import type { RuntimeInstallation } from './runtime-installer'
import { MNEMOSYNE_LOCAL_CANDIDATE as candidate } from './runtime-catalogue'
import { managedDeploymentReview } from './managed-profile'
import { DeploymentRegistry } from './providers/certification'

function fixture() {
  const connection: MemoryConnection = { id: randomUUID(), revision: 1, adapter: 'mnemosyne', label: 'Synthetic local fixture', endpoint: 'on-device', location: 'managed-local', runtimeId: candidate.id, scope: 'global', namespaceRef: randomUUID(), credentialRef: null,
    state: 'reachable', certification: 'pending', createdAt: new Date().toISOString(), destinations: (['storage', 'embeddings', 'reranking', 'extraction', 'reflection', 'telemetry', 'sync'] as const).map(purpose => ({ purpose, destination: purpose === 'storage' ? 'on-device' : 'disabled' })) }
  const installed: RuntimeInstallation = { version: 1, profileId: candidate.id, providerVersion: candidate.provider.engineVersion, folder: `installed_${randomUUID()}`, createdAt: new Date().toISOString(), state: 'ready-for-certification',
    artifacts: [{ role: 'python', directory: 'synthetic-python', root: candidate.python.profiles['linux-x64'].root, sha256: candidate.python.profiles['linux-x64'].sha256 }, { role: 'engine', directory: 'synthetic-engine', root: candidate.provider.archive.root, sha256: candidate.provider.archive.sha256 }, { role: 'yaml', directory: 'synthetic-yaml', root: candidate.yaml.archive.root, sha256: candidate.yaml.archive.sha256 }] }
  return { connection, installed }
}

it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')('reviews only the fixture-tested private lexical profile and creates no paid permission', async () => {
  const { connection, installed } = fixture()
  const review = await managedDeploymentReview(connection, installed, 'electron/main/context/mnemosyne-sidecar.py')
  const registry = new DeploymentRegistry([]); registry.registerManaged(review)
  const binding = registry.binding(connection), certificate = registry.certificate(connection, binding)!
  expect(certificate).toMatchObject({ providerId: 'mnemosyne-managed', isolation: 'dedicated-instance', operations: { read: { processing: 'non-billable' }, upsert: { processing: 'non-billable' }, delete: { processing: 'non-billable' } } })
  expect(certificate.scope).toBe('global')
})

it.skipIf(process.platform !== 'linux' || process.arch !== 'x64').each(['artifact', 'root', 'version', 'processing', 'runtime', 'bridge'] as const)('refuses %s drift before granting managed write capabilities', async change => {
  const { connection, installed } = fixture()
  if (change === 'artifact') installed.artifacts[0].sha256 = 'a'.repeat(64)
  if (change === 'root') installed.artifacts[0].root = 'different-runtime'
  if (change === 'version') installed.providerVersion = 'unreviewed-release'
  if (change === 'processing') connection.destinations[1].destination = 'https://embedding.example.invalid'
  if (change === 'runtime') connection.runtimeId = 'different-runtime'
  await expect(managedDeploymentReview(connection, installed, change === 'bridge' ? 'electron/main/context/worker.ts' : 'electron/main/context/mnemosyne-sidecar.py')).rejects.toThrow('PROVIDER_UNCERTIFIED')
})
