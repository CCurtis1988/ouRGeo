import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runtimeIntegrity } from './runtime-integrity'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ourgeo-integrity-')); directories.push(root)
  await mkdir(join(root, 'artifact/pinned/nested'), { recursive: true })
  for (const [name, body, mode] of [['z.txt', 'zeta', 0o644], ['nested/a.txt', 'alpha', 0o644], ['tool', 'tool', 0o755]] as const) {
    await writeFile(join(root, 'artifact/pinned', name), body); await chmod(join(root, 'artifact/pinned', name), mode)
  }
  return root
}
const artifacts = [{ role: 'engine', directory: 'artifact', root: 'pinned' }]
it('preserves the installed digest from the serial verifier while hashing concurrently', async () => {
  const root = await fixture()
  // Captured from the pre-concurrency verifier: existing installations and
  // rollback pairs must retain their immutable identity after this change.
  expect(await runtimeIntegrity(root, artifacts)).toEqual({ version: 1, sha256: '1688a30bd791457ee6199927ec1fc3d8869dd645523ed20e97125cc262a08525', files: 3, bytes: 13 })
  await writeFile(join(root, 'artifact/pinned/z.txt'), 'changed')
  expect((await runtimeIntegrity(root, artifacts)).sha256).not.toBe('1688a30bd791457ee6199927ec1fc3d8869dd645523ed20e97125cc262a08525')
})
it('still refuses a linked installed file and honours cancellation', async () => {
  const root = await fixture(), cancelled = new AbortController()
  cancelled.abort()
  await expect(runtimeIntegrity(root, artifacts, cancelled.signal)).rejects.toThrow()
  await symlink('z.txt', join(root, 'artifact/pinned/linked'))
  await expect(runtimeIntegrity(root, artifacts)).rejects.toThrow('linked files')
})
