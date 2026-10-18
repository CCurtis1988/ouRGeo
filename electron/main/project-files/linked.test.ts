import { afterEach, describe, expect, it, vi } from 'vitest'
import { link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { ProjectFileLibrary } from './library'
import { emptyLibrary, validateLibrary } from './catalogue'
import { readBundle, writeBundle } from './bundle'
import { authoriseLinkedFolder, inspectLinkedFile, scanLinkedFolder } from './linked'
import { extractDocument } from './extraction'
import type { ProjectFileExtraction } from '../../../src/lib/project-files'

const cleanup: (() => Promise<void>)[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ourgeo-linked-')), physical = join(dir, 'physical'), incoming = join(dir, 'incoming'), root = join(dir, 'managed')
  await mkdir(physical); await mkdir(incoming)
  const scope = { id: 'lease', projectId: randomUUID() as string | null }, instances: ProjectFileLibrary[] = []
  const extractor = vi.fn(async (path: string): Promise<ProjectFileExtraction> => ({ version: 'project-files-1', status: 'searchable', description: 'Locally extracted reference', coverage: 'All fixture text covered.', sections: [{ title: 'Source', location: { kind: 'lines', start: 1, end: 1 }, text: await readFile(path, 'utf8') }] }))
  const make = (libraryRoot = root) => { const library = new ProjectFileLibrary(libraryRoot, () => scope, () => {}, extractor, async () => Buffer.alloc(32, 9)); instances.push(library); return library }
  const library = make(), bundle = join(dir, 'project.ourgeoproj')
  await library.activate(scope.projectId!, bundle, emptyLibrary(), incoming, 'base', false)
  cleanup.push(async () => { scope.projectId = null; instances.forEach(instance => instance.scopeChanged()); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) })
  const idle = async (target = library) => { await expect.poll(() => target.catalogue(scope.id).operation, { timeout: 5000 }).toBeUndefined() }
  return { dir, physical, incoming, root, scope, library, bundle, extractor, make, idle }
}
afterEach(async () => { for (const clean of cleanup.splice(0)) await clean() })

