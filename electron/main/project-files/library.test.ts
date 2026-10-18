import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { ProjectFileLibrary } from './library'
import { emptyLibrary } from './catalogue'
import { fixtureBytes, fixtureExtraction } from './test-fixtures'
import { extractDocument } from './extraction'
import type { ProjectFileExtraction } from '../../../src/lib/project-files'

const directories: string[] = []
const shutdown: (() => void)[] = []
async function harness(named = true) {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-library-')); directories.push(directory)
  const scope = { id: 'lease-1', projectId: named ? 'project-one' : null as string | null }
  const extract = vi.fn(async (path: string): Promise<ProjectFileExtraction> => ({ ...fixtureExtraction(), sections: [{ ...fixtureExtraction().sections[0], text: (await readFile(path, 'utf8')).trim() }] }))
  const changed = vi.fn(), incoming = join(directory, 'incoming'), root = join(directory, 'library'), path = join(directory, 'reference.md')
  await mkdir(incoming); await writeFile(path, fixtureBytes)
  let keyAvailable = true
  const key = vi.fn(async () => { if (!keyAvailable) throw new Error('Protected storage is locked'); return Buffer.alloc(32, 7) })
  const instances: ProjectFileLibrary[] = []
  const make = (version = 'project-files-1') => { const instance = new ProjectFileLibrary(root, () => scope, changed, extract, key, version); instances.push(instance); return instance }
  shutdown.push(() => { scope.projectId = null; instances.forEach(instance => instance.scopeChanged()) })
  const library = make()
  if (named) await library.activate(scope.projectId!, join(directory, 'project.ourgeoproj'), emptyLibrary(), incoming, 'base-signature', false)
  const settled = async (instance = library): Promise<void> => { await expect.poll(() => instance.catalogue(scope.id).operation, { timeout: 3000 }).toBeUndefined() }
  return { directory, scope, library, path, incoming, extract, changed, make, settled, key, setKeyAvailable: (available: boolean) => { keyAvailable = available } }
}
afterEach(async () => { shutdown.splice(0).forEach(stop => stop()); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 }))) })

