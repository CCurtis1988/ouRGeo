import { constants, watch, type FSWatcher } from 'node:fs'
import { open, realpath, lstat, opendir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type { ContextFolder, FolderCatalogue, FolderDocument } from '../../../src/lib/context/folders'
import type { DocumentRange } from '../../../src/lib/context/types'
import { readDocumentRange } from '../../../src/lib/context/document-range'
import { redactContext } from '../../../src/lib/context/policy'

const MAX_FILES = 2000, MAX_VISITED = 10000, MAX_BYTES = 32 * 1024 * 1024, MAX_FILE = 1024 * 1024
const extensions = new Set(['.r', '.rmd', '.qmd', '.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.sql', '.py', '.js', '.ts', '.html', '.css'])
const excluded = /^(?:\.git|\.svn|\.hg|node_modules|\.venv|venv|\.ssh|\.aws|\.codex|\.cache|dist|build|target|\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|sqlite|db))$/i
const contained = (root: string, path: string): boolean => { const part = relative(root, path); return part !== '' && !part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part) }
const revision = (text: string): string => createHash('sha256').update(text).digest('hex')
interface Entry { descriptor: FolderDocument; path: string }
interface Folder { root: string; card: ContextFolder; entries: Map<string, Entry>; identities: Map<string, string>; watchers: FSWatcher[] }

/** Never follow symlinks, including a directory swapped since discovery. The
 * opened file's identity is compared with the current path before any bytes leave
 * this class; multiply linked files cannot alias an unrelated private file. */
async function safeText(root: string, path: string): Promise<string> {
  let parent = dirname(path)
  while (parent !== root) {
    if (!contained(root, parent) || (await lstat(parent)).isSymbolicLink()) throw new Error('SOURCE_UNAVAILABLE: a folder boundary changed. Refresh the selected folder.')
    parent = dirname(parent)
  }
  if (await realpath(root) !== root || !contained(root, await realpath(path))) throw new Error('SOURCE_UNAVAILABLE: the file is outside the selected folder.')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE) throw new Error('BUDGET_LIMIT: choose a text file below 1 MB without linked aliases.')
    const bytes = Buffer.alloc(Math.min(MAX_FILE + 1, before.size + 1))
    let bytesRead = 0
    while (bytesRead < bytes.length) {
      const next = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
      if (!next.bytesRead) break
      bytesRead += next.bytesRead
    }
    const after = await file.stat(), current = await lstat(path)
    if (bytesRead > MAX_FILE || current.isSymbolicLink() || before.ino !== current.ino || before.dev !== current.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !contained(root, await realpath(path))) throw new Error('STALE_REFERENCE: the file changed during reading. Refresh the selected folder.')
    const text = bytes.subarray(0, bytesRead).toString('utf8')
    if (text.includes('\0') || text.includes('\uFFFD')) throw new Error('SOURCE_UNAVAILABLE: only UTF-8 text files are indexed.')
    return text
  } finally { await file.close() }
}