describe('linked folder authority and project lifecycle', () => {
  it('links existing files using real hashes without embedding original bytes', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'report.md'), 'Independent linked clearance17')
    const linked = await h.library.linkFolder(h.physical, 'Client reports', h.scope.id); await h.idle()
    expect(linked.linkedFolders?.[0]).toMatchObject({ name: 'Client reports', status: 'ready', path: h.physical })
    const entry = h.library.catalogue(h.scope.id).files[0]
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(entry.storage).toMatchObject({ kind: 'linked', relativePath: 'report.md', fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(entry.storage!.fingerprint).not.toBe(entry.sha256)
    expect(await readdir(h.library.snapshot().blobDir)).toEqual([])
    expect((await h.library.search('clearance17', h.scope.id))[0].id).toBe(entry.id)
    expect((await h.library.read(entry.id, entry.revision, h.scope.id)).text).toContain('Independent linked clearance17')
  })
  it('creates a new physical folder and refuses silently adopting an existing one', async () => {
    const h = await fixture()
    const catalogue = await h.library.createFolder(h.physical, 'new-project', 'Project outputs', h.scope.id)
    expect(await readdir(join(h.physical, 'new-project'))).toEqual([])
    expect(catalogue.linkedFolders?.[0]).toMatchObject({ name: 'Project outputs', status: 'ready' })
    await expect(h.library.createFolder(h.physical, 'new-project', undefined, h.scope.id)).rejects.toThrow('already exists')
    await expect(h.library.createFolder(h.physical, '../escape', undefined, h.scope.id)).rejects.toThrow('single new folder name')
  })
  it('retains large datasets as metadata-only rows without hashing or parsing their contents', async () => {
    const h = await fixture(), path = join(h.physical, 'large.sqlite'), handle = await open(path, 'w')
    try { await handle.truncate(200 * 1024 ** 2) } finally { await handle.close() }
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const entry = h.library.catalogue(h.scope.id).files[0]
    expect(entry).toMatchObject({ sha256: '', bytes: 200 * 1024 ** 2, status: 'stored' })
    expect(h.extractor).not.toHaveBeenCalled()
    expect(validateLibrary(h.library.snapshot().library).files).toHaveLength(1)
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('BUDGET_LIMIT')
    await expect(h.library.materialiseOriginal(entry.id, entry.revision, h.scope.id)).rejects.toThrow('metadata-only')
    expect(h.library.catalogue(h.scope.id).linkedFolders?.[0].status).toBe('ready')
  })
  it('excludes ignored/credential files, symlinks and hard-linked aliases without modifying any source', async () => {
    const h = await fixture(), outside = join(h.dir, 'outside.txt')
    await writeFile(outside, 'PRIVATE_OUTSIDE'); await writeFile(join(h.physical, '.env'), 'TOKEN=private'); await writeFile(join(h.physical, '.ourgeoignore'), 'ignored.txt\n')
    await writeFile(join(h.physical, 'ignored.txt'), 'IGNORED'); await writeFile(join(h.physical, 'good.md'), 'Allowed')
    await symlink(outside, join(h.physical, 'alias.md')); await link(outside, join(h.physical, 'hard-alias.md'))
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    expect(h.library.catalogue(h.scope.id).files.map(file => file.name)).toEqual(['good.md'])
    expect(h.library.catalogue(h.scope.id).linkedFolders?.[0].omitted).toBeGreaterThanOrEqual(4)
    await expect(readFile(outside, 'utf8')).resolves.toBe('PRIVATE_OUTSIDE')
  })
  it('allows explicitly selected output roots and keeps ordinary databases visible', async () => {
    const h = await fixture(), output = join(h.dir, 'build'); await mkdir(output); await writeFile(join(output, 'project.db'), 'A small local database asset')
    await h.library.linkFolder(output, undefined, h.scope.id); await h.idle()
    expect(h.library.catalogue(h.scope.id).files[0]).toMatchObject({ name: 'project.db', mediaType: 'application/octet-stream' })
  })
  it('deduplicates canonical roots and rejects overlapping parent/child grants', async () => {
    const h = await fixture(); await mkdir(join(h.physical, 'nested'))
    await h.library.linkFolder(h.physical, 'Existing root', h.scope.id); await h.idle()
    await h.library.linkFolder(h.physical, 'Ignored duplicate label', h.scope.id)
    expect(h.library.catalogue(h.scope.id).linkedFolders).toHaveLength(1)
    await expect(h.library.linkFolder(join(h.physical, 'nested'), undefined, h.scope.id)).rejects.toThrow('overlaps Existing root')
    await expect(h.library.linkFolder(h.dir, undefined, h.scope.id)).rejects.toThrow('overlaps Existing root')
  })
  it('keeps unmodified rescan and local reopen revisions stable and reuses encrypted extraction', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'reference.md'), 'Stable content')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const saved = h.library.snapshot(), before = h.library.catalogue(h.scope.id)
    await h.library.committed(saved, h.scope.projectId!, h.bundle, 'saved-signature', true)
    h.extractor.mockClear()
    await h.library.rescanFolders(undefined, h.scope.id); await h.idle()
    expect(h.library.catalogue(h.scope.id).revision).toBe(before.revision)
    expect(h.extractor).not.toHaveBeenCalled()
    h.library.scopeChanged()
    const reopened = h.make()
    await reopened.activate(h.scope.projectId!, h.bundle, saved.library, saved.blobDir, 'saved-signature', true)
    await expect.poll(() => reopened.catalogue(h.scope.id).linkedFolders?.[0].status, { timeout: 5000 }).toBe('ready'); await h.idle(reopened)
    expect(reopened.catalogue(h.scope.id)).toMatchObject({ revision: before.revision, savedRevision: before.revision })
    expect(reopened.catalogue(h.scope.id).files[0].revision).toBe(before.files[0].revision)
    expect(h.extractor).not.toHaveBeenCalled()
    const encrypted = await readFile(join(h.root, h.scope.projectId!, 'linked-roots.enc'))
    expect(encrypted.includes(Buffer.from(h.physical))).toBe(false)
  })
  it('qualifies cached evidence by media type when CSV and plain text have identical bytes', async () => {
    const h = await fixture(), content = 'code,value\n00123,17'
    await writeFile(join(h.physical, 'example.csv'), content); await writeFile(join(h.physical, 'example.txt'), content)
    h.extractor.mockImplementation(async (path, media?: string, _signal?: AbortSignal, originalName?: string) => extractDocument(path, media ?? 'text/plain', originalName ?? 'reference'))
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const files = h.library.catalogue(h.scope.id).files, csv = files.find(file => file.name === 'example.csv')!, text = files.find(file => file.name === 'example.txt')!
    expect(csv.sha256).toBe(text.sha256)
    const table = await h.library.previewTable(csv.id, csv.revision, h.scope.id)
    expect(table.rows[1].cells.map(cell => cell.value)).toEqual(['00123', '17'])
    const plain = await h.library.read(text.id, text.revision, h.scope.id, undefined, 0, true)
    expect(plain.text).toContain(content); expect(plain.text).not.toContain('Row 1:')
    const snapshot = h.library.snapshot()
    await h.library.committed(snapshot, h.scope.projectId!, h.bundle, 'typed-cache-saved', true)
    h.extractor.mockClear()
    const reopened = h.make()
    await reopened.activate(h.scope.projectId!, h.bundle, snapshot.library, snapshot.blobDir, 'typed-cache-saved', true)
    await expect.poll(() => reopened.catalogue(h.scope.id).linkedFolders?.[0].status).toBe('ready'); await h.idle(reopened)
    expect((await reopened.previewTable(csv.id, csv.revision, h.scope.id)).rows[1].cells.map(cell => cell.value)).toEqual(['00123', '17'])
    expect((await reopened.read(text.id, text.revision, h.scope.id, undefined, 0, true)).text).toContain(content)
    expect(h.extractor).not.toHaveBeenCalled()
  })
  it('requires relinking an imported catalogue in a different local profile', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'reference.md'), 'Local authority only')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const snapshot = h.library.snapshot(), foreign = h.make(join(h.dir, 'foreign-profile'))
    await foreign.activate(h.scope.projectId!, h.bundle, snapshot.library, snapshot.blobDir, 'portable', true)
    expect(foreign.catalogue(h.scope.id).linkedFolders?.[0]).toMatchObject({ status: 'unlinked' })
    expect(foreign.catalogue(h.scope.id).linkedFolders?.[0].path).toBeUndefined()
    const entry = foreign.catalogue(h.scope.id).files[0]
    await expect(foreign.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('relink or rescan')
    await foreign.relinkFolder(entry.storage!.folderId, h.physical, h.scope.id); await h.idle(foreign)
    expect((await foreign.search('authority', h.scope.id))).toHaveLength(1)
  })
  it('revokes changed sources and preserves user metadata when rescanned', async () => {
    const h = await fixture(), path = join(h.physical, 'reference.md'); await writeFile(path, 'Old requirement')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    let entry = h.library.catalogue(h.scope.id).files[0]
    await h.library.update(entry.id, entry.revision, { role: 'standard', userDescription: 'User interpretation', name: 'Client standard' }, h.scope.id)
    entry = h.library.catalogue(h.scope.id).files[0]
    await writeFile(path, 'NEW_CLEARANCE_42')
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow()
    expect(await h.library.search('Old requirement', h.scope.id)).toEqual([])
    await h.library.rescanFolders(undefined, h.scope.id); await h.idle()
    const current = h.library.catalogue(h.scope.id).files[0]
    expect(current).toMatchObject({ id: entry.id, name: 'Client standard', role: 'standard', userDescription: 'User interpretation', descriptionNeedsReview: true })
    expect(current.revision).not.toBe(entry.revision)
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('STALE_REFERENCE')
    expect((await h.library.read(current.id, current.revision, h.scope.id)).text).toContain('NEW_CLEARANCE_42')
  })
  it('rechecks current ignore rules before delivering cached evidence', async () => {
    const h = await fixture(), path = join(h.physical, 'reference.md'); await writeFile(path, 'NOW_PRIVATE_SENTINEL')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const entry = h.library.catalogue(h.scope.id).files[0]
    await writeFile(join(h.physical, '.ourgeoignore'), 'reference.md\n')
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow()
    expect(await h.library.search('NOW_PRIVATE_SENTINEL', h.scope.id)).toEqual([])
    await h.library.rescanFolders(undefined, h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
  })
  it('provides immutable temporary snapshots and deletes them after release', async () => {
    const h = await fixture(), path = join(h.physical, 'reference.md'); await writeFile(path, 'Original snapshot bytes')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const entry = h.library.catalogue(h.scope.id).files[0], snapshot = await h.library.materialiseOriginal(entry.id, entry.revision, h.scope.id)
    expect(snapshot.path).not.toBe(path)
    await writeFile(path, 'Changed after snapshot')
    await expect(readFile(snapshot.path, 'utf8')).resolves.toBe('Original snapshot bytes')
    await snapshot.release(); await expect(readFile(snapshot.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not publish extraction results when a linked source changes while its snapshot is parsed', async () => {
    const h = await fixture(), path = join(h.physical, 'racing.md'); await writeFile(path, 'OLD_PARSE_SENTINEL')
    let signalCaptured!: () => void, releaseParser!: () => void
    const captured = new Promise<void>(resolve => { signalCaptured = resolve }), parserMayFinish = new Promise<void>(resolve => { releaseParser = resolve })
    h.extractor.mockImplementation(async snapshotPath => {
      const text = await readFile(snapshotPath, 'utf8'); signalCaptured(); await parserMayFinish
      return { version: 'project-files-1', status: 'searchable', description: 'Parsed old snapshot', coverage: 'One line.', sections: [{ title: 'Old', location: { kind: 'lines', start: 1, end: 1 }, text }] }
    })
    await h.library.linkFolder(h.physical, undefined, h.scope.id)
    await captured
    await writeFile(path, 'NEW_SOURCE_SENTINEL')
    releaseParser(); await h.idle()
    expect(await h.library.search('OLD_PARSE_SENTINEL', h.scope.id)).toEqual([])
    expect(h.library.catalogue(h.scope.id).linkedFolders?.[0].status).toBe('needs-scan')
    expect(await readdir(join(h.root, h.scope.projectId!, 'snapshots'))).toEqual([])
  })
  it('transfers authorised roots during host-controlled Save As while leaving a fresh identity unlinked', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'reference.md'), 'Host-authorised Save As evidence')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const snapshot = h.library.snapshot(), oldId = h.scope.projectId!
    h.scope.projectId = randomUUID(); h.scope.id = 'save-as-lease'
    await h.library.committed(snapshot, h.scope.projectId, join(h.dir, 'copy.ourgeoproj'), 'copy-saved', true)
    await expect.poll(() => h.library.catalogue(h.scope.id).linkedFolders?.[0].status).toBe('ready'); await h.idle()
    expect((await h.library.search('Save As evidence', h.scope.id))).toHaveLength(1)
    expect(await readFile(join(h.root, h.scope.projectId, 'linked-roots.enc'))).not.toEqual(await readFile(join(h.root, oldId, 'linked-roots.enc')))
    const copiedCatalogue = h.library.snapshot()
    h.scope.projectId = randomUUID(); h.scope.id = 'foreign-identity-lease'
    const foreign = h.make()
    await foreign.activate(h.scope.projectId, join(h.dir, 'foreign.ourgeoproj'), copiedCatalogue.library, copiedCatalogue.blobDir, 'foreign-saved', true)
    expect(foreign.catalogue(h.scope.id).linkedFolders?.[0].status).toBe('unlinked')
  })
  it('discards an unsaved link without removing its physical files or retaining project access', async () => {
    const h = await fixture(), source = join(h.physical, 'report.md'); await writeFile(source, 'Preserved source')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const old = h.library.catalogue(h.scope.id).files[0]
    await h.library.discard(h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
    expect(h.library.catalogue(h.scope.id).linkedFolders).toBeUndefined()
    await expect(h.library.read(old.id, old.revision, h.scope.id)).rejects.toThrow('SOURCE_UNAVAILABLE')
    await expect(readFile(source, 'utf8')).resolves.toBe('Preserved source')
  })
  it('refuses a grant whose canonical root was replaced by another directory or symlink', async () => {
    const h = await fixture(), path = join(h.physical, 'reference.md'); await writeFile(path, 'Allowed original')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const entry = h.library.catalogue(h.scope.id).files[0]
    await rename(h.physical, `${h.physical}-old`); await mkdir(h.physical); await writeFile(path, 'UNAUTHORISED_REPLACEMENT')
    await expect(h.library.materialiseOriginal(entry.id, entry.revision, h.scope.id)).rejects.toThrow()
    expect(await h.library.search('Allowed', h.scope.id)).toEqual([])
  })
  it('removes linked entries through project ignores and forgets roots without disk deletion or resurrection', async () => {
    const h = await fixture(), path = join(h.physical, 'reference.md'); await writeFile(path, 'Keep physical bytes')
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const before = h.library.catalogue(h.scope.id), entry = before.files[0], folderId = entry.storage!.folderId
    await h.library.remove([entry.id], h.scope.id); await h.library.rescanFolders([folderId], h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
    await expect(readFile(path, 'utf8')).resolves.toBe('Keep physical bytes')
    await h.library.undo(h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toHaveLength(1)
    await h.library.forgetFolder(folderId, h.scope.id)
    await h.library.rescanFolders([folderId], h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
    expect(h.library.catalogue(h.scope.id).linkedFolders).toBeUndefined()
    await h.library.undo(h.scope.id)
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
    await expect(readFile(path, 'utf8')).resolves.toBe('Keep physical bytes')
  })
  it('writes version3 portable bundles with linked metadata and no grant paths or linked blobs', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'reference.md'), 'External original')
    await h.library.linkFolder(h.physical, 'Client library', h.scope.id); await h.idle()
    const snapshot = h.library.snapshot(), destination = join(h.dir, 'linked.ourgeoproj')
    await writeBundle({ destination, manifest: JSON.stringify({ version: 1, projectId: h.scope.projectId, ui: {} }), envPath: null, library: snapshot.library, blobDir: snapshot.blobDir, upgrade: true }, join(h.dir, 'save'))
    const zip = new AdmZip(destination), entries = zip.getEntries()
    expect(entries.some(entry => entry.entryName.startsWith('files/blobs/'))).toBe(false)
    expect(zip.readAsText('files/catalogue.json')).not.toContain(h.physical)
    expect(zip.readAsText('files/catalogue.json')).not.toContain('linked-roots')
    const opened = await readBundle(destination, join(h.dir, 'opened'))
    expect(opened.manifest).toMatchObject({ version: 3, projectFiles: { version: 2, requiredCapabilities: ['linked-folders'] } })
    expect(opened.library.version).toBe(2)
    expect(opened.library.files[0].storage?.relativePath).toBe('reference.md')
  })
  it('rejects portable path traversal and oversized embedded fakes', async () => {
    const h = await fixture(), handle = await open(join(h.physical, 'large.bin'), 'w')
    try { await handle.truncate(101 * 1024 ** 2) } finally { await handle.close() }
    await h.library.linkFolder(h.physical, undefined, h.scope.id); await h.idle()
    const snapshot = h.library.snapshot().library
    expect(() => validateLibrary({ ...snapshot, files: [{ ...snapshot.files[0], storage: { ...snapshot.files[0].storage, relativePath: '../secret' } }] })).toThrow('Linked file metadata')
    expect(() => validateLibrary({ version: 1, revision: 1, files: [{ ...snapshot.files[0], storage: undefined }] })).toThrow()
  })
  it('bounds scanner discovery and reports omissions instead of claiming complete coverage', async () => {
    const h = await fixture(); await writeFile(join(h.physical, 'one.txt'), 'One'); await writeFile(join(h.physical, 'two.txt'), 'Two')
    const grant = await authoriseLinkedFolder(h.physical), result = await scanLinkedFolder(grant, [], 1)
    expect(result.files).toHaveLength(1); expect(result.limited).toBe(true)
    const original = await inspectLinkedFile(grant, result.files[0].relativePath, [], result.files[0].fingerprint)
    expect(original.sha256).toBe(result.files[0].sha256)
  })
})
