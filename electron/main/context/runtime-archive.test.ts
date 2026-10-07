import { afterEach, expect, it } from 'vitest'
import { Header } from 'tar'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdtemp, writeFile, readFile, lstat, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { unpackRuntimeArchive } from './runtime-archive'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function archive(entries: { path: string; link?: string; type?: 'File' | 'SymbolicLink' | 'CharacterDevice'; text?: string }[]) {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-runtime-archive-')); dirs.push(directory)
  const buffers: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.text ?? '')
    const header = new Header({ path: entry.path, type: entry.type ?? 'File', linkpath: entry.link, size: body.length, mode: 0o755 })
    header.encode(); buffers.push(header.block!, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  buffers.push(Buffer.alloc(1024))
  const bytes = gzipSync(Buffer.concat(buffers)), path = join(directory, 'fixture.tar.gz')
  await writeFile(path, bytes)
  return { directory, path, profile: { root: 'python', sha256: createHash('sha256').update(bytes).digest('hex'), maxBytes: 100000 } }
}

it('materialises internal runtime aliases as private ordinary files', async () => {
  const fixture = await archive([{ path: 'python/bin/python3.12', text: 'verified executable' }, { path: 'python/bin/python3', link: 'python3.12', type: 'SymbolicLink' }])
  const staged = await unpackRuntimeArchive(fixture.path, fixture.directory, fixture.profile)
  expect((await lstat(join(staged, 'python/bin/python3'))).isSymbolicLink()).toBe(false)
  expect(await readFile(join(staged, 'python/bin/python3'), 'utf8')).toBe('verified executable')
  expect((await lstat(staged)).mode & 0o777).toBe(0o700)
})
it.each([
  [{ path: 'python/../../outside', text: 'private' }],
  [{ path: '/python/absolute', text: 'private' }],
  [{ path: 'python/device', type: 'CharacterDevice' as const }],
  [{ path: 'python/alias', link: '../../outside', type: 'SymbolicLink' as const }],
  [{ path: 'python/a', link: 'b', type: 'SymbolicLink' as const }, { path: 'python/b', link: 'a', type: 'SymbolicLink' as const }],
  [{ path: 'python/A', text: 'first' }, { path: 'python/a', text: 'second' }],
  [{ path: 'python/file', text: 'first' }, { path: 'python/file/child', text: 'second' }],
].map(entries => ({ entries })))('refuses traversal, special entries, link cycles and platform aliases before extraction', async ({ entries }) => {
  const fixture = await archive(entries)
  await expect(unpackRuntimeArchive(fixture.path, fixture.directory, fixture.profile)).rejects.toThrow('Runtime archive')
  expect(await readdir(fixture.directory)).toEqual(['fixture.tar.gz'])
})
it('does not stage a checksum failure or a cancelled install', async () => {
  const fixture = await archive([{ path: 'python/bin/runtime', text: 'verified' }])
  await expect(unpackRuntimeArchive(fixture.path, fixture.directory, { ...fixture.profile, sha256: '0'.repeat(64) })).rejects.toThrow('checksum')
  await expect(unpackRuntimeArchive(fixture.path, fixture.directory, fixture.profile, AbortSignal.abort())).rejects.toThrow()
  expect(await readdir(fixture.directory)).toEqual(['fixture.tar.gz'])
})
