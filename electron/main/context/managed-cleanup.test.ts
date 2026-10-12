import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ManagedMnemosyneRuntime } from './managed-runtime'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
it('forgets disconnected derived copies in every installed pair without removing another namespace or runtime assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ourgeo-managed-forget-')); directories.push(root)
  const namespace = crypto.randomUUID(), other = crypto.randomUUID()
  const folders = [`installed_${crypto.randomUUID()}`, `installed_${crypto.randomUUID()}`]
  for (const folder of folders) {
    await mkdir(join(root, folder, 'derived'), { recursive: true })
    await writeFile(join(root, folder, 'runtime.asset'), 'synthetic immutable runtime')
    for (const suffix of ['', '-wal', '-shm', '-journal', '.init.lock']) await writeFile(join(root, folder, 'derived', `${namespace}.sqlite${suffix}`), 'synthetic forgotten cache')
    await writeFile(join(root, folder, 'derived', `${other}.sqlite`), 'synthetic other scope')
  }
  const runtime = new ManagedMnemosyneRuntime(root, 'unused')
  await runtime.forgetDerived([namespace])
  await runtime.forgetDerived([namespace])
  expect(runtime.isRunning()).toBe(false)
  for (const folder of folders) {
    expect(await readdir(join(root, folder, 'derived'))).toEqual([`${other}.sqlite`])
    expect(await readFile(join(root, folder, 'runtime.asset'), 'utf8')).toBe('synthetic immutable runtime')
  }
})
it('refuses linked runtime directories and arbitrary namespace paths before deleting bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ourgeo-managed-forget-')); directories.push(root)
  const outside = join(root, 'synthetic-other-directory'); await mkdir(outside)
  const namespace = crypto.randomUUID(); await writeFile(join(outside, 'retained'), 'must remain')
  await symlink(outside, join(root, `installed_${crypto.randomUUID()}`))
  const runtime = new ManagedMnemosyneRuntime(root, 'unused')
  await expect(runtime.forgetDerived(['../retained'])).rejects.toThrow()
  await expect(runtime.forgetDerived([namespace])).rejects.toThrow('private runtime directories')
  expect(await readFile(join(outside, 'retained'), 'utf8')).toBe('must remain')
})
