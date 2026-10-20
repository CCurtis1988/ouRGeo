import { constants, createReadStream, createWriteStream, watch, type FSWatcher } from 'node:fs'
import { copyFile, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setImmediate } from 'node:timers/promises'
import type { ProjectFileAnalysisInput, ProjectFileCatalogue, ProjectFileEntry, ProjectFileExtraction, ProjectFileHit, ProjectFileImportResult, ProjectFileLocation, ProjectFileOperation, ProjectFilePreview, ProjectFileRead, ProjectLinkedFolder } from '../../../src/lib/project-files'
import { EMPTY_PROJECT_FILES, PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'
import { emptyLibrary, validateLibrary, type PortableLibrary } from './catalogue'
import { syncDirectory } from './durability'
import { authoriseLinkedFolder, inspectLinkedFile, scanLinkedFolder, verifyLinkedRoot, type LinkedFolderGrant } from './linked'

export type Extractor = (path: string, media: string, signal?: AbortSignal, name?: string, options?: { includeHidden?: boolean }) => Promise<ProjectFileExtraction>
interface State {
  projectId: string; bundlePath: string; signature: string; upgraded: boolean
  saved: PortableLibrary; draft: PortableLibrary; undo: ProjectFileEntry[][]
  dir: string; blobs: string; cache: Map<string, ProjectFileExtraction>; cacheBytes: number
  operation?: ProjectFileOperation; controller?: AbortController; notice?: string
  recoveries?: { id: string; files: number; label: string }[]
  pendingIndex?: Set<string>
  linked: Map<string, { card: ProjectLinkedFolder; grant?: LinkedFolderGrant; watchers: FSWatcher[] }>
}
interface Journal { baseSignature: string; savedRevision?: number; upgraded: boolean; draft: PortableLibrary }
export interface LibrarySnapshot { library: PortableLibrary; blobDir: string; upgraded: boolean; previousBundle?: string; signature?: string; state: unknown }
const types: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain', '.r': 'text/plain', '.rmd': 'text/markdown', '.qmd': 'text/markdown', '.py': 'text/plain', '.sql': 'text/plain', '.json': 'application/json', '.yaml': 'text/plain', '.yml': 'text/plain' }
export const projectFileMediaType = (name: string): string => types[extname(name).toLowerCase()] ?? 'application/octet-stream'
const clone = <T>(value: T): T => structuredClone(value)
const unconfirmedSaveNotice = 'The project was saved, but filesystem durability was not confirmed. The working file draft remains unsaved for recovery; verify the saved project or save again before closing ouRGeo.'
// Identical bytes can have different structural evidence: CSV rows and plain
// text lines must never share a parser result merely because their SHA matches.
const indexId = (file: ProjectFileEntry): string => `${file.sha256}-${createHash('sha256').update(file.mediaType).digest('hex').slice(0, 12)}${file.includeHidden ? '-hidden' : ''}`
function encrypt(bytes: string, key: Buffer): Buffer { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(bytes, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]) }
function decrypt(bytes: Buffer, key: Buffer): string { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') }
const clean = (value: unknown, length: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > length || [...value].some(c => c.charCodeAt(0) < 32 && !'\t\n\r'.includes(c))) throw new Error('Choose a non-empty name within the displayed limit.'); return value.trim() }

/** Originals and draft metadata are durable project content. Searchable bodies
 * are encrypted derived data, and may be discarded without losing an import. */
