import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, stat, statfs, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import { validateLibrary, emptyLibrary, type PortableLibrary } from './catalogue'
import { PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'
import { syncDirectory } from './durability'

export interface OpenedBundle { manifest: Record<string, unknown>; memory?: string; envPath: string | null; library: PortableLibrary; blobDir: string; signature: string }
export interface BundleWrite { destination: string; manifest: string; memory?: string; envPath: string | null; previousBundle?: string; expectedSignature?: string; library: PortableLibrary; blobDir: string; upgrade: boolean }
export interface BundleWriteResult { signature: string; retainedEnvironment: boolean; durabilityWarning?: string }
export async function fileSignature(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  try { const hash = createHash('sha256'); for await (const data of createReadStream(path)) { signal?.throwIfAborted(); hash.update(data) }; return hash.digest('hex') }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw e }
}
export async function readBundle(path: string, work: string, signal?: AbortSignal): Promise<OpenedBundle> {
  await mkdir(work, { recursive: true, mode: 0o700 })
  const blobDir = join(work, 'blobs'); await mkdir(blobDir, { recursive: true, mode: 0o700 })
  const before = await fileSignature(path, signal)
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip)))
  const seen = new Set<string>(), blobs = new Map<string, { bytes: number; hash: string }>()
  let manifest: Record<string, unknown> | undefined, memory: string | undefined, catalogue: unknown, envPath: string | null = null, libraryBytes = 0
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve)
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          signal?.throwIfAborted()
          const name = entry.fileName
          if (seen.size > PROJECT_FILE_LIMITS.count + 10 || seen.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..') || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || entry.isEncrypted()) throw new Error('Project archive contains unsafe or duplicate entries. Restore a valid project.')
          seen.add(name)
          if (name.endsWith('/')) { zip.readEntry(); return }
          const blob = /^files\/blobs\/([a-f0-9]{64})$/.exec(name)
          const limit = blob ? PROJECT_FILE_LIMITS.fileBytes : name === 'environment.RData' ? 16 * 1024 ** 3 : 50_000_000
          if (!blob && !['project.json', 'environment.RData', 'context/project-memory.jsonl', 'files/catalogue.json'].includes(name)) throw new Error(`Project contains an unknown entry (${name.slice(0, 100)}). Open it with a compatible version; no files were changed.`)
          if (entry.uncompressedSize > limit) throw new Error('Project archive entry exceeds its import limit. Restore a smaller project.')
          const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
          let size = 0; const hash = createHash('sha256'), chunks: Buffer[] = []
          const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; if (size > limit) { callback(new Error('Expanded project entry exceeds its limit.')); return }; hash.update(chunk); callback(null, chunk) } })
          const target = blob ? join(blobDir, blob[1]) : name === 'environment.RData' ? join(work, 'environment.RData') : null
          if (target) await pipeline(stream, bound, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
          else { await pipeline(stream, bound, new Transform({ transform(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback() } }), { signal }) }
          if (size !== entry.uncompressedSize) throw new Error('Project entry size does not match its bytes.')
          if (blob) { const digest = hash.digest('hex'); if (digest !== blob[1]) throw new Error('Project file checksum failed. Export healthy files from a recovery copy.'); libraryBytes += size; if (libraryBytes > PROJECT_FILE_LIMITS.totalBytes) throw new Error('Project files exceed the library limit.'); blobs.set(blob[1], { bytes: size, hash: digest }) }
          else if (name === 'environment.RData') envPath = target
          else { const text = Buffer.concat(chunks).toString('utf8'); if (name === 'project.json') manifest = JSON.parse(text); else if (name === 'files/catalogue.json') catalogue = JSON.parse(text); else memory = text }
          zip.readEntry()
        })().catch(reject)
      })
      zip.readEntry()
    })
    if (!manifest || (manifest.version !== 1 && manifest.version !== 2 && manifest.version !== 3) || !manifest.ui || typeof manifest.ui !== 'object' || Array.isArray(manifest.ui)) throw new Error('Project manifest is unsupported. Open it with a compatible ouRGeo version.')
    if (manifest.version !== 1 && (typeof manifest.projectId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(manifest.projectId))) throw new Error('Project file identity is missing or invalid. Preserve the original bundle and restore a healthy project copy.')
    const library = manifest.version !== 1 ? validateLibrary(catalogue) : emptyLibrary()
    if (manifest.version === 1 && (catalogue || blobs.size)) throw new Error('Legacy project contains unversioned embedded files. Preserve the original and open a compatible recovery copy.')
    const requiredCapabilities = (manifest.projectFiles as { requiredCapabilities?: unknown } | undefined)?.requiredCapabilities
    const linkedManifest = manifest.version === 3
    if (manifest.version !== 1 && (!manifest.projectFiles || (manifest.projectFiles as { version?: number }).version !== (linkedManifest ? 2 : 1) || library.version !== (linkedManifest ? 2 : 1) || requiredCapabilities !== undefined && (!Array.isArray(requiredCapabilities) || requiredCapabilities.some(capability => !linkedManifest || capability !== 'linked-folders')))) throw new Error('Project file schema requires unsupported capabilities. Use a compatible ouRGeo version.')
    for (const entry of library.files.filter(file => !file.storage)) if (blobs.get(entry.sha256)?.bytes !== entry.bytes) throw new Error(`The original file for ${entry.name} is missing or corrupt. Preserve the original bundle.`)
    if (new Set(library.files.filter(file => !file.storage).map(f => f.sha256)).size !== blobs.size) throw new Error('Project has unreferenced file data. Refusing to rewrite it without a compatible reader.')
    if (await fileSignature(path, signal) !== before) throw new Error('The project changed while opening. Reopen the current file.')
    return { manifest, memory, envPath, library, blobDir, signature: before }
  } finally { zip.close() }
}

