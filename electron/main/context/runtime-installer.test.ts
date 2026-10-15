import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
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
  expect(health).toHaveBeenCalledTimes(2)
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
  expect(health).toHaveBeenCalledTimes(2)
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

it('refuses crossed runtime/data metadata before rollback health can launch a binary', async () => {
  const { installer, profile, root, health, fetcher } = await fixture()
  const first = await installer.install()
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  const second = await update.install(), calls = health.mock.calls.length
  const crossed = { ...first, providerVersion: '99' }
  await writeFile(join(root, 'previous.json'), JSON.stringify(crossed))
  await expect(update.canRollback()).rejects.toThrow('does not match')
  await expect(update.rollback()).rejects.toThrow('does not match')
  expect(health).toHaveBeenCalledTimes(calls)
  expect(await update.current()).toEqual(second)
  expect(await readFile(join(root, first.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
})

it('recognises compatible pair metadata after JSON field ordering changes', async () => {
  const { installer, root } = await fixture()
  const first = await installer.install()
  const reordered = Object.fromEntries(Object.entries(first).reverse())
  await writeFile(join(root, first.folder, 'installation.json'), JSON.stringify(reordered))
  expect(await installer.current()).toEqual(first)
})

it('preserves an interrupted activation pair when its installation record is missing', async () => {
  const { installer, root } = await fixture()
  const first = await installer.install()
  await rm(join(root, first.folder, 'installation.json'))
  await expect(installer.current()).rejects.toThrow('does not match')
  await expect(installer.install()).rejects.toThrow('does not match')
  expect(JSON.parse(await readFile(join(root, 'active.json'), 'utf8'))).toEqual(first)
  expect(await readFile(join(root, first.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
})

it('refuses rollback into another provider profile even when its pair metadata agrees', async () => {
  const { installer, profile, root, health, fetcher } = await fixture()
  const first = await installer.install()
  const foreign = { ...first, profileId: 'foreign-provider' }
  await writeFile(join(root, first.folder, 'installation.json'), JSON.stringify(foreign))
  await writeFile(join(root, 'previous.json'), JSON.stringify(foreign))
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  await expect(update.rollback()).rejects.toThrow('another provider profile')
  expect(health).toHaveBeenCalledTimes(2)
})

it('restores both pointers if the activated pair fails its health probe', async () => {
  const { installer, root, profile, health, fetcher } = await fixture()
  const first = await installer.install()
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  const second = await update.install()
  const failing = new RuntimeInstaller(root, { ...profile, version: '3' }, {
    fetcher, health: async (directory, installation, signal) => {
      await health(directory, installation, signal)
      if (directory.endsWith(installation.folder)) throw new Error('Synthetic activated-runtime failure')
    },
  })
  await expect(failing.install()).rejects.toThrow('activated-runtime failure')
  expect(await failing.current()).toEqual(second)
  expect(JSON.parse(await readFile(join(root, 'previous.json'), 'utf8'))).toEqual(first)
  expect(await failing.canRollback()).toBe(true)
  expect(await readFile(join(root, first.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('1')
  expect(await readFile(join(root, second.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('2')
  expect(await readdir(root)).not.toContain('activation.json')
})

it('recovers a killed activation before exposing a runtime to a new process', async () => {
  const { installer, root, profile, health, fetcher } = await fixture()
  const first = await installer.install()
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  const second = await update.install()
  // Both switch boundaries occur in practice: previous pointer has changed,
  // while active either still names the old pair or already names the new one.
  for (const active of [first, second]) {
    await writeFile(join(root, 'activation.json'), JSON.stringify({ version: 1, candidate: second, active: first, previous: null }))
    await writeFile(join(root, 'previous.json'), JSON.stringify(first))
    await writeFile(join(root, 'active.json'), JSON.stringify(active))
    const restarted = new RuntimeInstaller(root, profile, { health, fetcher })
    const calls = health.mock.calls.length
    expect(await restarted.canRollback()).toBe(false)
    expect(await restarted.current()).toEqual(first)
    expect(health).toHaveBeenCalledTimes(calls)
    expect(await readdir(root)).not.toContain('activation.json')
    expect(await readdir(root)).not.toContain('previous.json')
    expect(await readFile(join(root, second.folder, 'provider-data', 'synthetic-decision.txt'), 'utf8')).toBe('2')
  }
})

it('leaves a failed first activation uninstalled and recovers cancelled rollback', async () => {
  const { root, installer, profile, health, fetcher } = await fixture()
  const failing = new RuntimeInstaller(root, profile, { fetcher, health: async (directory, installation, signal) => {
    await health(directory, installation, signal)
    if (directory.endsWith(installation.folder)) throw new Error('ENOSPC: synthetic post-activation failure')
  } })
  await expect(failing.install()).rejects.toThrow('ENOSPC')
  expect(await failing.current()).toBeNull()
  const first = await installer.install()
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  const second = await update.install()
  const cancelled = new RuntimeInstaller(root, profile, { fetcher, health: async (...args) => {
    await health(...args)
    if (JSON.parse(await readFile(join(root, 'active.json'), 'utf8')).folder === first.folder) cancelled.cancel()
  } })
  await expect(cancelled.rollback()).rejects.toThrow()
  expect(await cancelled.current()).toEqual(second)
  expect(await cancelled.canRollback()).toBe(true)
})

it('checks installed bytes before rollback rather than trusting archive metadata', async () => {
  const { root, installer, profile, health, fetcher } = await fixture()
  const first = await installer.install()
  const update = new RuntimeInstaller(root, { ...profile, version: '2' }, { health, fetcher })
  const second = await update.install(), calls = health.mock.calls.length
  const artifact = first.artifacts[0]
  const file = join(root, first.folder, artifact.directory, artifact.root, 'license.txt')
  await writeFile(file, 'Damaged runtime')
  await expect(update.rollback()).rejects.toThrow('integrity failed')
  expect(health).toHaveBeenCalledTimes(calls)
  expect(await update.current()).toEqual(second)
  await rm(file)
  await symlink(join(root, second.folder, second.artifacts[0].directory, second.artifacts[0].root, 'license.txt'), file)
  await expect(update.verify(first)).rejects.toThrow('linked files')
})

it('never activates when the canonical backup fails and rejects health-time artifact mutation', async () => {
  const { root, installer, profile, health, fetcher } = await fixture()
  const first = await installer.install()
  const blocked = new RuntimeInstaller(root, profile, { health, fetcher, beforeActivate: async () => { throw new Error('Synthetic canonical backup failure') } })
  await expect(blocked.install()).rejects.toThrow('backup failure')
  expect(await blocked.current()).toEqual(first)
  const changed = new RuntimeInstaller(root, profile, { fetcher, health: async (directory, installation, signal) => {
    await health(directory, installation, signal)
    const artifact = installation.artifacts[0]
    await writeFile(join(directory, artifact.directory, artifact.root, 'license.txt'), 'Changed during health')
  } })
  await expect(changed.install()).rejects.toThrow('changed during health')
  expect(await changed.current()).toEqual(first)
})
