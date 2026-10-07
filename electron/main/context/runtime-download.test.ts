import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadRuntimeArtifact, type DownloadArtifact } from './runtime-download'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-runtime-download-')); directories.push(directory)
  const bytes = Buffer.from('Synthetic pinned package bytes, never an executable')
  const artifact: DownloadArtifact = { url: 'https://codeload.github.com/synthetic/runtime/tar.gz/immutable', sha256: createHash('sha256').update(bytes).digest('hex'), root: 'synthetic', maxBytes: 100 }
  const response = () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length), ETag: '"synthetic-revision"' } })
  return { directory, bytes, artifact, response, partial: join(directory, `${artifact.sha256}.tar.gz.part`), metadata: join(directory, `${artifact.sha256}.tar.gz.resume`) }
}

it('verifies public downloads before publishing and reuses only a verified complete cache entry', async () => {
  const { directory, bytes, artifact, response } = await fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(response())
  const file = await downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)
  expect(await readFile(file)).toEqual(bytes)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Accept: 'application/octet-stream' } })
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
  expect(await downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).toBe(file)
  expect(fetcher).toHaveBeenCalledOnce()
  await writeFile(file, 'Corrupted cache')
  await expect(downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('checksum')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('preserves cancelled bytes and resumes only the pinned package with a strong conditional range', async () => {
  const { directory, bytes, artifact } = await fixture(), abort = new AbortController()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.subarray(0, 10)); controller.enqueue(bytes.subarray(10)); controller.close()
  } }), { headers: { 'Content-Length': String(bytes.length), ETag: '"synthetic-revision"' } }))
  await expect(downloadRuntimeArtifact(artifact, directory, abort.signal, value => { if (value.received === 10) abort.abort() }, fetcher)).rejects.toThrow()
  fetcher.mockResolvedValueOnce(new Response(bytes.subarray(10), { status: 206, headers: { 'Content-Length': String(bytes.length - 10), 'Content-Range': `bytes 10-${bytes.length - 1}/${bytes.length}`, ETag: '"synthetic-revision"' } }))
  const progress = vi.fn()
  const file = await downloadRuntimeArtifact(artifact, directory, new AbortController().signal, progress, fetcher)
  expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Range: 'bytes=10-', 'If-Range': '"synthetic-revision"' })
  expect(progress.mock.calls[0][0]).toMatchObject({ received: 10, resumed: true })
  expect(await readFile(file)).toEqual(bytes)
})

it('restarts rather than mixing bytes when the server returns a full replacement', async () => {
  const { directory, bytes, artifact, partial, metadata, response } = await fixture()
  await writeFile(partial, bytes.subarray(0, 10))
  await writeFile(metadata, JSON.stringify({ url: artifact.url, etag: '"synthetic-revision"' }))
  const file = await downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, vi.fn<typeof fetch>().mockResolvedValue(response()))
  expect(await readFile(file)).toEqual(bytes)
})

it('rejects wrong ranges, changing entities and oversized responses without publishing a package', async () => {
  const { directory, bytes, artifact, partial, metadata } = await fixture()
  await writeFile(partial, bytes.subarray(0, 10))
  await writeFile(metadata, JSON.stringify({ url: artifact.url, etag: '"synthetic-revision"' }))
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes.subarray(10), { status: 206, headers: { 'Content-Range': `bytes 9-${bytes.length - 1}/${bytes.length}`, ETag: '"synthetic-revision"' } }))
  await expect(downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('resume')
  fetcher.mockResolvedValue(new Response(bytes.subarray(10), { status: 206, headers: { 'Content-Range': `bytes 10-${bytes.length - 1}/${bytes.length}`, ETag: '"different-revision"' } }))
  await expect(downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('resume')
  fetcher.mockResolvedValue(new Response('x'.repeat(101)))
  await expect(downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('size')
  expect(await readdir(directory)).not.toContain(`${artifact.sha256}.tar.gz`)
})

it('never follows an unapproved destination or sends inherited authentication on a release redirect', async () => {
  const { directory, artifact, response } = await fixture()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://release-assets.githubusercontent.com/synthetic?signature=public' } })).mockResolvedValueOnce(response())
  await downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)
  expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty('Authorization')
  const other = await fixture()
  fetcher.mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://unrelated.example.invalid/package' } }))
  await expect(downloadRuntimeArtifact(other.artifact, other.directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('catalogue')
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it('refuses an unknown catalogue destination before any network request', async () => {
  const { directory, artifact } = await fixture(), fetcher = vi.fn<typeof fetch>()
  await expect(downloadRuntimeArtifact({ ...artifact, url: 'http://localhost/runtime' }, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('catalogue')
  expect(fetcher).not.toHaveBeenCalled()
})

it('refuses download aliases without overwriting another file', async () => {
  const { directory, artifact, partial, response } = await fixture(), target = join(directory, 'preserve.txt')
  await writeFile(target, 'Preserve this synthetic original')
  await symlink(target, partial)
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response())
  await expect(downloadRuntimeArtifact(artifact, directory, new AbortController().signal, undefined, fetcher)).rejects.toThrow('unexpected path')
  expect(await readFile(target, 'utf8')).toBe('Preserve this synthetic original')
  expect(fetcher).not.toHaveBeenCalled()
})
