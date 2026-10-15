import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, rm, stat, writeFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, posix } from 'node:path'
import { list, extract, type Parser } from 'tar'
import { createGunzip } from 'node:zlib'
import { Transform } from 'node:stream'

interface ArchiveEntry { path: string; type: string; size: number; link: string; mode: number }
export interface RuntimeArchive { sha256: string; root: string; maxBytes: number; caseSensitive?: boolean }
const unsafeCharacters = (text: string): boolean => /[\\:]/.test(text) || [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)

function safePath(path: string, root: string): string {
  const clean = path.replace(/\/$/, '')
  if (!clean || clean.length > 1024 || clean !== root && !clean.startsWith(`${root}/`)
      || clean.split('/').some(part => !part || ['.', '..'].includes(part) || part.length > 255 || unsafeCharacters(part) || /[. ]$/.test(part))) {
    throw new Error('Runtime archive has an unsafe path. Preserve the active runtime and download a verified release.')
  }
  return clean
}

async function consumeArchive(file: string, parser: Parser, done: 'end' | 'close', signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(file)
    const gunzip = createGunzip()
    let bytes = 0
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > 512 * 1024 * 1024) callback(new Error('Runtime archive exceeds the decompressed size limit.'))
      else callback(null, chunk)
    } })
    let finished = false
    const settle = (error?: Error): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      bounded.unpipe(parser)
      input.destroy()
      gunzip.destroy()
      bounded.destroy()
      if (error) reject(error)
      else resolve()
    }
    const cancel = (): void => parser.abort(new Error('Runtime unpack cancelled; the active runtime was preserved.'))
    const timer = setTimeout(() => parser.abort(new Error('Runtime unpack timed out; retry a verified release.')), 120000)
    parser.on('error', settle)
    parser.once(done, () => settle())
    input.on('error', error => parser.abort(error))
    gunzip.on('error', error => parser.abort(error))
    bounded.on('error', error => parser.abort(error))
    signal?.addEventListener('abort', cancel, { once: true })
    input.pipe(gunzip).pipe(bounded).pipe(parser)
  })
}

export async function verifyRuntimeArchive(file: string, profile: RuntimeArchive, signal?: AbortSignal): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(profile.sha256) || !/^[a-zA-Z0-9_.-]+$/.test(profile.root)) throw new Error('Invalid runtime catalogue entry.')
  const info = await stat(file)
  if (!info.isFile() || info.size > profile.maxBytes) throw new Error('Runtime download exceeds its certified archive limit.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  signal?.throwIfAborted()
  if (hash.digest('hex') !== profile.sha256) throw new Error('Runtime checksum failed. Download the verified release again; the active runtime was preserved.')
}

/** Materialise checked links as independent files. No archive may create a
 * symlink, hardlink, device or FIFO in application data. A fresh private staging
 * directory prevents extraction through an existing user-controlled path. */
export async function unpackRuntimeArchive(file: string, parent: string, profile: RuntimeArchive, signal?: AbortSignal): Promise<string> {
  await verifyRuntimeArchive(file, profile, signal)
  const entries = new Map<string, ArchiveEntry>(), names = new Set<string>()
  let total = 0
  const parser = list({ strict: true, maxMetaEntrySize: 65536, onReadEntry: entry => {
    try {
      signal?.throwIfAborted()
      const path = safePath(entry.path, profile.root), name = profile.caseSensitive ? path : path.toLowerCase()
      if (names.has(name) || entries.size >= 25000 || !['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)
          || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 128 * 1024 * 1024) throw new Error('Runtime archive contains unsupported or excessive entries.')
      names.add(name)
      total += entry.size
      if (total > 512 * 1024 * 1024) throw new Error('Runtime archive exceeds the unpacked size limit.')
      entries.set(path, { path, type: entry.type, size: entry.size, link: entry.linkpath ?? '', mode: entry.mode ?? 0 })
    } catch (error) { parser.abort(error instanceof Error ? error : new Error(String(error))) }
  } })
  await consumeArchive(file, parser, 'end', signal)
  const targets = new Map<string, ArchiveEntry>()
  for (const entry of entries.values()) {
    if (!['SymbolicLink', 'Link'].includes(entry.type)) continue
    let current = entry
    const seen = new Set<string>()
    while (['SymbolicLink', 'Link'].includes(current.type)) {
      if (seen.has(current.path) || seen.size >= 16 || !current.link || unsafeCharacters(current.link) || posix.isAbsolute(current.link)) throw new Error('Runtime archive contains an unsafe link.')
      seen.add(current.path)
      const target = current.type === 'Link' ? current.link : posix.join(posix.dirname(current.path), current.link)
      const path = safePath(posix.normalize(target), profile.root)
      const next = entries.get(path)
      if (!next) throw new Error('Runtime archive contains a missing link target.')
      current = next
    }
    if (current.type !== 'File') throw new Error('Runtime directory links are unsupported; use a certified platform profile.')
    targets.set(entry.path, current)
    total += current.size
    if (total > 650 * 1024 * 1024) throw new Error('Runtime materialised links exceed the size limit.')
  }
  // A regular file cannot also be a parent directory, on any platform.
  for (const entry of entries.values()) {
    let parentPath = posix.dirname(entry.path)
    while (parentPath !== '.') {
      if (entries.has(parentPath) && entries.get(parentPath)?.type !== 'Directory') throw new Error('Runtime archive has conflicting directory entries.')
      parentPath = posix.dirname(parentPath)
    }
  }
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const staged = await mkdtemp(join(parent, '.runtime-unpack-'))
  await chmod(staged, 0o700)
  try {
    if (profile.caseSensitive) {
      await writeFile(join(staged, '.CaseProbe'), '', { flag: 'wx', mode: 0o600 })
      let folded = false
      try { await stat(join(staged, '.caseprobe')); folded = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await unlink(join(staged, '.CaseProbe'))
      if (folded) throw new Error('This runtime requires a case-sensitive filesystem. Use a supported application-data location.')
    }
    let unpackingFailed = false
    const unpacker = extract({ cwd: staged, strict: true, maxMetaEntrySize: 65536, preservePaths: false, preserveOwner: false, noMtime: true, noChmod: true, dmode: 0o700, fmode: 0o600,
      filter: (path, entry) => {
        if (unpackingFailed) return false
        const known = entries.get(path.replace(/\/$/, ''))
        if (!known || !('type' in entry) || known.size !== entry.size || known.type !== entry.type) { unpacker.abort(new Error('Runtime archive changed while unpacking. Download a verified release again.')); return false }
        return ['File', 'Directory'].includes(entries.get(path.replace(/\/$/, ''))?.type ?? '')
      },
    })
    // An extraction error can precede already queued filesystem callbacks.
    // Refuse further entries before bounded cleanup retries remove staging.
    unpacker.on('error', () => { unpackingFailed = true })
    await consumeArchive(file, unpacker, 'close', signal)
    for (const [path, target] of targets) {
      signal?.throwIfAborted()
      await mkdir(dirname(join(staged, path)), { recursive: true, mode: 0o700 })
      await copyFile(join(staged, target.path), join(staged, path))
    }
    for (const entry of entries.values()) {
      signal?.throwIfAborted()
      const mode = (targets.get(entry.path) ?? entry).mode
      await chmod(join(staged, entry.path), entry.type === 'Directory' || mode & 0o111 ? 0o700 : 0o600)
    }
    await verifyRuntimeArchive(file, profile, signal)
    return staged
  } catch (error) {
    await rm(staged, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    throw error
  }
}