describe('project-owned file library', () => {
  it('requires a named saved project before importing originals', async () => {
    const h = await harness(false)
    await expect(h.library.add([h.path], h.scope.id)).rejects.toThrow('Save project to add files')
    expect(h.library.catalogue(h.scope.id).files).toEqual([])
    expect(h.extract).not.toHaveBeenCalled()
  })
  it('keeps the previous project usable if a new project journal cannot be persisted', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0], before = h.library.snapshot(), originalOpen = fsPromises.open
    const nextDir = join(h.directory, 'library', 'failed-next-project')
    const spy = vi.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof fsPromises.open>) => {
      if (String(args[0]).startsWith(join(nextDir, 'draft.json.'))) throw Object.assign(new Error('simulated full disk while persisting next project'), { code: 'ENOSPC' })
      return originalOpen(...args)
    })
    syncBuiltinESMExports()
    try {
      await expect(h.library.activate('failed-next-project', join(h.directory, 'next.ourgeoproj'), emptyLibrary(), h.incoming, 'next-signature', false)).rejects.toThrow('simulated full disk')
      expect(h.library.catalogue(h.scope.id)).toMatchObject({ projectId: h.scope.projectId })
      expect(h.library.snapshot().library).toEqual(before.library)
      expect((await h.library.read(entry.id, entry.revision, h.scope.id)).text).toContain('17 metres')
    } finally { spy.mockRestore(); syncBuiltinESMExports() }
  })
  it('returns durable queued imports before background extraction completes', async () => {
    const h = await harness(), imported = await h.library.add([h.path], h.scope.id)
    expect(imported.errors).toEqual([]); expect(imported.ids).toHaveLength(1)
    expect(imported.catalogue.files[0]).toMatchObject({ status: 'queued', saved: false })
    const snapshot = h.library.snapshot()
    await expect(readFile(join(snapshot.blobDir, snapshot.library.files[0].sha256))).resolves.toEqual(fixtureBytes)
    await h.settled()
    expect(h.library.catalogue(h.scope.id).files[0].status).toBe('searchable')
    expect(h.extract).toHaveBeenCalledTimes(1)
  })
  it('acknowledges an import only after its original and journal directory entries are synced', async () => {
    const h = await harness(), projectDir = join(h.directory, 'library', h.scope.projectId!), blobDir = join(projectDir, 'blobs'), events: string[] = []
    const originalOpen = fsPromises.open, originalRename = fsPromises.rename
    let reportBlocked!: () => void, releaseSync!: () => void, blockedOnce = false, acknowledged = false
    const blocked = new Promise<void>(resolve => { reportBlocked = resolve }), released = new Promise<void>(resolve => { releaseSync = resolve })
    const openSpy = vi.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args), path = String(args[0])
      if (args[1] === 'r' && [projectDir, blobDir].includes(path)) {
        const originalSync = handle.sync.bind(handle)
        handle.sync = async () => {
          if (path === blobDir && !blockedOnce) { blockedOnce = true; reportBlocked(); await released }
          await originalSync(); events.push(`synced:${path}`)
        }
      }
      return handle
    })
    const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => { await originalRename(...args); events.push(`renamed:${String(args[1])}`) })
    syncBuiltinESMExports()
    try {
      const importing = h.library.add([h.path], h.scope.id).then(result => { acknowledged = true; events.push('acknowledged'); return result })
      await blocked
      expect(acknowledged).toBe(false)
      releaseSync()
      const imported = await importing
      expect(imported.errors).toEqual([])
      const originalPath = join(blobDir, imported.catalogue.files[0].sha256)
      expect(events.indexOf(`renamed:${originalPath}`)).toBeLessThan(events.indexOf(`synced:${blobDir}`))
      expect(events.indexOf(`synced:${blobDir}`)).toBeLessThan(events.indexOf(`renamed:${join(projectDir, 'draft.json')}`))
      expect(events.indexOf(`renamed:${join(projectDir, 'draft.json')}`)).toBeLessThan(events.indexOf(`synced:${projectDir}`))
      expect(events.indexOf(`synced:${projectDir}`)).toBeLessThan(events.indexOf('acknowledged'))
      await h.settled()
    } finally { releaseSync(); openSpy.mockRestore(); renameSpy.mockRestore(); syncBuiltinESMExports() }
  })
  it('keeps the just-attached original revision through first indexing, and revokes it on a parser upgrade', async () => {
    const h = await harness(), imported = await h.library.add([h.path], h.scope.id)
    const attachedRevision = imported.catalogue.files[0].revision
    await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    expect(entry.revision).toBe(attachedRevision)
    const snapshot = h.library.snapshot()
    await h.library.committed(snapshot, h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), 'saved-signature', true)
    h.extract.mockImplementation(async () => ({ ...fixtureExtraction(), version: 'project-files-2', sections: [{ ...fixtureExtraction().sections[0], text: 'Changed extraction evidence with identical discovery metadata.' }] }))
    const upgraded = h.make('project-files-2')
    await upgraded.activate(h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), snapshot.library, snapshot.blobDir, 'saved-signature', true)
    await expect.poll(() => upgraded.catalogue(h.scope.id).files[0].revision, { timeout: 3000 }).not.toBe(attachedRevision)
    await h.settled(upgraded)
    await expect(upgraded.read(entry.id, attachedRevision, h.scope.id)).rejects.toThrow('STALE_REFERENCE')
  })
  it('reuses identical bytes and distinguishes different files with the same name', async () => {
    const h = await harness(), imported = await h.library.add([h.path], h.scope.id)
    await h.settled()
    const repeated = await h.library.add([h.path], h.scope.id)
    expect(repeated.ids).toEqual(imported.ids); expect(repeated.catalogue.files).toHaveLength(1)
    await h.settled()
    const folder = join(h.directory, 'other'); await mkdir(folder)
    const another = join(folder, 'reference.md'); await writeFile(another, 'Different bytes')
    const distinct = await h.library.add([another], h.scope.id)
    expect(distinct.catalogue.files.map(file => file.name)).toEqual(['reference.md', 'reference.md (2)'])
    await h.settled()
  })
  it('keeps successful batch imports when another selected path is invalid', async () => {
    const h = await harness(), imported = await h.library.add([join(h.directory, 'missing.pdf'), h.path], h.scope.id)
    expect(imported.ids).toHaveLength(1); expect(imported.errors).toHaveLength(1)
    expect(imported.errors[0]).toContain('missing.pdf'); await h.settled()
  })
  it('preserves user descriptions and roles through reindex and replacement', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    let entry = h.library.catalogue(h.scope.id).files[0]
    await h.library.update(entry.id, entry.revision, { name: 'Client standard', folder: 'Standards', role: 'standard', userDescription: 'Follow section 4 for map labels.' }, h.scope.id)
    entry = h.library.catalogue(h.scope.id).files[0]
    await h.library.reindex([entry.id], h.scope.id)
    entry = h.library.catalogue(h.scope.id).files[0]
    expect(entry).toMatchObject({ name: 'Client standard', role: 'standard', folder: 'Standards', userDescription: 'Follow section 4 for map labels.', descriptionNeedsReview: false })
    const replacement = join(h.directory, 'revised.md'); await writeFile(replacement, 'Revised clearance: 22 metres')
    await h.library.replace(entry.id, entry.revision, replacement, h.scope.id); await h.settled()
    const revised = h.library.catalogue(h.scope.id).files[0]
    expect(revised).toMatchObject({ name: 'Client standard', role: 'standard', userDescription: 'Follow section 4 for map labels.', descriptionNeedsReview: true, originalName: 'revised.md' })
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('STALE_REFERENCE')
    const read = await h.library.read(revised.id, revised.revision, h.scope.id)
    expect(read.text).toContain('Revised clearance: 22 metres')
  })
  it('searches extracted contents and returns stable revision and location evidence', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const hits = await h.library.search('clearance', h.scope.id)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ title: 'reference.md', location: { kind: 'lines', start: 1, end: 1 } })
    expect(hits[0].excerpt).toContain('17 metres')
    expect((await h.library.read(hits[0].id, hits[0].revision, h.scope.id)).text).toContain('17 metres')
  })
  it('reads a CSV physical-line span without including the next logical row', async () => {
    const h = await harness(), csvPath = join(h.directory, 'quoted.csv')
    await writeFile(csvPath, 'code,note\r\n00123,"two\nlines"\r\nNEXTROW,not-in-selection')
    h.extract.mockImplementation(async path => extractDocument(path, 'text/csv', 'quoted.csv'))
    await h.library.add([csvPath], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    const read = await h.library.read(entry.id, entry.revision, h.scope.id, { kind: 'lines', start: 2, end: 3 })
    expect(read.text).toContain('00123'); expect(read.text).toContain('two'); expect(read.text).toContain('lines')
    expect(read.text).not.toContain('NEXTROW'); expect(read.text).not.toContain('not-in-selection')
  })
  it('reads an exact spreadsheet range without neighbouring cell titles or values', async () => {
    const h = await harness()
    h.extract.mockImplementation(async () => ({ ...fixtureExtraction(), sections: [
      { title: 'Measurements: structure', location: { kind: 'sheet', sheet: 'Measurements' }, text: 'Merged ranges: none; date system1900.' },
      { title: 'Measurements!A1', location: { kind: 'sheet', sheet: 'Measurements', range: 'A1' }, text: 'A1: selected-clearance-17' },
      { title: 'Measurements!B1', location: { kind: 'sheet', sheet: 'Measurements', range: 'B1' }, text: 'B1: NEIGHBOUR_VALUE' },
      { title: 'Measurements!G80', location: { kind: 'sheet', sheet: 'Measurements', range: 'G80' }, text: 'G80: DISTANT_VALUE' }
    ] }))
    await h.library.add([h.path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    const read = await h.library.read(entry.id, entry.revision, h.scope.id, { kind: 'sheet', sheet: 'Measurements', range: 'A1' })
    expect(read.text).toContain('selected-clearance-17')
    expect(read.text).not.toContain('B1'); expect(read.text).not.toContain('G80')
    expect(read.text).not.toContain('NEIGHBOUR_VALUE'); expect(read.text).not.toContain('DISTANT_VALUE')
  })
  it('encrypts cached extracted contents and restores them without reparsing', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const snapshot = h.library.snapshot(), entry = snapshot.library.files[0]
    const indexDirectory = join(h.directory, 'library', h.scope.projectId!, 'index')
    const indexName = (await readdir(indexDirectory)).find(name => name.startsWith(`${entry.sha256}-`))!
    const index = await readFile(join(indexDirectory, indexName))
    expect(index.includes(Buffer.from('clearance 17 metres'))).toBe(false)
    await h.library.committed(snapshot, h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), 'saved-signature', true)
    h.extract.mockClear()
    const reopened = h.make()
    await reopened.activate(h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), snapshot.library, snapshot.blobDir, 'saved-signature', true)
    await expect.poll(async () => (await reopened.search('clearance', h.scope.id)).length).toBe(1)
    expect(h.extract).not.toHaveBeenCalled()
  })
  it('recovers unsaved imports after restart and can explicitly discard the draft', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const restarted = h.make()
    await restarted.activate(h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), emptyLibrary(), h.incoming, 'base-signature', false)
    expect(restarted.catalogue(h.scope.id)).toMatchObject({ savedRevision: 0, notice: expect.stringContaining('Recovered unsaved') })
    expect(restarted.catalogue(h.scope.id).files).toHaveLength(1)
    await h.settled(restarted)
    await restarted.discard(h.scope.id)
    expect(restarted.catalogue(h.scope.id).files).toEqual([])
  })
  it('preserves a conflicting recovery draft instead of merging into an externally changed bundle', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const restarted = h.make()
    await restarted.activate(h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), emptyLibrary(), h.incoming, 'external-signature', false)
    expect(restarted.catalogue(h.scope.id).files).toEqual([])
    expect(restarted.catalogue(h.scope.id).notice).toContain('preserved')
    expect((await readdir(join(h.directory, 'library', h.scope.projectId!))).some(name => name.startsWith('recovery-'))).toBe(true)
  })
  it('recovers a conflicting draft only into a distinct saved project copy and preserves both bundles', async () => {
    const h = await harness(), originalBundle = join(h.directory, 'project.ourgeoproj'), copyBundle = join(h.directory, 'project-copy.ourgeoproj')
    await writeFile(originalBundle, 'EXTERNAL_SAVED_BUNDLE'); await writeFile(copyBundle, 'INDEPENDENT_SAVED_COPY')
    await h.library.add([h.path], h.scope.id); await h.settled()
    const imported = h.library.snapshot().library.files[0]
    // A newer external catalogue revision must not hide an older unsaved draft.
    await h.library.activate(h.scope.projectId!, originalBundle, { ...emptyLibrary(), revision: 100 }, h.incoming, 'newer-external-signature', false)
    const recovery = h.library.catalogue(h.scope.id).recoveries?.[0]
    expect(recovery).toBeDefined()
    await expect(h.library.recoverIntoCopy(recovery!.id, h.scope.id)).rejects.toThrow('Save As a new project')
    h.scope.projectId = 'independent-project-copy'; h.scope.id = 'copy-lease'
    await h.library.activate(h.scope.projectId, copyBundle, emptyLibrary(), h.incoming, 'copy-signature', false)
    const recovered = await h.library.recoverIntoCopy(recovery!.id, h.scope.id)
    expect(recovered.files).toHaveLength(1); expect(recovered.files[0]).toMatchObject({ id: imported.id, saved: false })
    await h.settled()
    const original = await h.library.original(recovered.files[0].id, h.library.catalogue(h.scope.id).files[0].revision, h.scope.id)
    await expect(readFile(original.path)).resolves.toEqual(fixtureBytes)
    await expect(readFile(originalBundle)).resolves.toEqual(Buffer.from('EXTERNAL_SAVED_BUNDLE'))
    await expect(readFile(copyBundle)).resolves.toEqual(Buffer.from('INDEPENDENT_SAVED_COPY'))
    expect((await readdir(join(h.directory, 'library', 'project-one'))).some(name => name.startsWith('recovery-'))).toBe(true)
  })
  it('previews CSV strings containing literal delimiters and escaped quotes without losing values', async () => {
    const h = await harness(), path = join(h.directory, 'literal.csv')
    await writeFile(path, 'code,note\n00123,"literal | 2: ""quoted"" value, with comma"')
    h.extract.mockImplementation(async source => extractDocument(source, 'text/csv', 'literal.csv'))
    await h.library.add([path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    const preview = await h.library.previewTable(entry.id, entry.revision, h.scope.id)
    expect(preview.rows[1].cells).toEqual([
      { address: 'A2', value: '00123', raw: '00123', type: 'string' },
      { address: 'B2', value: 'literal | 2: "quoted" value, with comma', raw: 'literal | 2: "quoted" value, with comma', type: 'string' }
    ])
  })
  it('previews an XLSX sheet range with typed cells and cached formula provenance', async () => {
    const h = await harness(), path = join(h.directory, 'typed.xlsx'); await writeFile(path, 'workbook original fixture')
    h.extract.mockImplementation(async () => ({ ...fixtureExtraction(), sections: [
      { title: 'Measurements!A1', location: { kind: 'sheet', sheet: 'Measurements', range: 'A1' }, text: 'A1: {"type":"s","raw":"0","displayed":"00123"}' },
      { title: 'Measurements!B1', location: { kind: 'sheet', sheet: 'Measurements', range: 'B1' }, text: 'B1: {"type":"n","raw":"7","displayed":"7.00","formula":"SUM(A2:A3)"}' },
      { title: 'Measurements!C1', location: { kind: 'sheet', sheet: 'Measurements', range: 'C1' }, text: 'C1: {"type":"s","raw":"1","displayed":"NEIGHBOUR"}' },
      { title: 'Other!A1', location: { kind: 'sheet', sheet: 'Other', range: 'A1' }, text: 'A1: {"type":"s","raw":"2","displayed":"OTHER_SHEET"}' }
    ] }))
    await h.library.add([path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    const preview = await h.library.previewTable(entry.id, entry.revision, h.scope.id, { kind: 'sheet', sheet: 'Measurements', range: 'A1:B1' })
    expect(preview.sheets).toEqual(['Measurements', 'Other']); expect(preview.columns).toEqual(['A', 'B'])
    expect(preview.rows[0].cells).toEqual([{ address: 'A1', value: '00123', raw: '0', type: 's', formula: undefined }, { address: 'B1', value: '7.00', raw: '7', type: 'n', formula: 'SUM(A2:A3)' }])
    expect(JSON.stringify(preview.rows)).not.toContain('NEIGHBOUR'); expect(JSON.stringify(preview.rows)).not.toContain('OTHER_SHEET')
  })
  it('uses a separate index for explicitly disclosed hidden workbook contents and revokes old references', async () => {
    const h = await harness(), path = join(h.directory, 'hidden.xlsx'); await writeFile(path, 'original workbook fixture')
    h.extract.mockImplementation(async (_path, _media?: string, _signal?: AbortSignal, _name?: string, options?: { includeHidden?: boolean }) => ({ ...fixtureExtraction(), sections: [{ title: 'Visible sheet', location: { kind: 'sheet', sheet: 'Visible', range: 'A1' }, text: options?.includeHidden ? 'EXPLICIT_HIDDEN_SENTINEL' : 'Visible ordinary evidence' }] }))
    await h.library.add([path], h.scope.id); await h.settled()
    let entry = h.library.catalogue(h.scope.id).files[0]
    expect(await h.library.search('EXPLICIT_HIDDEN_SENTINEL', h.scope.id)).toEqual([])
    const oldRevision = entry.revision
    await h.library.setIncludeHidden(entry.id, entry.revision, true, h.scope.id); await h.settled()
    entry = h.library.catalogue(h.scope.id).files[0]
    expect(entry.includeHidden).toBe(true)
    expect(await h.library.search('EXPLICIT_HIDDEN_SENTINEL', h.scope.id)).toHaveLength(1)
    await expect(h.library.read(entry.id, oldRevision, h.scope.id)).rejects.toThrow('STALE_REFERENCE')
    await h.library.setIncludeHidden(entry.id, entry.revision, false, h.scope.id); await h.settled()
    expect(await h.library.search('EXPLICIT_HIDDEN_SENTINEL', h.scope.id)).toEqual([])
  })
  it('does not let a delayed cache warm restore a revoked hidden-content selection', async () => {
    const h = await harness(), path = join(h.directory, 'racing.xlsx'); await writeFile(path, 'Workbook original fixture')
    h.extract.mockImplementation(async (_path, _media?: string, _signal?: AbortSignal, _name?: string, options?: { includeHidden?: boolean }) => ({ ...fixtureExtraction(), sections: [{ title: 'Workbook', location: { kind: 'sheet', sheet: 'Sheet', range: 'A1' }, text: options?.includeHidden ? 'REVOKED_HIDDEN_SENTINEL' : 'Visible safe text' }] }))
    await h.library.add([path], h.scope.id); await h.settled()
    let entry = h.library.catalogue(h.scope.id).files[0]
    await h.library.setIncludeHidden(entry.id, entry.revision, true, h.scope.id); await h.settled()
    entry = h.library.catalogue(h.scope.id).files[0]
    const policyPath = join(h.directory, 'library', h.scope.projectId!, 'index', `${entry.id}.visibility`)
    let releaseRead!: () => void, reportRead!: () => void, intercept = true
    const blocked = new Promise<void>(resolve => { releaseRead = resolve }), captured = new Promise<void>(resolve => { reportRead = resolve })
    const originalRead = fsPromises.readFile
    const spy = vi.spyOn(fsPromises, 'readFile').mockImplementation((async (...args: Parameters<typeof fsPromises.readFile>) => {
      const bytes = await originalRead(...args)
      if (String(args[0]) === policyPath && intercept) { intercept = false; reportRead(); await blocked }
      return bytes
    }) as typeof fsPromises.readFile)
    syncBuiltinESMExports()
    try {
      h.library.scopeChanged()
      await captured
      await h.library.setIncludeHidden(entry.id, entry.revision, false, h.scope.id); await h.settled()
      const changesBeforeRelease = h.changed.mock.calls.length
      releaseRead()
      await expect.poll(() => h.changed.mock.calls.length).toBeGreaterThan(changesBeforeRelease)
      expect(h.library.catalogue(h.scope.id).files[0].includeHidden).toBe(false)
      expect(await h.library.search('REVOKED_HIDDEN_SENTINEL', h.scope.id)).toEqual([])
    } finally { releaseRead(); spy.mockRestore(); syncBuiltinESMExports() }
  })
  it('retains mutations made while a save snapshot is in flight', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const snapshot = h.library.snapshot(), before = snapshot.library.files[0]
    await h.library.update(before.id, before.revision, { name: 'Changed during save' }, h.scope.id)
    await h.library.committed(snapshot, h.scope.projectId!, join(h.directory, 'project.ourgeoproj'), 'new-signature', true)
    const after = h.library.catalogue(h.scope.id)
    expect(after.savedRevision).toBe(snapshot.library.revision)
    expect(after.revision).toBeGreaterThan(after.savedRevision)
    expect(after.files[0]).toMatchObject({ name: 'Changed during save', saved: false })
  })
  it('preserves an unconfirmed save as a recoverable draft if power loss restores the earlier archive', async () => {
    const h = await harness(), bundlePath = join(h.directory, 'project.ourgeoproj')
    await h.library.add([h.path], h.scope.id); await h.settled()
    const confirmed = h.library.snapshot()
    await h.library.committed(confirmed, h.scope.projectId!, bundlePath, 'confirmed-signature', true)
    const later = join(h.directory, 'later.md'); await writeFile(later, 'New original not in the confirmed archive')
    await h.library.add([later], h.scope.id); await h.settled()
    const pending = h.library.snapshot()
    await h.library.committed(pending, h.scope.projectId!, bundlePath, 'unconfirmed-published-signature', true, false)
    const unconfirmed = h.library.catalogue(h.scope.id)
    expect(unconfirmed.savedRevision).toBe(confirmed.library.revision)
    expect(unconfirmed.revision).toBeGreaterThan(unconfirmed.savedRevision)
    expect(unconfirmed.notice).toContain('durability was not confirmed')
    const journal = JSON.parse(await readFile(join(h.directory, 'library', h.scope.projectId!, 'draft.json'), 'utf8'))
    expect(journal.baseSignature).toBe('unconfirmed-published-signature')
    expect(journal.savedRevision).toBe(confirmed.library.revision)
    const restarted = h.make()
    await restarted.activate(h.scope.projectId!, bundlePath, confirmed.library, confirmed.blobDir, 'confirmed-signature', true)
    expect(restarted.catalogue(h.scope.id).recoveries?.[0].files).toBe(2)
    const preserved = (await readdir(join(h.directory, 'library', h.scope.projectId!))).find(name => name.startsWith('recovery-'))!
    const recovery = JSON.parse(await readFile(join(h.directory, 'library', h.scope.projectId!, preserved), 'utf8'))
    expect(recovery.draft.files.some((file: { name: string }) => file.name === 'later.md')).toBe(true)
    await h.settled(restarted)
  })
  it('retains both original and independent-copy drafts when Save As durability is unconfirmed', async () => {
    const h = await harness(), originalId = h.scope.projectId!, originalPath = join(h.directory, 'project.ourgeoproj')
    await h.library.add([h.path], h.scope.id); await h.settled()
    const confirmed = h.library.snapshot()
    await h.library.committed(confirmed, originalId, originalPath, 'original-confirmed-signature', true)
    const later = join(h.directory, 'copy-pending.md'); await writeFile(later, 'Pending Save As original')
    await h.library.add([later], h.scope.id); await h.settled()
    const pending = h.library.snapshot(), copyId = 'independent-unconfirmed-copy', copyPath = join(h.directory, 'copy.ourgeoproj')
    h.scope.projectId = copyId; h.scope.id = 'copy-lease'
    await h.library.committed(pending, copyId, copyPath, 'unconfirmed-copy-signature', true, false)
    expect(h.library.catalogue(h.scope.id)).toMatchObject({ savedRevision: 0, notice: expect.stringContaining('durability was not confirmed') })
    expect(h.library.catalogue(h.scope.id).files).toHaveLength(2)
    const originalJournal = JSON.parse(await readFile(join(h.directory, 'library', originalId, 'draft.json'), 'utf8'))
    expect(originalJournal.baseSignature).toBe('original-confirmed-signature')
    expect(originalJournal.savedRevision).toBe(confirmed.library.revision)
    expect(originalJournal.draft.files).toHaveLength(2)
    h.scope.projectId = originalId; h.scope.id = 'reopened-original-lease'
    await h.library.activate(originalId, originalPath, confirmed.library, confirmed.blobDir, 'original-confirmed-signature', true)
    expect(h.library.catalogue(h.scope.id).files).toHaveLength(2)
    expect(h.library.catalogue(h.scope.id).notice).toContain('Recovered unsaved')
    await h.settled()
    const copyJournal = JSON.parse(await readFile(join(h.directory, 'library', copyId, 'draft.json'), 'utf8'))
    expect(copyJournal.savedRevision).toBe(0)
    expect(copyJournal.draft.files).toHaveLength(2)
  })
  it('supports removal undo and refuses removed references until restored', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    await h.library.remove([entry.id], h.scope.id)
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('SOURCE_UNAVAILABLE')
    await h.library.undo(h.scope.id)
    expect(h.library.catalogue(h.scope.id).files[0].id).toBe(entry.id)
  })
  it('undoes only removal while preserving later imports, metadata edits and replacement bytes', async () => {
    const h = await harness(), secondPath = join(h.directory, 'second.md'), thirdPath = join(h.directory, 'third.md')
    await writeFile(secondPath, 'Second original'); await writeFile(thirdPath, 'Third imported later')
    await h.library.add([h.path, secondPath], h.scope.id); await h.settled()
    const before = h.library.catalogue(h.scope.id).files, removed = before.find(file => file.name === 'reference.md')!, edited = before.find(file => file.name === 'second.md')!
    await h.library.remove([removed.id], h.scope.id)
    await h.library.update(edited.id, edited.revision, { name: 'Renamed after removal', userDescription: 'Retain this edit' }, h.scope.id)
    await h.library.add([thirdPath], h.scope.id); await h.settled()
    const current = h.library.catalogue(h.scope.id).files.find(file => file.id === edited.id)!
    await writeFile(secondPath, 'Replacement after removal')
    await h.library.replace(current.id, current.revision, secondPath, h.scope.id); await h.settled()
    await h.library.undo(h.scope.id)
    const after = h.library.catalogue(h.scope.id).files
    expect(after).toHaveLength(3)
    expect(after.find(file => file.id === edited.id)).toMatchObject({ name: 'Renamed after removal', userDescription: 'Retain this edit' })
    const retained = after.find(file => file.id === edited.id)!
    expect((await h.library.read(retained.id, retained.revision, h.scope.id)).text).toContain('Replacement after removal')
    expect(after.some(file => file.id === removed.id)).toBe(true); expect(after.some(file => file.name === 'third.md')).toBe(true)
  })
  it('rechecks protected storage before delivering already cached assistant evidence', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0]
    expect(await h.library.search('clearance', h.scope.id)).toHaveLength(1)
    h.setKeyAvailable(false)
    await expect(h.library.search('clearance', h.scope.id)).rejects.toThrow('Protected storage is locked')
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('Protected storage is locked')
    expect((await h.library.read(entry.id, entry.revision, h.scope.id, undefined, 0, true)).text).toContain('17 metres')
  })
  it('lets a human preview hidden cells without changing assistant disclosure or source revision', async () => {
    const h = await harness(), path = join(h.directory, 'private.xlsx'); await writeFile(path, 'Workbook original fixture')
    h.extract.mockImplementation(async (_path, _media?: string, _signal?: AbortSignal, _name?: string, options?: { includeHidden?: boolean }) => ({ ...fixtureExtraction(), sections: [
      { title: 'Visible!A1', location: { kind: 'sheet', sheet: 'Visible', range: 'A1' }, text: 'A1: {"type":"s","displayed":"Visible evidence"}' },
      ...(options?.includeHidden ? [{ title: 'Hidden!A1', location: { kind: 'sheet' as const, sheet: 'Hidden', range: 'A1' }, text: 'A1: {"type":"s","displayed":"HUMAN_ONLY_SECRET"}' }] : [])
    ] }))
    await h.library.add([path], h.scope.id); await h.settled()
    const entry = h.library.catalogue(h.scope.id).files[0], before = h.library.catalogue(h.scope.id)
    const preview = await h.library.previewTable(entry.id, entry.revision, h.scope.id, { kind: 'sheet', sheet: 'Hidden' }, { includeHidden: true })
    expect(preview.rows[0].cells[0].value).toBe('HUMAN_ONLY_SECRET')
    expect(h.library.catalogue(h.scope.id).revision).toBe(before.revision)
    expect(h.library.catalogue(h.scope.id).files[0]).toMatchObject({ revision: entry.revision })
    expect(h.library.catalogue(h.scope.id).files[0].includeHidden).not.toBe(true)
    expect(await h.library.search('HUMAN_ONLY_SECRET', h.scope.id)).toEqual([])
  })
  it('rejects stale project leases and detects original-byte corruption before use', async () => {
    const h = await harness(); await h.library.add([h.path], h.scope.id); await h.settled()
    const snapshot = h.library.snapshot(), entry = snapshot.library.files[0]
    h.scope.id = 'new-lease'
    await expect(h.library.read(entry.id, entry.revision, 'lease-1')).rejects.toThrow('SCOPE_CHANGED')
    await writeFile(join(snapshot.blobDir, entry.sha256), 'CORRUPTED ORIGINAL')
    await expect(h.library.read(entry.id, entry.revision, h.scope.id)).rejects.toThrow('checksum failed')
  })
})
