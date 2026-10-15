import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hindsightDistribution } from './hindsight-profile'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-hindsight-integrity-')); directories.push(directory)
  await writeFile(join(directory, 'engine.py'), 'PINNED_APPLICATION_CODE')
  return directory
}
it('includes dependency code while ignoring generated interpreter caches', async () => {
  const directory = await fixture(), initial = await hindsightDistribution(directory)
  await mkdir(join(directory, '__pycache__')); await writeFile(join(directory, '__pycache__/engine.pyc'), 'GENERATED')
  expect(await hindsightDistribution(directory)).toEqual(initial)
  await writeFile(join(directory, 'engine.py'), 'CHANGED_APPLICATION_CODE')
  expect((await hindsightDistribution(directory)).sha256).not.toBe(initial.sha256)
})
it('records internal library links and rejects links outside the pinned distribution', async () => {
  const directory = await fixture(), initial = await hindsightDistribution(directory)
  await symlink('engine.py', join(directory, 'library.so'))
  const linked = await hindsightDistribution(directory)
  expect(linked.files).toBe(initial.files + 1); expect(linked.sha256).not.toBe(initial.sha256)
  await symlink('../foreign', join(directory, 'outside.so'))
  await expect(hindsightDistribution(directory)).rejects.toThrow()
})
it('refuses code or directories writable by other accounts', async () => {
  const directory = await fixture()
  await chmod(join(directory, 'engine.py'), 0o666)
  await expect(hindsightDistribution(directory)).rejects.toThrow('private Hindsight distribution')
})