function ignorePattern(line: string, prefix: string): RegExp | null {
  const value = line.trim()
  // Negation never re-enables excluded content. Unsupported ignore syntax is
  // conservatively omitted rather than interpreted as permission to disclose.
  if (!value || value.startsWith('#') || value.startsWith('!')) return null
  if (['[', ']', '\\'].some(character => value.includes(character))) return /^.*$/
  const body = value.replace(/^\//, '').replace(/\/$/, '')
  let pattern = ''
  for (let at = 0; at < body.length; at++) {
    const c = body[at]
    if (c === '*' && body[at + 1] === '*') {
      if (body[at + 2] === '/') { pattern += '(?:.*/)?'; at += 2 }
      else { pattern += '.*'; at++ }
    }
    else if (c === '*') pattern += '[^/]*'
    else if (c === '?') pattern += '[^/]'
    else pattern += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escapedPrefix}${body.includes('/') ? '' : '(?:.*/)?'}${pattern}(?:/.*)?$`)
}

export class ContextFolders {
  private folders = new Map<string, Folder>()
  private generation = 0
  constructor(private currentLease: () => string, private changed?: () => void) {}
  clear(): void { this.generation++; for (const folder of this.folders.values()) folder.watchers.forEach(watcher => watcher.close()); this.folders.clear() }
  private guard(lease: string, generation = this.generation): void {
    if (typeof lease !== 'string' || lease !== this.currentLease() || generation !== this.generation) throw new Error('SCOPE_CHANGED: select a folder in the current workspace.')
  }
  catalogue(lease: string): FolderCatalogue {
    this.guard(lease)
    return { folders: [...this.folders.values()].map(folder => ({ ...folder.card })), documents: [...this.folders.values()].flatMap(folder => [...folder.entries.values()].map(entry => ({ ...entry.descriptor }))) }
  }
  async add(selected: string, lease: string): Promise<FolderCatalogue> {
    this.guard(lease)
    if (typeof selected !== 'string' || selected.length > 4096 || selected.includes('\0')) throw new Error('Choose an explicit folder for this workspace.')
    const root = await realpath(selected)
    this.guard(lease)
    if (root === resolve(root, '..') || root === await realpath(homedir()) || !(await lstat(root)).isDirectory()) throw new Error('Choose a project folder rather than your home folder or the whole disk.')
    if (this.folders.size >= 8 && ![...this.folders.values()].some(folder => folder.root === root)) throw new Error('BUDGET_LIMIT: remove a folder before adding more than eight sources.')
    const existing = [...this.folders.values()].find(folder => folder.root === root)
    return this.scan(root, existing?.card.id ?? randomUUID(), lease)
  }
  async refresh(id: string, lease: string): Promise<FolderCatalogue> {
    this.guard(lease)
    const folder = this.folders.get(id)
    if (!folder) throw new Error('SOURCE_UNAVAILABLE: select the folder again.')
    return this.scan(folder.root, id, lease)
  }
  remove(id: string, lease: string): FolderCatalogue { this.guard(lease); this.generation++; this.folders.get(id)?.watchers.forEach(watcher => watcher.close()); this.folders.delete(id); return this.catalogue(lease) }
  private async scan(root: string, id: string, lease: string): Promise<FolderCatalogue> {
    const generation = ++this.generation
    const entries = new Map<string, Entry>()
    const identities = new Map(this.folders.get(id)?.identities ?? [])
    let visited = 0, bytes = 0, omitted = 0, limited = false
    const started = Date.now()
    const directories: string[] = []
    const walk = async (directory: string, inherited: RegExp[], depth: number): Promise<void> => {
      this.guard(lease, generation)
      if (depth > 20 || visited >= MAX_VISITED || entries.size >= MAX_FILES || bytes >= MAX_BYTES || Date.now() - started > 5000) { limited = true; return }
      if (directories.length >= 512) { limited = true; return }
      if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) { omitted++; return }
      directories.push(directory)
      const rules = [...inherited]
      const prefix = relative(root, directory).split(sep).join('/')
      for (const name of ['.gitignore', '.ourgeoignore']) {
        try {
          const text = await safeText(root, resolve(directory, name))
          if (text.length > 64 * 1024) { omitted++; limited = true; return }
          if (text.split('\n').length > 1000) { omitted++; limited = true; return }
          for (const line of text.split('\n')) { const rule = ignorePattern(line, prefix ? `${prefix}/` : ''); if (rule) rules.push(rule) }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { omitted++; return } }
      }
      const children = await opendir(directory)
      for await (const child of children) {
        this.guard(lease, generation)
        if (++visited > MAX_VISITED || entries.size >= MAX_FILES || bytes >= MAX_BYTES || Date.now() - started > 5000) { limited = true; break }
        const path = resolve(directory, child.name), name = relative(root, path).split(sep).join('/')
        if (!contained(root, path) || child.isSymbolicLink() || excluded.test(child.name) || rules.some(rule => rule.test(name))) { omitted++; continue }
        if (child.isDirectory()) await walk(path, rules, depth + 1)
        else if (child.isFile() && extensions.has(extname(child.name).toLowerCase())) {
          try {
            const text = await safeText(root, path)
            if (bytes + Buffer.byteLength(text) > MAX_BYTES) { limited = true; break }
            bytes += Buffer.byteLength(text)
            if (!identities.has(path) && identities.size >= 10000) { limited = true; break }
            const fileId = identities.get(path) ?? `document:folder:${randomUUID()}`
            identities.set(path, fileId)
            const descriptor: FolderDocument = { id: fileId, folderId: id, title: redactContext(name).slice(0, 512), summary: redactContext(readDocumentRange(text, { startLine: 1, endLine: Number.MAX_SAFE_INTEGER })).slice(0, 2000).replace(/\s+/g, ' ').slice(0, 1000), revision: revision(text) }
            entries.set(fileId, { path, descriptor })
          } catch { omitted++ }
        }
      }
    }
    await walk(root, [], 0)
    this.guard(lease, generation)
    this.folders.get(id)?.watchers.forEach(watcher => watcher.close())
    const folder: Folder = { root, card: { id, title: basename(root).slice(0, 256), files: entries.size, omitted, limited }, entries, identities, watchers: [] }
    this.folders.set(id, folder)
    if (this.changed) {
      const invalidate = (): void => {
        if (this.folders.get(id) !== folder || !folder.entries.size) return
        this.generation++; folder.entries.clear(); folder.card.files = 0; folder.card.needsRefresh = true
        folder.watchers.forEach(watcher => watcher.close()); folder.watchers = []
        this.changed?.()
      }
      try {
        for (const directory of directories) {
          const watcher = watch(directory, { persistent: false }, invalidate)
          watcher.on('error', invalidate); folder.watchers.push(watcher)
        }
      } catch { invalidate() }
    }
    return this.catalogue(lease)
  }
  private async assertReadable(root: string, path: string): Promise<void> {
    const parts = relative(root, path).split(sep)
    const rules: RegExp[] = []
    let directory = root
    for (let index = 0; index < parts.length; index++) {
      if (excluded.test(parts[index])) throw new Error('SOURCE_UNAVAILABLE: this file is excluded.')
      const prefix = parts.slice(0, index).join('/')
      for (const name of ['.gitignore', '.ourgeoignore']) {
        try {
          const policy = await safeText(root, resolve(directory, name))
          if (policy.length > 64 * 1024 || policy.split('\n').length > 1000) throw new Error('SOURCE_UNAVAILABLE: reduce this folder’s ignore file before reading.')
          for (const line of policy.split('\n')) { const rule = ignorePattern(line, prefix ? `${prefix}/` : ''); if (rule) rules.push(rule) }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      directory = resolve(directory, parts[index])
    }
    const fileName = parts.join('/')
    if (rules.some(rule => rule.test(fileName))) throw new Error('SOURCE_UNAVAILABLE: the file is now ignored. Refresh this folder.')
  }
  async read(id: string, expected: string, lease: string, range?: DocumentRange): Promise<string> {
    this.guard(lease)
    const generation = this.generation
    const folder = [...this.folders.values()].find(value => value.entries.has(id)), entry = folder?.entries.get(id)
    if (!folder || !entry || expected !== entry.descriptor.revision) throw new Error('SOURCE_UNAVAILABLE: refresh this folder before reading its files.')
    await this.assertReadable(folder.root, entry.path)
    const text = await safeText(folder.root, entry.path)
    await this.assertReadable(folder.root, entry.path)
    this.guard(lease, generation)
    if (revision(text) !== expected) throw new Error('STALE_REFERENCE: refresh the folder to read the current file revision.')
    return redactContext(readDocumentRange(text, range ?? { startLine: 1, endLine: Number.MAX_SAFE_INTEGER }))
  }
}