export class ProjectFileLibrary {
  private active?: State
  private queue: Promise<unknown> = Promise.resolve()
  private recoveries = new Map<string, { projectId: string; dir: string; journal: string }>()
  constructor(private root: string, private lease: () => { id: string; projectId: string | null }, private changed: () => void, private extract: Extractor, private key: () => Promise<Buffer>, private extractionVersion = 'project-files-1') {}
  private guard(lease: string, requireNamed = true): State | undefined {
    const scope = this.lease()
    if (scope.id !== lease || this.active && scope.projectId !== this.active.projectId) throw new Error('SCOPE_CHANGED: reopen Project Files in the active project.')
    if (requireNamed && (!scope.projectId || !this.active)) throw new Error('Save project to add files. The scratch workspace does not own a file library.')
    return this.active
  }
  private current(state: State): void { if (this.active !== state || this.lease().projectId !== state.projectId) throw new Error('SCOPE_CHANGED: the active project changed.') }
  private serial<T>(run: () => Promise<T>): Promise<T> { const result = this.queue.then(run); this.queue = result.catch(() => undefined); return result }
  scopeChanged(): void {
    if (this.active && this.active.projectId !== this.lease().projectId) { this.active.controller?.abort(); this.closeLinked(this.active); this.active = undefined; this.changed() }
    else if (this.active) { this.changed(); if (!this.active.operation) void this.warm(this.active) }
  }
  catalogue(lease: string): ProjectFileCatalogue {
    const state = this.guard(lease, false)
    if (!state) return clone(EMPTY_PROJECT_FILES)
    return { projectId: state.projectId, revision: state.draft.revision, savedRevision: state.saved.revision, files: state.draft.files.map(f => ({ ...f, saved: state.saved.files.some(s => s.id === f.id && s.revision === f.revision) })), ...(state.linked.size ? { linkedFolders: [...state.linked.values()].map(link => ({ ...link.card, ...(link.grant ? { path: link.grant.root } : {}) })) } : {}), ...(state.operation ? { operation: { ...state.operation } } : {}), ...(state.notice ? { notice: state.notice } : {}), ...(state.recoveries?.length ? { recoveries: clone(state.recoveries) } : {}) }
  }
  private async atomic(path: string, bytes: string | Buffer): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    try { const file = await open(temporary, 'wx', 0o600); try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }; await rename(temporary, path); await syncDirectory(dirname(path)) }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  private async persist(state: State): Promise<void> {
    await this.atomic(join(state.dir, 'draft.json'), JSON.stringify({ baseSignature: state.signature, savedRevision: state.saved.revision, upgraded: state.upgraded, draft: validateLibrary(state.draft) } satisfies Journal))
  }
  private bump(state: State, file?: ProjectFileEntry): void {
    state.draft.revision++
    if (file) { file.revision = `${file.sha256 || 'linked'}:${state.draft.revision}:${this.extractionVersion}`; file.updatedAt = new Date().toISOString() }
  }
  private closeLinked(state: State): void { for (const link of state.linked.values()) { link.watchers.forEach(watcher => watcher.close()); link.watchers = [] } }
  private async restoreLinked(state: State): Promise<void> {
    const previous = state.linked
    const grants = new Map<string, LinkedFolderGrant>()
    try {
      const key = await this.key()
      try {
        const data = JSON.parse(decrypt(await readFile(join(state.dir, 'linked-roots.enc')), key)) as { projectId: string; grants: { id: string; grant: LinkedFolderGrant }[] }
        if (data.projectId !== state.projectId || !Array.isArray(data.grants)) throw new Error('Linked folder grants have the wrong project identity.')
        for (const entry of data.grants) if (typeof entry.id === 'string' && entry.grant && typeof entry.grant.root === 'string' && isAbsolute(entry.grant.root) && Number.isSafeInteger(entry.grant.dev) && Number.isSafeInteger(entry.grant.ino)) grants.set(entry.id, entry.grant)
      } finally { key.fill(0) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && state.draft.linkedFolders?.length) state.notice = 'Local folder authorisation could not be restored. Unlock protected storage or relink the folders; no external contents were read.' }
    this.closeLinked(state); state.linked = new Map()
    for (const definition of state.draft.linkedFolders ?? []) {
      const grant = previous.get(definition.id)?.grant ?? grants.get(definition.id)
      const card: ProjectLinkedFolder = { id: definition.id, name: definition.name, status: grant ? 'needs-scan' : 'unlinked' }
      if (grant) try { await verifyLinkedRoot(grant) } catch (error) { card.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'; card.issue = 'The authorised folder is missing or its identity changed. Relink the intended folder.' }
      state.linked.set(definition.id, { card, grant, watchers: [] })
    }
  }
  private async persistLinkedGrants(state: State): Promise<void> {
    const key = await this.key()
    try { await this.atomic(join(state.dir, 'linked-roots.enc'), encrypt(JSON.stringify({ version: 1, projectId: state.projectId, grants: [...state.linked].flatMap(([id, link]) => link.grant ? [{ id, grant: link.grant }] : []) }), key)) }
    finally { key.fill(0) }
  }
  private rootConflict(state: State, grant: LinkedFolderGrant, except?: string): { same?: string; overlaps?: string } {
    const inside = (parent: string, child: string): boolean => { const part = relative(parent, child); return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part) }
    for (const [id, link] of state.linked) if (id !== except && link.grant) {
      if (link.grant.root === grant.root) return { same: id }
      if (inside(link.grant.root, grant.root) || inside(grant.root, link.grant.root)) return { overlaps: link.card.name }
    }
    return {}
  }
  async linkFolder(path: string, name: string | undefined, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!, grant = await authoriseLinkedFolder(path)
    const id = await this.serial(async () => {
      this.current(state)
      const conflict = this.rootConflict(state, grant)
      if (conflict.same) { state.notice = `This folder is already linked as ${state.linked.get(conflict.same)!.card.name}.`; return conflict.same }
      if (conflict.overlaps) throw new Error(`This folder overlaps ${conflict.overlaps}. Use the existing link or forget it before linking a parent or child folder.`)
      if (state.linked.size >= 32) throw new Error('The project holds 32 linked folders. Forget a link before adding another.')
      const id = randomUUID(), label = clean(name ?? basename(grant.root), 240), previous = clone(state.draft)
      state.draft.version = 2; state.draft.linkedFolders = [...state.draft.linkedFolders ?? [], { id, name: label }]
      state.linked.set(id, { card: { id, name: label, status: 'needs-scan' }, grant, watchers: [] }); this.bump(state); state.upgraded = true
      try { await this.persistLinkedGrants(state); await this.persist(state) } catch (error) { state.draft = previous; state.linked.delete(id); throw error }
      this.changed(); return id
    })
    return this.rescanFolders([id], lease)
  }
  async createFolder(parentPath: string, name: string, label: string | undefined, lease: string): Promise<ProjectFileCatalogue> {
    this.guard(lease)
    const component = clean(name, 240)
    if (component === '.' || component === '..' || /[/\\]/.test(component)) throw new Error('Choose a single new folder name without path separators.')
    const parent = await realpath(parentPath), before = await stat(parent)
    if (!before.isDirectory()) throw new Error('Choose an existing parent folder.')
    const path = join(parent, component)
    try { await mkdir(path, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('That physical folder already exists. Use Link existing folder instead.'); throw error }
    const after = await stat(parent)
    if (await realpath(parentPath) !== parent || before.dev !== after.dev || before.ino !== after.ino) throw new Error('The parent folder changed while creating the directory. Select the intended new folder and link it explicitly.')
    await syncDirectory(parent)
    return this.linkFolder(path, label ?? component, lease)
  }
  async renameLinkedFolder(id: string, name: string, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const definition = state.draft.linkedFolders?.find(folder => folder.id === id), link = state.linked.get(id)
      if (!definition || !link) throw new Error('This folder link was forgotten. Choose a current linked folder.')
      definition.name = clean(name, 240); link.card.name = definition.name; this.bump(state); await this.persist(state); this.changed(); return this.catalogue(lease)
    })
  }
  async relinkFolder(id: string, path: string, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!, grant = await authoriseLinkedFolder(path)
    await this.serial(async () => {
      this.current(state); const link = state.linked.get(id)
      if (!link) throw new Error('This folder link was forgotten. Add the folder as a new link.')
      const conflict = this.rootConflict(state, grant, id)
      if (conflict.same || conflict.overlaps) throw new Error('The selected folder duplicates or overlaps an existing folder link. Choose a separate root.')
      link.watchers.forEach(watcher => watcher.close()); link.watchers = []; link.grant = grant; link.card.status = 'needs-scan'; delete link.card.issue
      for (const file of state.draft.files.filter(file => file.storage?.folderId === id)) this.bump(state, file)
      await this.persistLinkedGrants(state); await this.persist(state); this.changed()
    })
    return this.rescanFolders([id], lease)
  }
  async forgetFolder(id: string, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const link = state.linked.get(id)
      if (!link) return this.catalogue(lease)
      link.watchers.forEach(watcher => watcher.close()); state.linked.delete(id)
      state.draft.linkedFolders = state.draft.linkedFolders?.filter(folder => folder.id !== id)
      state.draft.files = state.draft.files.filter(file => file.storage?.folderId !== id)
      state.undo = state.undo.map(files => files.filter(file => file.storage?.folderId !== id))
      this.bump(state); await this.persistLinkedGrants(state); await this.persist(state); this.changed(); return this.catalogue(lease)
    })
  }
  async rescanFolders(ids: string[] | undefined, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state)
      if (state.operation) throw new Error('A project file operation is running. Wait or cancel it before scanning linked folders.')
      const selected = [...state.linked].filter(([id]) => !ids || ids.includes(id)), controller = new AbortController()
      state.controller = controller; state.operation = { id: randomUUID(), label: 'Scanning linked folders', completed: 0, total: selected.length, cancellable: true }
      const toIndex: string[] = []
      try {
        for (const [id, link] of selected) {
          this.current(state); controller.signal.throwIfAborted()
          if (!link.grant) { link.card.status = 'unlinked'; continue }
          link.watchers.forEach(watcher => watcher.close()); link.watchers = []; link.card.status = 'scanning'; this.changed()
          const definition = state.draft.linkedFolders!.find(folder => folder.id === id)!
          try {
            const otherFiles = state.draft.files.filter(file => file.storage?.folderId !== id), previous = new Map(state.draft.files.filter(file => file.storage?.folderId === id).map(file => [file.storage!.relativePath, file]))
            const scan = await scanLinkedFolder(link.grant, definition.ignoredPaths ?? [], PROJECT_FILE_LIMITS.count - otherFiles.length, controller.signal)
            this.current(state); controller.signal.throwIfAborted()
            if (state.linked.get(id) !== link) continue
            const files: ProjectFileEntry[] = scan.files.map(discovered => {
              const old = previous.get(discovered.relativePath)
              if (old && old.storage?.fingerprint === discovered.fingerprint && old.sha256 === discovered.sha256 && old.bytes === discovered.bytes) { if (old.sha256 && !state.cache.has(indexId(old))) toIndex.push(old.id); return old }
              const now = new Date().toISOString(), name = basename(discovered.relativePath).slice(0, 240), large = !discovered.sha256
              const file: ProjectFileEntry = { ...(old ?? {}), id: old?.id ?? randomUUID(), name: old?.name ?? name, originalName: name, folder: old?.folder ?? (dirname(discovered.relativePath) === '.' ? '' : dirname(discovered.relativePath).slice(0, 500)), role: old?.role ?? 'reference', userDescription: old?.userDescription ?? '', generatedDescription: large ? `Linked asset, ${discovered.bytes} bytes. Metadata only; exceeds the 100 MiB content limit.` : `${projectFileMediaType(name)} · linked file`, sha256: discovered.sha256, bytes: discovered.bytes, mediaType: projectFileMediaType(name), revision: '', importedAt: old?.importedAt ?? now, updatedAt: now, status: large ? 'stored' : 'queued', coverage: large ? 'Metadata only. The original remains in the linked folder; no document contents indexed.' : 'Not yet indexed', saved: false, ...(old?.userDescription ? { descriptionNeedsReview: true } : {}), storage: { kind: 'linked', folderId: id, relativePath: discovered.relativePath, fingerprint: discovered.fingerprint } }
              delete file.issue; delete file.aiDescription; this.bump(state, file); if (file.sha256) toIndex.push(file.id); return file
            })
            const changed = previous.size !== files.length || files.some(file => previous.get(file.storage!.relativePath) !== file)
            const replacements = new Map(files.map(file => [file.id, file]))
            state.draft.files = state.draft.files.flatMap(file => {
              if (file.storage?.folderId !== id) return [file]
              const next = replacements.get(file.id); replacements.delete(file.id); return next ? [next] : []
            }).concat([...replacements.values()])
            if (changed) this.bump(state)
            link.card = { id, name: definition.name, status: 'ready', lastScannedAt: new Date().toISOString(), omitted: scan.omitted, limited: scan.limited, ...(scan.limited ? { issue: 'This scan reached a safety limit. Link a narrower folder to include omitted files.' } : {}) }
            if (changed) await this.persist(state)
            const invalidate = (): void => {
              if (this.active !== state || state.linked.get(id) !== link || link.card.status !== 'ready') return
              link.card.status = 'needs-scan'; link.card.issue = 'Folder contents changed. Rescan before using linked content.'; link.watchers.forEach(watcher => watcher.close()); link.watchers = []; this.changed()
            }
            try { for (const directory of scan.directories) { const watcher = watch(directory, { persistent: false }, invalidate); watcher.on('error', invalidate); link.watchers.push(watcher) } } catch { invalidate() }
          } catch (error) {
            if (controller.signal.aborted) { link.card.status = 'needs-scan'; break }
            link.card.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'; link.card.issue = `${String(error).slice(0, 500)} Relink or rescan the intended folder.`
          } finally { if (state.operation) state.operation.completed++; this.changed() }
        }
      } finally { state.controller = undefined; state.operation = undefined; this.changed() }
      if (toIndex.length) { state.pendingIndex ??= new Set(); toIndex.forEach(id => state.pendingIndex!.add(id)); this.resumeIndex(state) }
      return this.catalogue(lease)
    })
  }
  async activate(projectId: string, bundlePath: string, library: PortableLibrary, blobDir: string, signature: string, upgraded: boolean): Promise<void> {
    library = validateLibrary(library)
    const dir = join(this.root, projectId), blobs = join(dir, 'blobs')
    await mkdir(blobs, { recursive: true, mode: 0o700 }); await mkdir(join(dir, 'index'), { recursive: true, mode: 0o700 })
    await syncDirectory(dirname(this.root)); await syncDirectory(this.root)
    for (const hash of new Set(library.files.filter(file => !file.storage).map(file => file.sha256))) {
      const target = join(blobs, hash)
      if (join(blobDir, hash) !== target) await copyFile(join(blobDir, hash), target)
    }
    const state: State = { projectId, bundlePath, signature, upgraded, saved: clone(library), draft: clone(library), undo: [], dir, blobs, cache: new Map(), cacheBytes: 0, linked: new Map() }
    try {
      const journal = JSON.parse(await readFile(join(dir, 'draft.json'), 'utf8')) as Journal
      if (journal.baseSignature === signature && journal.draft.revision > library.revision) {
        state.draft = validateLibrary(journal.draft); state.upgraded ||= journal.upgraded
        for (const file of state.draft.files.filter(file => !file.storage)) { const info = await stat(join(blobs, file.sha256)); if (info.size !== file.bytes) throw new Error('A recovered file is incomplete.') }
        state.notice = 'Recovered unsaved project files. Save the project to commit them, or discard the recovered changes.'
      } else if (journal.baseSignature !== signature && journal.draft.revision > (journal.savedRevision ?? 0)) {
        await copyFile(join(dir, 'draft.json'), join(dir, `recovery-${randomUUID()}.json`))
        state.notice = 'Unsaved files from an earlier project revision were preserved. Use Recover file draft as new project to keep both versions.'
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Project file recovery needs attention: ${String(error)}. Preserve the project and recovery directory.`) }
    state.recoveries = []
    for (const name of await readdir(dir)) {
      if (!/^recovery-[a-f0-9-]{36}\.json$/.test(name)) continue
      try {
        const recovery = JSON.parse(await readFile(join(dir, name), 'utf8')) as Journal
        const files = validateLibrary(recovery.draft).files.length, id = randomUUID()
        this.recoveries.set(id, { projectId, dir, journal: join(dir, name) })
        state.recoveries.push({ id, files, label: `${files} recovered files from an earlier project revision` })
      } catch { state.notice = 'A recovery draft could not be read. Preserve the recovery directory and restore a healthy copy.' }
    }
    await this.restoreLinked(state)
    await this.persist(state)
    // A failed new journal must leave the current workspace usable. Publishing
    // first used to strand its library behind the unopened project's identity.
    this.active?.controller?.abort(); if (this.active) this.closeLinked(this.active); this.active = state
    if (this.lease().projectId === projectId) this.changed()
    // Loading the list never needs a parser; derived contents warm independently.
    void this.warm(state)
  }
  private async warm(state: State): Promise<void> {
    if (this.active !== state || this.lease().projectId !== state.projectId || !state.draft.files.length) return
    try {
      const scan = [...state.linked.values()].filter(link => link.grant && link.card.status === 'needs-scan').map(link => link.card.id)
      const key = await this.key()
      try {
        for (const file of state.draft.files) {
          this.current(state)
          if (file.storage && (!file.sha256 || !['ready', 'needs-scan'].includes(state.linked.get(file.storage.folderId)?.card.status ?? 'unlinked'))) continue
          const revision = file.revision
          const stillCurrent = (): boolean => this.active === state && this.lease().projectId === state.projectId && state.draft.files.some(candidate => candidate.id === file.id && candidate.revision === revision)
          try {
            try {
              const bytes = await readFile(join(state.dir, 'index', `${file.id}.visibility`))
              if (!stillCurrent()) continue
              const policy = JSON.parse(decrypt(bytes, key)) as { sha256: string; enabled: boolean }
              file.includeHidden = policy.sha256 === file.sha256 && policy.enabled === true
            }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
            if (!stillCurrent()) continue
            const bytes = await readFile(join(state.dir, 'index', indexId(file)))
            if (!stillCurrent()) continue
            const extraction = JSON.parse(decrypt(bytes, key)) as ProjectFileExtraction
            if (extraction.version !== this.extractionVersion) continue
            this.cache(state, indexId(file), extraction)
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { state.notice = 'A derived document index could not be restored. Use Reindex project files; original files are intact.' } }
        }
      } finally { key.fill(0) }
      if (scan.length && !state.operation) await this.rescanFolders(scan, this.lease().id)
      this.changed()
      const missing = state.draft.files.filter(file => file.sha256 && (!file.storage || state.linked.get(file.storage.folderId)?.card.status === 'ready') && !state.cache.has(indexId(file))).map(file => file.id)
      if (missing.length && !state.operation) await this.reindex(missing, this.lease().id)
    } catch (error) { if (this.active === state) { state.notice = `Search indexing is paused: ${String(error)} Original files remain available to preview and export.`; this.changed() } }
  }
  snapshot(): LibrarySnapshot {
    const state = this.active
    return state ? { library: clone(state.draft), blobDir: state.blobs, upgraded: state.upgraded, previousBundle: state.bundlePath, signature: state.signature, state } : { library: emptyLibrary(), blobDir: this.root, upgraded: false, state: null }
  }
  async bundleOperation<T>(label: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const state = this.active, controller = new AbortController(), id = randomUUID()
    if (state) { state.controller?.abort(); state.controller = controller; state.operation = { id, label, completed: 0, total: 1, cancellable: true }; this.changed() }
    try { return await run(controller.signal) }
    finally { if (state?.operation?.id === id) { state.operation = undefined; state.controller = undefined; this.changed(); this.resumeIndex(state) } }
  }
  async committed(snapshot: LibrarySnapshot, projectId: string, path: string, signature: string, upgrade: boolean, durabilityConfirmed = true): Promise<void> {
    const state = this.active
    if (snapshot.state && state !== snapshot.state) return
    if (!state || state.projectId !== projectId) {
      const draft = validateLibrary(state ? state.draft : snapshot.library)
      const trustedRoots = state ? new Map([...state.linked].flatMap(([id, link]) => link.grant ? [[id, link.grant] as const] : [])) : new Map<string, LinkedFolderGrant>()
      await this.activate(projectId, path, snapshot.library, snapshot.blobDir, signature, upgrade)
      if (draft.revision !== snapshot.library.revision && this.active) {
        for (const hash of new Set(draft.files.filter(file => !file.storage).map(file => file.sha256))) await copyFile(join(snapshot.blobDir, hash), join(this.active.blobs, hash))
        this.active.draft = draft; await this.persist(this.active); this.changed()
      }
      if (this.active && trustedRoots.size) {
        for (const [id, link] of this.active.linked) if (trustedRoots.has(id)) { link.grant = trustedRoots.get(id); link.card.status = 'needs-scan' }
        await this.persistLinkedGrants(this.active)
        if (this.lease().projectId === projectId) void this.warm(this.active)
      }
      if (!durabilityConfirmed && this.active) {
        // Save As may be visible now yet vanish after a failed directory sync.
        // Retain both the independent copy's draft and the original project's
        // prior journal, so either surviving project can recover its originals.
        this.active.saved = emptyLibrary(); this.active.notice = unconfirmedSaveNotice
        await this.persist(this.active); this.changed()
      }
      if (state && durabilityConfirmed) await this.persist({ ...state, draft: clone(state.saved) })
      return
    }
    if (durabilityConfirmed) {
      state.saved = clone(snapshot.library)
      if (state.draft.revision === snapshot.library.revision) state.undo = []
      if (state.notice === unconfirmedSaveNotice) delete state.notice
    } else state.notice = unconfirmedSaveNotice
    state.signature = signature; state.bundlePath = path; state.upgraded = upgrade
    await this.persist(state); await this.cleanup(state); this.changed()
  }
  private async copyOriginal(state: State, path: string, signal: AbortSignal): Promise<{ hash: string; bytes: number; name: string }> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const temporary = join(state.blobs, `.import-${randomUUID()}`)
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > PROJECT_FILE_LIMITS.fileBytes) throw new Error('Choose a regular file no larger than 100 MiB.')
      let bytes = 0; const hash = createHash('sha256')
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > PROJECT_FILE_LIMITS.fileBytes) { callback(new Error('The file grew beyond 100 MiB during import.')); return }; hash.update(chunk); callback(null, chunk) } })
      await pipeline(handle.createReadStream({ autoClose: false }), bound, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal })
      const after = await handle.stat()
      if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('The file changed while importing. Finish editing it and try again.')
      this.current(state); signal.throwIfAborted()
      const digest = hash.digest('hex'), destination = join(state.blobs, digest)
      const file = await open(temporary, 'r+'); try { await file.sync() } finally { await file.close() }
      await rename(temporary, destination)
      await syncDirectory(state.blobs)
      return { hash: digest, bytes, name: basename(path).slice(0, 240) }
    } finally { await handle.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  async add(paths: string[], lease: string): Promise<ProjectFileImportResult> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); if (state.operation) throw new Error('A file operation is running. Wait or cancel it before importing.')
      const controller = new AbortController(); state.controller = controller; state.operation = { id: randomUUID(), label: 'Adding files', total: paths.length, completed: 0, cancellable: true }; this.changed()
      const ids: string[] = [], errors: string[] = []
      try {
        for (const path of paths) {
          if (controller.signal.aborted) break
          try {
            if (state.draft.files.length >= PROJECT_FILE_LIMITS.count) throw new Error('The library holds 2,000 files. Remove files before importing more.')
            const result = await this.copyOriginal(state, path, controller.signal)
            const existing = state.draft.files.find(file => !file.storage && file.sha256 === result.hash)
            if (existing) { ids.push(existing.id); state.notice = `${existing.name}: already in project.`; continue }
            if (state.draft.files.filter(file => !file.storage).reduce((sum, file) => sum + file.bytes, 0) + result.bytes > PROJECT_FILE_LIMITS.totalBytes) throw new Error('Embedded originals would exceed 1 GiB. Remove files or use another project.')
            let name = result.name, suffix = 2
            while (state.draft.files.some(file => file.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${result.name.slice(0, 220)} (${suffix++})`
            const now = new Date().toISOString()
            const file: ProjectFileEntry = { id: randomUUID(), name, originalName: result.name, folder: '', role: 'reference', userDescription: '', generatedDescription: `${projectFileMediaType(name)} · ${result.bytes} bytes`, sha256: result.hash, bytes: result.bytes, mediaType: projectFileMediaType(result.name), revision: `${result.hash}:0`, importedAt: now, updatedAt: now, status: 'queued', coverage: 'Not yet indexed', saved: false }
            const previous = clone(state.draft), upgraded = state.upgraded
            state.draft.files.push(file); this.bump(state, file); state.upgraded = true
            try { await this.persist(state) } catch (error) { state.draft = previous; state.upgraded = upgraded; throw error }
            ids.push(file.id)
          } catch (error) { errors.push(`${basename(path)}: ${String(error)}`) }
          finally { if (state.operation) state.operation.completed++; this.changed() }
        }
      } finally { state.operation = undefined; state.controller = undefined; this.changed() }
      if (controller.signal.aborted) errors.push('Import cancelled. Completed imports are retained; remaining files were not added.')
      const catalogue = this.catalogue(lease)
      void this.reindex(ids, lease).catch(error => { if (this.active === state) { state.notice = String(error); this.changed() } })
      return { catalogue, ids, errors }
    })
  }
  async update(id: string, revision: string, changes: Partial<Pick<ProjectFileEntry, 'name' | 'folder' | 'role' | 'userDescription'>>, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const file = this.entry(state, id, revision)
      const next = { ...file }
      if (changes.name !== undefined) next.name = clean(changes.name, 240)
      if (changes.folder !== undefined) { if (typeof changes.folder !== 'string' || changes.folder.length > 500 || changes.folder.split('/').some(p => p === '..') || /[\0\r\n]/.test(changes.folder)) throw new Error('Choose a logical folder name below 500 characters.'); next.folder = changes.folder.trim() }
      if (changes.role !== undefined) { if (!['reference', 'standard', 'example'].includes(changes.role)) throw new Error('Choose Reference, Standard or Example.'); next.role = changes.role }
      if (changes.userDescription !== undefined) { if (typeof changes.userDescription !== 'string' || changes.userDescription.length > 4000 || changes.userDescription.includes('\0')) throw new Error('Keep the description below 4,000 characters.'); next.userDescription = changes.userDescription; next.descriptionNeedsReview = false }
      const previous = clone(state.draft)
      this.bump(state, next); state.draft.files = state.draft.files.map(f => f.id === id ? next : f)
      if (next.aiDescription?.revision === file.revision) next.aiDescription = { ...next.aiDescription, revision: next.revision }
      try { await this.persist(state) } catch (error) { state.draft = previous; throw error }
      this.changed(); return this.catalogue(lease)
    })
  }
  async replace(id: string, revision: string, path: string, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const file = this.entry(state, id, revision), controller = new AbortController()
      if (file.storage) throw new Error('Linked files stay in their physical folder. Replace the source there and rescan, or add an embedded copy.')
      state.controller = controller
      try {
        const result = await this.copyOriginal(state, path, controller.signal)
        if (state.draft.files.filter(file => !file.storage).reduce((sum, f) => sum + (f.id === id ? 0 : f.bytes), result.bytes) > PROJECT_FILE_LIMITS.totalBytes) throw new Error('The replacement exceeds the embedded library size limit.')
        const previous = clone(state.draft)
        Object.assign(file, { sha256: result.hash, bytes: result.bytes, originalName: result.name, mediaType: projectFileMediaType(result.name), status: 'queued', coverage: 'Not yet indexed', generatedDescription: '', descriptionNeedsReview: !!file.userDescription, includeHidden: false }); delete file.issue; delete file.aiDescription
        this.bump(state, file)
        try { await this.persist(state) } catch (error) { state.draft = previous; throw error }
        this.changed()
      } finally { state.controller = undefined }
      void this.reindex([id], lease).catch(error => { state.notice = String(error); this.changed() })
      return this.catalogue(lease)
    })
  }
  private entry(state: State, id: string, revision?: string): ProjectFileEntry { const file = state.draft.files.find(f => f.id === id); if (!file) throw new Error('SOURCE_UNAVAILABLE: this file was removed. Choose a current project file.'); if (revision && revision !== file.revision) throw new Error('STALE_REFERENCE: the file changed. Select its current revision.'); return file }
  async remove(ids: string[], lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const previous = clone(state.draft)
      for (const file of state.draft.files.filter(file => ids.includes(file.id) && file.storage)) {
        const definition = state.draft.linkedFolders?.find(folder => folder.id === file.storage!.folderId)
        if (definition) definition.ignoredPaths = [...new Set([...definition.ignoredPaths ?? [], file.storage!.relativePath])]
      }
      state.undo.push(clone(state.draft.files)); state.draft.files = state.draft.files.filter(file => !ids.includes(file.id)); this.bump(state)
      try { await this.persist(state) } catch (error) { state.draft = previous; state.undo.pop(); throw error }
      const remaining = new Set(state.draft.files.map(file => file.sha256))
      for (const file of previous.files.filter(file => ids.includes(file.id) && !remaining.has(file.sha256))) for (const suffix of ['', '-hidden']) {
        const extraction = state.cache.get(file.sha256 + suffix)
        if (extraction) { state.cacheBytes -= extraction.sections.reduce((sum, section) => sum + Buffer.byteLength(section.text), 0); state.cache.delete(file.sha256 + suffix) }
      }
      this.changed(); return this.catalogue(lease)
    })
  }
  async undo(lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    return this.serial(async () => {
      this.current(state); const previous = state.undo.pop()
      if (previous) {
        const draft = clone(state.draft)
        // Undo restores removed entries only. Replacing the whole historical
        // catalogue here would erase files imported or edited since removal.
        const currentIds = new Set(state.draft.files.map(file => file.id))
        const restored = previous.filter(file => !currentIds.has(file.id) && (!file.storage || state.linked.has(file.storage.folderId)))
        for (const file of restored.filter(file => file.storage)) { const definition = state.draft.linkedFolders?.find(folder => folder.id === file.storage!.folderId); if (definition) definition.ignoredPaths = definition.ignoredPaths?.filter(path => path !== file.storage!.relativePath) }
        state.draft.files = [...state.draft.files, ...restored]; this.bump(state)
        try { await this.persist(state) } catch (error) { state.draft = draft; state.undo.push(previous); throw error }
        this.changed()
      }
      return this.catalogue(lease)
    })
  }
  async discard(lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease, false)
    if (!state) return clone(EMPTY_PROJECT_FILES)
    state.controller?.abort()
    return this.serial(async () => {
      this.current(state); const previous = state.draft; state.draft = clone(state.saved)
      try { await this.persist(state) } catch (error) { state.draft = previous; throw error }
      await this.restoreLinked(state); await this.persistLinkedGrants(state)
      state.undo = []; state.operation = undefined; await this.cleanup(state); this.changed(); return this.catalogue(lease)
    })
  }
  async recoverIntoCopy(id: string, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!, recovery = this.recoveries.get(id)
    if (!recovery) throw new Error('This recovery selection is no longer available. Reopen the original project and select its recovery draft.')
    if (state.projectId === recovery.projectId) throw new Error('Save As a new project before recovering this draft. The original project will be preserved.')
    return this.serial(async () => {
      this.current(state)
      const journal = JSON.parse(await readFile(recovery.journal, 'utf8')) as Journal, draft = validateLibrary(journal.draft)
      for (const file of draft.files.filter(file => !file.storage)) {
        const source = join(recovery.dir, 'blobs', file.sha256), hash = createHash('sha256')
        for await (const bytes of createReadStream(source)) hash.update(bytes)
        if (hash.digest('hex') !== file.sha256) throw new Error(`Recovered original ${file.name} is corrupt. The saved project and recovery draft were preserved.`)
        await copyFile(source, join(state.blobs, file.sha256))
      }
      const previous = state.draft
      state.draft = { ...draft, revision: Math.max(draft.revision, state.draft.revision) + 1 }; state.upgraded = true
      try { await this.persist(state) } catch (error) { state.draft = previous; throw error }
      await this.restoreLinked(state)
      state.notice = 'Recovered the file draft into this independent project copy. Save to commit it. Linked folders without a local authorisation require Relink.'
      this.changed(); void this.warm(state)
      return this.catalogue(lease)
    })
  }
  async setIncludeHidden(id: string, revision: string, enabled: boolean, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!, file = this.entry(state, id, revision)
    if (!file.mediaType.includes('spreadsheetml') || typeof enabled !== 'boolean') throw new Error('Hidden-content selection is available for Excel workbooks.')
    const key = await this.key()
    try {
      this.current(state); this.entry(state, id, revision)
      await this.atomic(join(state.dir, 'index', `${file.id}.visibility`), encrypt(JSON.stringify({ sha256: file.sha256, enabled }), key))
      const previous = state.cache.get(indexId(file))
      if (previous) { state.cacheBytes -= previous.sections.reduce((sum, section) => sum + Buffer.byteLength(section.text), 0); state.cache.delete(indexId(file)) }
      file.includeHidden = enabled; this.bump(state, file); await this.persist(state); this.changed()
    } finally { key.fill(0) }
    state.pendingIndex ??= new Set(); state.pendingIndex.add(id); this.resumeIndex(state)
    return this.catalogue(lease)
  }
  async setAnalysis(id: string, revision: string, analysis: ProjectFileAnalysisInput, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    const bounded = (value: unknown, limit: number, required = true): value is string => typeof value === 'string' && value.length <= limit && !value.includes('\0') && (!required || !!value.trim())
    if (!analysis || typeof analysis !== 'object' || !bounded(analysis.text, 2000) || !bounded(analysis.provider, 40) || !bounded(analysis.model, 200) || !bounded(analysis.coverage, 500, false)) throw new Error('Keep the AI description within 2,000 characters, provider within 40, model within 200 and coverage within 500 characters.')
    await this.original(id, revision, lease)
    return this.serial(async () => {
      this.current(state); this.guard(lease); const file = this.entry(state, id, revision)
      if (file.storage) await this.original(id, revision, lease)
      this.current(state); this.entry(state, id, revision)
      const previous = clone(state.draft)
      file.aiDescription = { text: analysis.text.trim(), revision: file.revision, provider: analysis.provider.trim(), model: analysis.model.trim(), createdAt: new Date().toISOString(), coverage: analysis.coverage }
      // A derived description changes discovery metadata, not the authoritative
      // source revision. Otherwise completing a description invalidates itself.
      this.bump(state)
      try { await this.persist(state) } catch (error) { state.draft = previous; throw error }
      this.changed(); return this.catalogue(lease)
    })
  }
  private resumeIndex(state: State): void {
    if (this.active !== state || this.lease().projectId !== state.projectId || state.operation || !state.pendingIndex?.size) return
    const ids = [...state.pendingIndex]; state.pendingIndex.clear()
    void this.reindex(ids, this.lease().id).catch(error => { if (this.active === state) { state.notice = String(error); this.changed() } })
  }
  cancel(id: string, lease: string): void { const state = this.guard(lease)!; if (state.operation?.id === id) state.controller?.abort() }
  private cache(state: State, hash: string, extraction: ProjectFileExtraction): void {
    const bytes = extraction.sections.reduce((sum, section) => sum + Buffer.byteLength(section.text), 0)
    const prior = state.cache.get(hash), priorBytes = prior?.sections.reduce((sum, section) => sum + Buffer.byteLength(section.text), 0) ?? 0
    if (bytes > PROJECT_FILE_LIMITS.textBytes || state.cacheBytes - priorBytes + bytes > PROJECT_FILE_LIMITS.projectTextBytes) throw new Error('Derived text exceeds the project index limit. Originals are retained; index a smaller selection.')
    state.cacheBytes -= priorBytes
    state.cache.set(hash, extraction); state.cacheBytes += bytes
  }
  private async index(state: State, file: ProjectFileEntry, signal?: AbortSignal): Promise<ProjectFileExtraction> {
    const key = await this.key()
    try {
      const extraction = await this.parseOriginal(state, file, this.lease().id, { includeHidden: file.includeHidden }, signal)
      this.current(state); signal?.throwIfAborted(); this.entry(state, file.id, file.revision)
      this.cache(state, indexId(file), extraction)
      await this.atomic(join(state.dir, 'index', indexId(file)), encrypt(JSON.stringify(extraction), key))
      return extraction
    } finally { key.fill(0) }
  }
  async reindex(ids: string[] | undefined, lease: string): Promise<ProjectFileCatalogue> {
    const state = this.guard(lease)!
    // Indexing is independent of the mutation queue so a user can remove a file
    // or save while a parser is running. Each completion checks its revision.
    if (state.operation) throw new Error('A project file operation is running. Wait or cancel it first.')
    const files = state.draft.files.filter(file => file.sha256 && (!file.storage || state.linked.get(file.storage.folderId)?.card.status === 'ready') && (!ids || ids.includes(file.id)))
    const controller = new AbortController(), operationId = randomUUID(); state.controller = controller; state.operation = { id: operationId, label: 'Indexing files', total: files.length, completed: 0, cancellable: true }; this.changed()
    try {
      for (const original of files) {
        this.current(state); if (controller.signal.aborted) break
        const revision = original.revision, previousStatus = original.status
        original.status = 'indexing'; this.changed()
        try {
          const extraction = await this.index(state, { ...original }, controller.signal)
          await this.serial(async () => {
            this.current(state); const file = this.entry(state, original.id, revision)
            const changed = file.generatedDescription !== extraction.description || file.coverage !== extraction.coverage || previousStatus !== extraction.status || !file.revision.endsWith(`:${this.extractionVersion}`)
            Object.assign(file, { generatedDescription: extraction.description.slice(0, 2000), status: extraction.status, coverage: extraction.coverage, issue: extraction.issue })
            if (changed) {
              // Completing initial indexing changes discovery metadata, not
              // the original the user just attached. Keep that reference valid;
              // changing parser versions still revokes old extraction evidence.
              this.bump(state, file.revision.endsWith(`:${this.extractionVersion}`) ? undefined : file)
              await this.persist(state)
            }
          })
        } catch (error) {
          if (controller.signal.aborted) { const file = state.draft.files.find(file => file.id === original.id && file.revision === revision); if (file) file.status = previousStatus; break }
          if (this.active !== state) return clone(EMPTY_PROJECT_FILES)
          const file = state.draft.files.find(file => file.id === original.id && file.revision === revision)
          if (file) { file.status = 'error'; file.issue = `${String(error).slice(0, 1800)} Reindex this file after resolving the issue.`; await this.persist(state) }
        } finally { if (state.operation?.id === operationId) state.operation.completed++; this.changed() }
      }
    } finally { if (this.active === state && state.operation?.id === operationId) { state.operation = undefined; state.controller = undefined; this.changed(); this.resumeIndex(state) } }
    return this.catalogue(lease)
  }
  async read(id: string, revision: string, lease: string, location?: ProjectFileLocation, offset = 0, human = false): Promise<ProjectFileRead> {
    const state = this.guard(lease)!, file = this.entry(state, id, revision)
    if (!human) { const key = await this.key(); key.fill(0); this.current(state); this.entry(state, id, revision) }
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Choose a valid document continuation.')
    await this.original(id, revision, lease)
    let extraction = state.cache.get(indexId(file))
    if (!extraction) extraction = human ? await this.parseOriginal(state, file, lease, { includeHidden: file.includeHidden }) : await this.index(state, file)
    this.current(state); this.entry(state, id, revision)
    let sections = extraction.sections
    if (location) {
      if (location.kind === 'pdf') { if (!Number.isSafeInteger(location.page) || location.page < 1 || (location.endPage ?? location.page) < location.page || (location.endPage ?? location.page) - location.page > 20) throw new Error('Choose up to 21 positive PDF pages.'); sections = sections.filter(s => s.location.kind === 'pdf' && s.location.page >= location.page && s.location.page <= (location.endPage ?? location.page)) }
      else if (location.kind === 'docx') sections = sections.filter(s => s.location.kind === 'docx' && s.location.section === location.section)
      else if (location.kind === 'sheet') { sections = sections.filter(s => s.location.kind === 'sheet' && s.location.sheet === location.sheet && (!location.range || s.location.range && this.inSheetRange(s.location.range, location.range))) }
      else if (location.kind === 'image') sections = []
    }
    const overview = !location && !human ? `${file.name}\n${file.userDescription || extraction.description}\n${extraction.coverage}\nAvailable sections (first 20):\n${sections.slice(0, 20).map(section => `${section.title}: ${JSON.stringify(section.location)}`).join('\n')}\n\n` : ''
    const selectedSections = !location && !human ? sections.slice(0, 1) : sections
    let text = overview + selectedSections.map(section => `${section.title}\n${section.text}`).join('\n\n')
    if (location?.kind === 'lines') {
      if (!Number.isSafeInteger(location.start) || !Number.isSafeInteger(location.end) || location.start < 1 || location.end < location.start || location.end - location.start > 10000) throw new Error('Choose positive ordered line numbers.')
      if (!file.mediaType.startsWith('text/') && file.mediaType !== 'application/json') throw new Error('Line selection is available for text files. Choose a page, section or worksheet for this document.')
      const snapshot = file.storage ? await this.materialiseOriginal(id, revision, lease) : undefined
      let raw: { text: string; next?: number }
      try { raw = await this.rawLines(snapshot?.path ?? join(state.blobs, file.sha256), location.start, location.end, offset); if (file.storage) await this.original(id, revision, lease) }
      finally { await snapshot?.release() }
      this.current(state); this.entry(state, id, revision)
      return { id, revision, title: file.name, location, text: raw.text, coverage: `Original UTF-8 source lines ${location.start}–${location.end}. ${extraction.coverage}`, complete: raw.next === undefined, ...(raw.next !== undefined ? { next: raw.next } : {}) }
    }
    if (!text) text = `${file.name}\n${extraction.description}\n${extraction.coverage}${extraction.issue ? `\n${extraction.issue}` : ''}\nNo searchable text was available for this location.`
    const chunk = text.slice(offset, offset + 12_000)
    return { id, revision, title: file.name, text: chunk, ...(location ? { location } : sections[0] ? { location: sections[0].location } : {}), coverage: `${extraction.coverage}${!location && !human && sections.length > 1 ? ' This read includes the outline and first section only; select a location or search for other passages.' : ''}`, complete: offset + chunk.length >= text.length && extraction.status !== 'partial' && (!!location || human || sections.length <= 1), ...(offset + chunk.length < text.length ? { next: offset + chunk.length } : {}) }
  }
  private inSheetRange(address: string, range: string): boolean {
    const match = /^([A-Z]{1,3})([1-9]\d*)(?::([A-Z]{1,3})([1-9]\d*))?$/.exec(range.toUpperCase())
    if (!match) throw new Error('Choose an A1-style cell or range, for example A1:D20.')
    const column = (letters: string): number => [...letters].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0)
    const left = column(match[1]), top = Number(match[2]), right = column(match[3] ?? match[1]), bottom = Number(match[4] ?? match[2])
    if (right < left || bottom < top || (right - left + 1) * (bottom - top + 1) > 1000) throw new Error('Choose an ordered range of at most 1,000 cells.')
    const cell = /^([A-Z]{1,3})([1-9]\d*)$/.exec(address)
    return !!cell && column(cell[1]) >= left && column(cell[1]) <= right && Number(cell[2]) >= top && Number(cell[2]) <= bottom
  }
  private async rawLines(path: string, start: number, end: number, offset: number): Promise<{ text: string; next?: number }> {
    let line = 1, selectedChars = 0, captured = ''
    for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
      const parts = chunk.split('\n')
      for (let index = 0; index < parts.length; index++) {
        const piece = parts[index] + (index < parts.length - 1 ? '\n' : '')
        if (line >= start && line <= end) {
          const from = Math.max(0, offset - selectedChars), to = Math.max(0, offset + 12_001 - selectedChars)
          if (to > from) captured += piece.slice(from, to)
          selectedChars += piece.length
        }
        if (index < parts.length - 1) line++
        if (line > end || captured.length > 12_000) break
      }
      if (line > end || captured.length > 12_000) break
    }
    return { text: captured.slice(0, 12_000), ...(captured.length > 12_000 ? { next: offset + 12_000 } : {}) }
  }
  async previewTable(id: string, revision: string, lease: string, location?: ProjectFileLocation, options?: { includeHidden?: boolean }): Promise<NonNullable<ProjectFilePreview['table']>> {
    const state = this.guard(lease)!, file = this.entry(state, id, revision)
    await this.original(id, revision, lease)
    const inspected = { ...file, includeHidden: options?.includeHidden ?? file.includeHidden }
    const extraction = state.cache.get(indexId(inspected)) ?? await this.parseOriginal(state, file, lease, { includeHidden: inspected.includeHidden })
    this.current(state); this.entry(state, id, revision)
    const workbook = file.mediaType.includes('spreadsheetml')
    const sheets = [...new Set(extraction.sections.flatMap(section => section.location.kind === 'sheet' ? [section.location.sheet] : []))]
    const sheet = location?.kind === 'sheet' ? location.sheet : sheets[0] ?? ''
    const rows = new Map<number, { address: string; value: string; raw?: string; type?: string; formula?: string }[]>(), columns = new Set<string>()
    let truncated = false
    if (location?.kind === 'sheet' && location.range) this.inSheetRange('A1', location.range)
    for (const section of extraction.sections) {
      if (workbook) {
        if (section.location.kind !== 'sheet' || section.location.sheet !== sheet || !section.location.range || location?.kind === 'sheet' && location.range && !this.inSheetRange(section.location.range, location.range)) continue
        const address = section.location.range, match = /^([A-Z]+)(\d+)$/.exec(address)
        if (!match) continue
        const row = Number(match[2]), column = match[1]
        if (!rows.has(row) && rows.size >= 100 || !columns.has(column) && columns.size >= 20) { truncated = true; continue }
        const cell = JSON.parse(section.text.slice(section.text.indexOf(': ') + 2)) as { displayed?: string; raw?: string; type?: string; formula?: string }
        const cells = rows.get(row) ?? []
        cells.push({ address, value: String(cell.displayed ?? cell.raw ?? ''), raw: cell.raw, type: cell.type, formula: cell.formula }); rows.set(row, cells); columns.add(column)
      } else {
        const rowMatch = /^Row (\d+): /.exec(section.text)
        if (!rowMatch) continue
        const row = Number(rowMatch[1])
        if (location?.kind === 'lines' && section.location.kind === 'lines' && (section.location.end < location.start || section.location.start > location.end)) continue
        if (rows.size >= 100) { truncated = true; break }
        const cells: { address: string; value: string; raw?: string; type?: string }[] = []
        for (const match of section.text.slice(rowMatch[0].length).matchAll(/(?:^| \| )(\d+): ("(?:[^"\\]|\\.)*")/g)) {
          const index = Number(match[1]); if (index > 20) { truncated = true; continue }
          let number = index, column = ''
          while (number > 0) { number--; column = String.fromCharCode(65 + number % 26) + column; number = Math.floor(number / 26) }
          const value = JSON.parse(match[2]) as string
          cells.push({ address: `${column}${row}`, value, raw: value, type: 'string' }); columns.add(column)
        }
        rows.set(row, cells)
      }
    }
    const columnNumber = (value: string): number => [...value].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
    return { sheets, sheet, columns: [...columns].sort((a, b) => columnNumber(a) - columnNumber(b)), rows: [...rows].sort(([a], [b]) => a - b).map(([row, cells]) => ({ row, cells })), truncated }
  }
  async search(query: string, lease: string): Promise<ProjectFileHit[]> {
    const state = this.guard(lease)!, words = query.toLowerCase().slice(0, 512).match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
    if (!words.length) return []
    const key = await this.key(); key.fill(0); this.current(state)
    const hits: (ProjectFileHit & { score: number })[] = []
    let yielded = Date.now()
    for (const file of state.draft.files) {
      if (file.storage && (!file.sha256 || state.linked.get(file.storage.folderId)?.card.status !== 'ready')) continue
      const metadata = `${file.name} ${file.userDescription} ${file.generatedDescription}`.toLowerCase()
      const extraction = state.cache.get(indexId(file))
      for (const section of extraction?.sections ?? []) {
        if (Date.now() - yielded > 8) { await setImmediate(); this.current(state); yielded = Date.now() }
        const haystack = section.text.toLowerCase(), score = words.reduce((sum, word) => sum + (haystack.includes(word) ? 2 : 0) + (metadata.includes(word) ? 1 : 0), 0)
        if (!score) continue
        const at = Math.max(0, Math.min(...words.map(word => haystack.indexOf(word)).filter(at => at >= 0)) - 120)
        hits.push({ id: file.id, revision: file.revision, title: file.name, excerpt: section.text.slice(at, at + 700), location: section.location, score })
      }
    }
    this.current(state)
    const checked = new Map<string, boolean>(), selected: ProjectFileHit[] = []
    for (const { score: _score, ...hit } of hits.sort((a, b) => b.score - a.score)) {
      if (selected.length >= 30) break
      if (!checked.has(hit.id)) { try { const file = this.entry(state, hit.id, hit.revision); if (file.storage) await this.original(hit.id, hit.revision, lease); checked.set(hit.id, true) } catch { this.current(state); checked.set(hit.id, false) } }
      if (checked.get(hit.id)) selected.push(hit)
    }
    return selected
  }
  private linkedSource(state: State, file: ProjectFileEntry): { grant: LinkedFolderGrant; ignored: string[] } {
    const link = file.storage && state.linked.get(file.storage.folderId), definition = file.storage && state.draft.linkedFolders?.find(folder => folder.id === file.storage!.folderId)
    if (!link || !definition || !link.grant || link.card.status !== 'ready') throw new Error('SOURCE_UNAVAILABLE: relink or rescan this folder before using its contents.')
    if (!file.sha256) throw new Error('BUDGET_LIMIT: this linked asset is metadata-only because it exceeds 100 MiB. Its contents are not indexed or previewed.')
    return { grant: link.grant, ignored: definition.ignoredPaths ?? [] }
  }
  private linkedFailure(state: State, file: ProjectFileEntry, error: unknown): void {
    const link = file.storage && state.linked.get(file.storage.folderId)
    if (!link || !link.grant || String(error).includes('BUDGET_LIMIT')) return
    link.card.status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'needs-scan'; link.card.issue = 'A linked source or ignore policy changed. Rescan or relink before using it.'; this.changed()
  }
  async materialiseOriginal(id: string, revision: string, lease: string, signal?: AbortSignal): Promise<{ path: string; file: ProjectFileEntry; release: () => Promise<void> }> {
    const state = this.guard(lease)!, file = this.entry(state, id, revision)
    if (!file.storage) return { ...await this.original(id, revision, lease), release: async () => {} }
    const { grant, ignored } = this.linkedSource(state, file)
    let snapshot: Awaited<ReturnType<typeof inspectLinkedFile>> | undefined
    try {
      snapshot = await inspectLinkedFile(grant, file.storage.relativePath, ignored, file.storage.fingerprint, join(state.dir, 'snapshots'), signal)
      this.current(state); this.entry(state, id, revision); this.linkedSource(state, file)
      if (snapshot.sha256 !== file.sha256 || snapshot.bytes !== file.bytes) throw new Error('STALE_REFERENCE: linked bytes changed. Rescan the folder.')
      return { path: snapshot.path, file: { ...file }, release: snapshot.release }
    } catch (error) { await snapshot?.release(); this.linkedFailure(state, file, error); throw error }
  }
  private async parseOriginal(state: State, file: ProjectFileEntry, lease: string, options: { includeHidden?: boolean }, signal?: AbortSignal): Promise<ProjectFileExtraction> {
    const snapshot = await this.materialiseOriginal(file.id, file.revision, lease, signal)
    try {
      const extraction = await this.extract(snapshot.path, file.mediaType, signal, file.originalName, options)
      this.current(state); this.entry(state, file.id, file.revision)
      if (file.storage) await this.original(file.id, file.revision, lease)
      return extraction
    } finally { await snapshot.release() }
  }
  async original(id: string, revision: string, lease: string): Promise<{ path: string; file: ProjectFileEntry }> {
    const state = this.guard(lease)!, file = this.entry(state, id, revision)
    if (file.storage) {
      try {
        const { grant, ignored } = this.linkedSource(state, file), found = await inspectLinkedFile(grant, file.storage.relativePath, ignored, file.storage.fingerprint)
        this.current(state); this.entry(state, id, revision); this.linkedSource(state, file)
        if (found.sha256 !== file.sha256 || found.bytes !== file.bytes) throw new Error('STALE_REFERENCE: linked bytes changed. Rescan the folder.')
        return { path: found.path, file: { ...file } }
      } catch (error) { this.linkedFailure(state, file, error); throw error }
    }
    const path = join(state.blobs, file.sha256)
    const digest = createHash('sha256'); for await (const bytes of createReadStream(path)) digest.update(bytes)
    this.current(state); this.entry(state, id, revision)
    if (digest.digest('hex') !== file.sha256) throw new Error('The original file checksum failed. Preserve the project and restore a healthy copy.')
    return { path, file: { ...file } }
  }
  private async cleanup(state: State): Promise<void> {
    try {
      const keep = new Set([...state.saved.files, ...state.draft.files, ...state.undo.flat()].filter(file => !file.storage).map(file => file.sha256))
      const keepIndexes = new Set([...state.saved.files, ...state.draft.files, ...state.undo.flat()].filter(file => file.sha256).map(indexId))
      for (const name of await readdir(state.dir)) {
        if (!/^recovery-[a-f0-9-]{36}\.json$/.test(name)) continue
        const journal = JSON.parse(await readFile(join(state.dir, name), 'utf8')) as Journal
        for (const file of validateLibrary(journal.draft).files) { if (!file.storage) keep.add(file.sha256); if (file.sha256) keepIndexes.add(indexId(file)) }
      }
      for (const name of await readdir(state.blobs)) if (/^[a-f0-9]{64}$/.test(name) && !keep.has(name)) await unlink(join(state.blobs, name))
      for (const name of await readdir(join(state.dir, 'index'))) { if (/^[a-f0-9]{64}(?:-[a-f0-9]{12})?(?:-hidden)?$/.test(name) && !keepIndexes.has(name)) await unlink(join(state.dir, 'index', name)) }
    } catch { state.notice = 'The project is saved; unused local-file cleanup will retry after the next save. Recovery originals were preserved.' }
  }
}