export async function writeBundle(input: BundleWrite, work: string, signal?: AbortSignal): Promise<BundleWriteResult> {
  signal?.throwIfAborted()
  const expectedSignature = input.expectedSignature ?? await fileSignature(input.destination, signal)
  const staged = join(dirname(input.destination), `.ourgeo-save-${randomUUID()}.tmp`)
  let envPath = input.envPath, memory = input.memory, retainedEnvironment = false
  if ((!envPath || memory === undefined) && input.previousBundle) {
    const previous = await readBundle(input.previousBundle, join(work, 'previous'), signal)
    if (!envPath) { envPath = previous.envPath; retainedEnvironment = !!envPath }
    if (memory === undefined) memory = previous.memory
  }
  const fileBytes = input.library.files.filter(file => !file.storage).reduce((sum, file) => sum + file.bytes, 0), environmentBytes = envPath ? (await stat(envPath)).size : 0
  const space = await statfs(dirname(input.destination))
  if (space.bavail * space.bsize < (fileBytes + environmentBytes) * 2 + 2 * 1024 ** 2) throw new Error('There is not enough disk space to stage and verify this project safely. Free space or choose Save As on another drive; the last saved project is intact.')
  const manifest = JSON.parse(input.manifest)
  if (!manifest || (manifest.version !== 1 && manifest.version !== 2 && manifest.version !== 3)) throw new Error('Project manifest is unsupported. Preserve the original and use a compatible ouRGeo version.')
  if (input.library.version === 2) { manifest.version = 3; manifest.projectFiles = { version: 2, catalogue: 'files/catalogue.json', revision: input.library.revision, requiredCapabilities: ['linked-folders'] } }
  else if (input.upgrade || manifest.version === 2 || input.library.files.length) { manifest.version = 2; manifest.projectFiles = { version: 1, catalogue: 'files/catalogue.json', revision: input.library.revision } }
  const zip = new yazl.ZipFile()
  let published = false
  try {
    const output = pipeline(zip.outputStream, createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal })
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'project.json')
    if (memory !== undefined) zip.addBuffer(Buffer.from(memory), 'context/project-memory.jsonl')
    if (envPath) zip.addFile(envPath, 'environment.RData', { compress: false })
    if (manifest.version === 2 || manifest.version === 3) {
      zip.addBuffer(Buffer.from(JSON.stringify(validateLibrary(input.library))), 'files/catalogue.json')
      for (const hash of new Set(input.library.files.filter(file => !file.storage).map(file => file.sha256))) zip.addFile(join(input.blobDir, hash), `files/blobs/${hash}`, { compress: false })
    }
    zip.on('error', error => (zip.outputStream as Readable).destroy(error)); zip.end()
    await output
    const file = await open(staged, 'r+'); try { await file.sync() } finally { await file.close() }
    const verified = await readBundle(staged, join(work, 'verification'), signal)
    if (await fileSignature(input.destination, signal) !== expectedSignature) throw new Error('The destination project changed outside ouRGeo. Use Save As to preserve both versions.')
    signal?.throwIfAborted()
    await rename(staged, input.destination)
    published = true
    // Publication is the commit point. A later fsync/read failure must not tell
    // the user the verified replacement failed, or leave its local journal
    // anchored to the file that was already replaced. The staged signature is
    // the signature of the exact bytes renamed into the destination.
    let durabilityWarning: string | undefined
    try { await syncDirectory(dirname(input.destination)) }
    catch (error) { durabilityWarning = `The project was saved and verified, but the filesystem could not confirm its directory durability (${(error as NodeJS.ErrnoException).code || 'I/O error'}). Keep the working draft and verify the saved project before closing ouRGeo.` }
    return { signature: verified.signature, retainedEnvironment, ...(durabilityWarning ? { durabilityWarning } : {}) }
  } finally { if (!published) await unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export async function regularFileSize(path: string): Promise<number> { const info = await stat(path); if (!info.isFile()) throw new Error('Choose a regular file.'); return info.size }
