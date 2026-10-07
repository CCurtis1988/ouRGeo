import { constants } from 'node:fs'
import { mkdir, open, rename, lstat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyRuntimeArchive, type RuntimeArchive } from './runtime-archive'

export interface DownloadArtifact extends RuntimeArchive { url: string }
export interface DownloadProgress { received: number; total?: number; resumed: boolean }
const downloadHosts = new Set(['github.com', 'codeload.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'files.pythonhosted.org'])
function catalogueUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !downloadHosts.has(url.hostname) || url.username || url.password || url.hash) throw new Error('Use an approved immutable runtime catalogue download.')
  return url
}
async function ordinaryFile(path: string): Promise<number> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Runtime download cache contains an unexpected path. Choose a new private cache.')
    return info.size
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
}

/** These requests download public, pinned packages only. They never inherit
 * authentication. A partially downloaded package is useful after cancellation,
 * but its bytes cannot be executed until the complete SHA-256 check succeeds. */
export async function downloadRuntimeArtifact(artifact: DownloadArtifact, directory: string, signal: AbortSignal,
  progress: (value: DownloadProgress) => void = () => {}, fetcher: typeof fetch = fetch): Promise<string> {
  const initial = catalogueUrl(artifact.url)
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.maxBytes) || artifact.maxBytes < 1 || artifact.maxBytes > 64_000_000) throw new Error('The runtime catalogue has no bounded download profile.')
  signal.throwIfAborted()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${artifact.sha256}.tar.gz`), partial = `${file}.part`, metadata = `${file}.resume`
  if (await ordinaryFile(file)) {
    try { await verifyRuntimeArchive(file, artifact, signal) }
    catch (error) {
      if (!signal.aborted && String(error).includes('checksum failed')) await unlink(file)
      throw error
    }
    return file
  }
  let offset = await ordinaryFile(partial), etag: string | undefined
  if (offset > artifact.maxBytes) throw new Error('Runtime partial download exceeds its limit. Remove this download cache and retry.')
  if (offset) {
    const metadataSize = await ordinaryFile(metadata)
    try {
      if (metadataSize > 2048) throw new Error('Invalid resume receipt')
      const handle = await open(metadata, constants.O_RDONLY | constants.O_NOFOLLOW)
      let saved: { url?: unknown; etag?: unknown }
      try { saved = JSON.parse(await handle.readFile('utf8')) }
      finally { await handle.close() }
      if (saved.url === artifact.url && typeof saved.etag === 'string' && saved.etag.length <= 200 && /^"[^"\r\n]+"$/.test(saved.etag)) etag = saved.etag
    } catch { /* A missing/incomplete resume receipt restarts the public download. */ }
  }
  if (!etag) offset = 0
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(120000)])
  let url = initial, response: Response | undefined
  for (let redirects = 0; redirects <= 3; redirects++) {
    timeout.throwIfAborted()
    response = await fetcher(url, { method: 'GET', redirect: 'manual', signal: timeout,
      headers: { Accept: 'application/octet-stream', ...(offset ? { Range: `bytes=${offset}-`, 'If-Range': etag! } : {}) } })
    if (![301, 302, 303, 307, 308].includes(response.status)) break
    const location = response.headers.get('Location')
    await response.body?.cancel()
    if (!location || redirects === 3) throw new Error('Runtime download redirected too many times. Retry the approved catalogue release.')
    url = catalogueUrl(new URL(location, url).href)
  }
  if (!response || ![200, 206].includes(response.status) || !response.body) { await response?.body?.cancel(); throw new Error('Runtime download failed. Retry or resume this release.') }
  let total: number | undefined
  const remaining = response.headers.get('Content-Length')
  if (response.status === 206) {
    const range = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(response.headers.get('Content-Range') ?? '')
    if (!offset || !range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) >= Number(range[3])
      || Number(range[3]) > artifact.maxBytes || (response.headers.get('ETag') && response.headers.get('ETag') !== etag)) {
      await response.body.cancel(); throw new Error('Runtime resume did not match the requested package. Restart the download.')
    }
    total = Number(range[3])
  } else {
    offset = 0
    if (remaining !== null) total = Number(remaining)
  }
  if ((total !== undefined && (!Number.isSafeInteger(total) || total < offset || total > artifact.maxBytes))
    || (remaining !== null && (!/^[0-9]+$/.test(remaining) || Number(remaining) + offset > artifact.maxBytes))) {
    await response.body.cancel(); throw new Error('Runtime download exceeds the package limit.')
  }
  try {
    const receipt = response.headers.get('ETag') ?? (response.status === 206 ? etag : undefined)
    await ordinaryFile(metadata)
    const savedMetadata = await open(metadata, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
    try { await savedMetadata.writeFile(JSON.stringify({ url: artifact.url, etag: receipt && /^"[^"\r\n]+"$/.test(receipt) && receipt.length <= 200 ? receipt : null })); await savedMetadata.sync() }
    finally { await savedMetadata.close() }
    const output = await open(partial, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (offset ? constants.O_APPEND : constants.O_TRUNC), 0o600)
    const reader = response.body.getReader()
    let received = offset
    try {
      progress({ received, total, resumed: offset > 0 })
      while (true) {
        timeout.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        received += chunk.value.byteLength
        if (received > artifact.maxBytes || (total !== undefined && received > total)) throw new Error('Runtime download exceeded its declared size.')
        // FileHandle.write can return a short write on a full disk. writeFile
        // retries the remainder rather than acknowledging missing package bytes.
        await output.writeFile(chunk.value)
        progress({ received, total, resumed: offset > 0 })
      }
      await output.sync()
    } finally { await reader.cancel(); reader.releaseLock(); await output.close() }
    timeout.throwIfAborted()
    if (total !== undefined && received !== total) throw new Error('Runtime download was interrupted. Resume the verified package.')
    try { await verifyRuntimeArchive(partial, artifact, signal) }
    catch (error) {
      // Only cryptographically invalid public cache bytes are discarded. This
      // lets Retry start afresh; installed runtimes and provider data are separate.
      if (!signal.aborted && String(error).includes('checksum failed')) { await unlink(partial); await unlink(metadata) }
      throw error
    }
    await rename(partial, file)
    await unlink(metadata)
    return file
  } catch (error) {
    await response.body.cancel().catch(() => {})
    throw error
  }
}
