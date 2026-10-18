import { constants, createWriteStream, type Stats } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'

export interface LinkedFolderGrant { root: string; dev: number; ino: number }
export interface LinkedDiscoveredFile { relativePath: string; bytes: number; sha256: string; fingerprint: string }
export interface LinkedScan { files: LinkedDiscoveredFile[]; directories: string[]; omitted: number; limited: boolean }
const excluded = /^(?:\.git|\.svn|\.hg|node_modules|\.venv|venv|\.ssh|\.aws|\.codex|\.gnupg|\.kube|\.azure|\.cache|dist|build|target|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|ourgeoproj))$/i
export const safeRelativePath = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && path.length <= 4096 && !path.includes('\\') && !path.includes('\0') && !isAbsolute(path) && !/^[A-Za-z]:/.test(path) && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
const contained = (root: string, path: string): boolean => { const part = relative(root, path); return !!part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
const fingerprint = (info: Stats): string => createHash('sha256').update(JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs])).digest('hex')
const stale = (): Error => new Error('STALE_REFERENCE: the linked source changed. Rescan its folder before using this file.')

export async function authoriseLinkedFolder(selected: string): Promise<LinkedFolderGrant> {
  if (typeof selected !== 'string' || selected.length > 4096 || selected.includes('\0')) throw new Error('Choose an existing project folder.')
  const root = await realpath(selected), info = await lstat(root)
  if (!info.isDirectory() || root === dirname(root) || root === await realpath(homedir()) || /^(?:\.git|\.ssh|\.aws|\.codex|\.gnupg|\.kube|\.azure|\.env)$/i.test(basename(root))) throw new Error('Choose a project folder rather than a whole disk, home folder or private system folder.')
  return { root, dev: info.dev, ino: info.ino }
}
export async function verifyLinkedRoot(grant: LinkedFolderGrant): Promise<void> {
  const info = await lstat(grant.root)
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== grant.dev || info.ino !== grant.ino || await realpath(grant.root) !== grant.root) throw new Error('SOURCE_UNAVAILABLE: the linked folder identity changed. Relink the intended folder.')
}
function ignorePattern(line: string, prefix: string): RegExp | null {
  const value = line.trim()
  // Conservative exclusions match the existing local-context folder policy;
  // negation never re-authorises private content, and unsupported syntax hides it.
  if (!value || value.startsWith('#') || value.startsWith('!')) return null
  if (value.length > 1000 || ['[', ']', '\\'].some(char => value.includes(char)) || (value.match(/[?*]/g)?.length ?? 0) > 8) return /^.*$/
  const body = value.replace(/^\//, '').replace(/\/$/, '')
  let pattern = ''
  for (let at = 0; at < body.length; at++) {
    const char = body[at]
    if (char === '*' && body[at + 1] === '*') { if (body[at + 2] === '/') { pattern += '(?:.*/)?'; at += 2 } else { pattern += '.*'; at++ } }
    else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${body.includes('/') ? '' : '(?:.*/)?'}${pattern}(?:/.*)?$`)
}
async function readIgnores(grant: LinkedFolderGrant, directory: string): Promise<RegExp[]> {
  const rules: RegExp[] = [], prefix = relative(grant.root, directory).split(sep).join('/')
  for (const name of ['.gitignore', '.ourgeoignore']) {
    const path = join(directory, name)
    try {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const before = await handle.stat()
        if (!before.isFile() || before.nlink !== 1 || before.size > 64 * 1024) throw new Error('SOURCE_UNAVAILABLE: an ignore policy is unsafe or exceeds 64 KiB. Repair it and rescan.')
        const bytes = Buffer.alloc(Math.min(before.size + 1, 64 * 1024 + 1)), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat(), current = await lstat(path)
        if (read.bytesRead !== before.size || fingerprint(before) !== fingerprint(after) || fingerprint(before) !== fingerprint(current) || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || !contained(grant.root, await realpath(path))) throw stale()
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)), lines = source.split('\n')
        if (lines.length > 1000) throw new Error('SOURCE_UNAVAILABLE: reduce the ignore policy to at most 1,000 lines and rescan.')
        for (const line of lines) { const rule = ignorePattern(line, prefix ? `${prefix}/` : ''); if (rule) rules.push(rule) }
      } finally { await handle.close() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return rules
}
async function assertPath(grant: LinkedFolderGrant, name: string, ignoredPaths: string[]): Promise<string> {
  if (!safeRelativePath(name) || ignoredPaths.some(ignored => name === ignored || name.startsWith(`${ignored}/`))) throw new Error('SOURCE_UNAVAILABLE: this linked file is ignored by the project.')
  await verifyLinkedRoot(grant)
  const segments = name.split('/'), rules: RegExp[] = []
  let directory = grant.root
  for (let index = 0; index < segments.length; index++) {
    if (excluded.test(segments[index])) throw new Error('SOURCE_UNAVAILABLE: this path is excluded from linked project files.')
    rules.push(...await readIgnores(grant, directory))
    if (rules.some(rule => rule.test(name))) throw new Error('SOURCE_UNAVAILABLE: the linked file is now ignored. Rescan its folder.')
    if (index < segments.length - 1) {
      directory = join(directory, segments[index])
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('SOURCE_UNAVAILABLE: a linked folder boundary changed. Relink or rescan it.')
    }
  }
  const path = resolve(grant.root, ...segments)
  if (!contained(grant.root, path) || !contained(grant.root, await realpath(path))) throw new Error('SOURCE_UNAVAILABLE: linked source is outside its authorised folder.')
  return path
}

/** Authority is checked before and after the opened handle is consumed. The
 * real SHA is never replaced with a stat digest for oversized catalogue rows. */
export async function inspectLinkedFile(grant: LinkedFolderGrant, name: string, ignoredPaths: string[], expectedFingerprint?: string, snapshotDirectory?: string, signal?: AbortSignal): Promise<LinkedDiscoveredFile & { path: string; release: () => Promise<void> }> {
  signal?.throwIfAborted()
  const path = await assertPath(grant, name, ignoredPaths), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let temporary: string | undefined
  try {
    const before = await handle.stat(), identity = fingerprint(before)
    if (!before.isFile() || before.nlink !== 1) throw new Error('SOURCE_UNAVAILABLE: choose a regular linked file without symlink or hard-link aliases.')
    if (expectedFingerprint && identity !== expectedFingerprint) throw stale()
    const oversized = before.size > PROJECT_FILE_LIMITS.fileBytes
    if (snapshotDirectory && oversized) throw new Error('BUDGET_LIMIT: this linked file is metadata-only because it exceeds 100 MiB. Use a smaller reference file for previews or assistant evidence.')
    const hash = createHash('sha256'); let bytes = 0
    if (!oversized) {
      if (snapshotDirectory) { await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 }); temporary = join(snapshotDirectory, randomUUID()) }
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > PROJECT_FILE_LIMITS.fileBytes) { callback(stale()); return }; hash.update(chunk); callback(null, chunk) } })
      if (temporary) await pipeline(handle.createReadStream({ autoClose: false }), bound, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal })
      else await pipeline(handle.createReadStream({ autoClose: false }), bound, new Transform({ transform(_chunk, _encoding, callback) { callback() } }), { signal })
    } else bytes = before.size
    const after = await handle.stat(), currentPath = await assertPath(grant, name, ignoredPaths), current = await lstat(currentPath)
    if (fingerprint(before) !== fingerprint(after) || fingerprint(before) !== fingerprint(current) || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || bytes !== before.size) throw stale()
    signal?.throwIfAborted()
    const snapshot = temporary
    temporary = undefined
    return { relativePath: name, bytes, fingerprint: identity, sha256: oversized ? '' : hash.digest('hex'), path: snapshot || path, release: async () => { if (snapshot) await unlink(snapshot).catch(error => { if (error.code !== 'ENOENT') throw error }) } }
  } finally { await handle.close(); if (temporary) await unlink(temporary).catch(() => {}) }
}

export async function scanLinkedFolder(grant: LinkedFolderGrant, ignoredPaths: string[], capacity: number, signal?: AbortSignal): Promise<LinkedScan> {
  await verifyLinkedRoot(grant)
  const result: LinkedScan = { files: [], directories: [], omitted: 0, limited: false }
  let visited = 0, hashedBytes = 0
  const started = Date.now()
  const walk = async (directory: string, inherited: RegExp[], depth: number): Promise<void> => {
    signal?.throwIfAborted()
    if (depth > 20 || visited >= 10_000 || result.files.length >= capacity || result.directories.length >= 512 || Date.now() - started > 15_000) { result.limited = true; return }
    if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) { result.omitted++; return }
    let rules: RegExp[]
    try { rules = [...inherited, ...await readIgnores(grant, directory)] } catch { result.omitted++; result.limited = true; return }
    result.directories.push(directory)
    for await (const child of await opendir(directory)) {
      signal?.throwIfAborted()
      if (++visited > 10_000 || result.files.length >= capacity || Date.now() - started > 15_000) { result.limited = true; break }
      const path = join(directory, child.name), name = relative(grant.root, path).split(sep).join('/')
      if (child.isSymbolicLink() || excluded.test(child.name) || ['.gitignore', '.ourgeoignore'].includes(child.name) || rules.some(rule => rule.test(name)) || ignoredPaths.some(ignored => name === ignored || name.startsWith(`${ignored}/`))) { result.omitted++; continue }
      if (child.isDirectory()) await walk(path, rules, depth + 1)
      else if (child.isFile()) {
        try {
          const size = (await lstat(path)).size
          if (size <= PROJECT_FILE_LIMITS.fileBytes && hashedBytes + size > 512 * 1024 ** 2) { result.limited = true; result.omitted++; continue }
          const file = await inspectLinkedFile(grant, name, ignoredPaths, undefined, undefined, signal)
          if (file.sha256) hashedBytes += file.bytes
          result.files.push({ relativePath: file.relativePath, bytes: file.bytes, sha256: file.sha256, fingerprint: file.fingerprint })
        } catch (error) { if (signal?.aborted) throw error; result.omitted++ }
      } else result.omitted++
    }
  }
  await walk(grant.root, [], 0)
  await verifyLinkedRoot(grant)
  return result
}
