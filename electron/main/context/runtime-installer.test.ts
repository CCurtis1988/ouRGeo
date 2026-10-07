import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { create } from 'tar'
import { RuntimeInstaller, type InstallerHost, type RuntimeInstallProfile } from './runtime-installer'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-runtime-install-')); directories.push(directory)
  await mkdir(join(directory, 'bundle'))
  await writeFile(join(directory, 'bundle', 'license.txt'), 'Synthetic licence and runtime fixture; no executable')
  const file = join(directory, 'package.tar.gz')
  await create({ gzip: true, file, cwd: directory }, ['bundle'])
  const bytes = await readFile(file), hash = createHash('sha256').update(bytes).digest('hex')
  const profile: RuntimeInstallProfile = { id: 'synthetic-profile', version: '1', certification: 'pending', artifacts: [{ role: 'engine', archive: { url: 'https://codeload.github.com/synthetic/runtime/tar.gz/immutable', root: 'bundle', sha256: hash, maxBytes: 10000 } }] }
  const root = join(directory, 'private-installations')
  const health = vi.fn<InstallerHost['health']>(async (path, installation, signal) => {
    signal.throwIfAborted()
    const artifact = installation.artifacts[0]
    expect(await readFile(join(path, artifact.directory, artifact.root, 'license.txt'), 'utf8')).toContain('Synthetic licence')
    await mkdir(join(path, 'provider-data'), { recursive: true })
    await writeFile(join(path, 'provider-data', 'synthetic-decision.txt'), installation.providerVersion)
  })
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length), ETag: '"synthetic-archive"' } }))
  const beforeActivate = vi.fn<NonNullable<InstallerHost['beforeActivate']>>(async () => {})
  const installer = new RuntimeInstaller(root, profile, { health, beforeActivate, fetcher })
  return { directory, root, profile, bytes, health, fetcher, beforeActivate, installer }
}

it('deduplicates installation and activates only verified, healthy artifacts without certifying the provider', async () => {
  const { installer, root, health, beforeActivate, fetcher } = await fixture()
  const first = installer.install(), second = installer.install()
  expect(first).toBe(second)
  const installed = await first
  expect(installed.state).toBe('ready-for-certification')
  expect(installed.artifacts).toHaveLength(1)
  expect(await installer.current()).toEqual(installed)
  expect(health).toHaveBeenCalledOnce()
  expect(beforeActivate).toHaveBeenCalledOnce()
  expect(fetcher).toHaveBeenCalledOnce()
  expect((await readdir(root)).some(name => name.startsWith('.install-'))).toBe(false)
})

it('preserves the active runtime/data pair after failed health checks and restores a previous pair', async () => {
  const { installer, profile, root, health, fetcher } = await fixture()
  const first = await installer.install()
  expect(await installer.canRollback()).toBe(false)
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  health.mockRejectedValueOnce(new Error('Synthetic update health failure'))
  await expect(update.install()).rejects.toThrow('health failure')
  expect(await update.current()).toEqual(first)
  expect(await readFile(join(root, first.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
  const second = await update.install()
  expect(await update.canRollback()).toBe(true)
  expect(second.folder).not.toBe(first.folder)
  expect(await readFile(join(root, first.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
  expect(await readFile(join(root, second.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('2')
  expect(await update.rollback()).toEqual(first)
  expect(await update.current()).toEqual(first)
  expect(await update.canRollback()).toBe(false)
  expect(await readFile(join(root, second.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('2')
})

it('keeps cancellation and interrupted staging separate from committed provider data', async () => {
  const { installer, root, profile, health, fetcher } = await fixture()
  const original = await installer.install()
  const abandoned = join(root, '.install-abandoned')
  await mkdir(abandoned); await writeFile(join(abandoned, 'partial-runtime'), 'Abandoned staging')
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health: async (...args) => { await health(...args); update.cancel() }, fetcher })
  await expect(update.install()).rejects.toThrow()
  expect(await update.current()).toEqual(original)
  expect((await readdir(root)).some(name => name.startsWith('.install-'))).toBe(false)
  expect(await readFile(join(root, original.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
})

it('refuses a checksum mismatch before health or activation and preserves the existing pair', async () => {
  const { installer, root, profile, health, fetcher } = await fixture()
  const original = await installer.install()
  const damaged = new RuntimeInstaller(root, { ...profile, version: '2', artifacts: [{ ...profile.artifacts[0], archive: { ...profile.artifacts[0].archive, sha256: '0'.repeat(64) } }] }, { health, fetcher })
  await expect(damaged.install()).rejects.toThrow('checksum')
  expect(health).toHaveBeenCalledOnce()
  expect(await installer.current()).toEqual(original)
})

it('never overwrites malformed activation metadata or a live install lock', async () => {
  const { installer, root } = await fixture()
  await mkdir(root)
  const metadata = JSON.stringify({ folder: '../../foreign', version: 1 })
  await writeFile(join(root, 'active.json'), metadata)
  await expect(installer.install()).rejects.toThrow('metadata')
  expect(await readFile(join(root, 'active.json'), 'utf8')).toBe(metadata)
  await rm(join(root, 'active.json'))
  await writeFile(join(root, '.install-lock'), JSON.stringify({ pid: process.pid, nonce: crypto.randomUUID() }))
  await expect(installer.install()).rejects.toThrow('Another runtime installation')
})
