import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import AdmZip from 'adm-zip'
import { emptyLibrary, type PortableLibrary } from './catalogue'
import { fileSignature, readBundle, writeBundle } from './bundle'
import { fixtureBytes, fixtureEntry, fixtureHash } from './test-fixtures'

const directories: string[] = []
async function root(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'ourgeo-bundle-')); directories.push(path); return path }
async function archive(path: string, entries: Record<string, Buffer | string>): Promise<void> {
  const zip = new AdmZip(); for (const [name, bytes] of Object.entries(entries)) zip.addFile(name, Buffer.from(bytes)); await writeFile(path, zip.toBuffer())
}
const projectId = '990e617b-106c-41e6-9294-533e17f413c7'
const manifest = (version: number): string => JSON.stringify({ version, projectId, ui: { theme: 'dark' }, ...(version === 2 ? { projectFiles: { version: 1 } } : {}) })
const library: PortableLibrary = { version: 1, revision: 1, files: [fixtureEntry()] }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('project bundle durability and validation', () => {
  it.each(['1', '2', null, true])('refuses a coerced manifest version %j', async version => {
    const dir = await root(), path = join(dir, 'coerced.ourgeoproj')
    await archive(path, { 'project.json': JSON.stringify({ version, projectId, ui: {} }) })
    await expect(readBundle(path, join(dir, 'open'))).rejects.toThrow('manifest is unsupported')
  })
  it.each([undefined, null, 'project-one', '../project', '------------------------------------'])('refuses v2 files without a valid project identity %j', async identity => {
    const dir = await root(), path = join(dir, 'invalid-identity.ourgeoproj')
    await archive(path, { 'project.json': JSON.stringify({ version: 2, projectId: identity, ui: {}, projectFiles: { version: 1 } }), 'files/catalogue.json': JSON.stringify(emptyLibrary()) })
    const original = await readFile(path)
    await expect(readBundle(path, join(dir, 'open'))).rejects.toThrow('identity is missing or invalid')
    await expect(readFile(path)).resolves.toEqual(original)
  })
  it.each([null, 'required-future-feature', 1, { feature: 'new-format' }])('refuses malformed required-capability declarations %j', async requiredCapabilities => {
    const dir = await root(), path = join(dir, 'invalid-capabilities.ourgeoproj')
    await archive(path, { 'project.json': JSON.stringify({ version: 2, projectId, ui: {}, projectFiles: { version: 1, requiredCapabilities } }), 'files/catalogue.json': JSON.stringify(emptyLibrary()) })
    await expect(readBundle(path, join(dir, 'open'))).rejects.toThrow('unsupported capabilities')
  })
  it('opens and resaves legacy v1 without losing R snapshot or project memory', async () => {
    const dir = await root(), source = join(dir, 'old.ourgeoproj'), destination = join(dir, 'resaved.ourgeoproj')
    const memory = '{"scope":"project","text":"retained decision"}\n', env = Buffer.from('R_SNAPSHOT_SEED')
    await archive(source, { 'project.json': manifest(1), 'environment.RData': env, 'context/project-memory.jsonl': memory })
    const opened = await readBundle(source, join(dir, 'open'))
    expect(opened.library).toEqual(emptyLibrary()); expect(opened.memory).toBe(memory)
    await expect(readFile(opened.envPath!)).resolves.toEqual(env)
    const saved = await writeBundle({ destination, manifest: JSON.stringify(opened.manifest), memory: opened.memory, envPath: null, previousBundle: source, library: opened.library, blobDir: opened.blobDir, upgrade: false }, join(dir, 'write'))
    expect(saved.retainedEnvironment).toBe(true)
    const reloaded = await readBundle(destination, join(dir, 'reload'))
    expect(reloaded.manifest.version).toBe(1); expect(reloaded.memory).toBe(memory)
    await expect(readFile(reloaded.envPath!)).resolves.toEqual(env)
  })
  it('writes manifest v2 with verified native original bytes and portable metadata', async () => {
    const dir = await root(), blobs = join(dir, 'source-blobs'), destination = join(dir, 'project.ourgeoproj')
    await mkdir(blobs); await writeFile(join(blobs, fixtureHash), fixtureBytes)
    await writeBundle({ destination, manifest: manifest(1), envPath: null, library, blobDir: blobs, upgrade: true }, join(dir, 'save'))
    const opened = await readBundle(destination, join(dir, 'open'))
    expect(opened.manifest).toMatchObject({ version: 2, projectFiles: { version: 1 } })
    expect(opened.library.files[0].sha256).toBe(fixtureHash)
    await expect(readFile(join(opened.blobDir, fixtureHash))).resolves.toEqual(fixtureBytes)
  })
  it('retains unavailable R and memory snapshots together during an early project-files save', async () => {
    const dir = await root(), source = join(dir, 'last-good.ourgeoproj'), destination = join(dir, 'early-save.ourgeoproj'), blobs = join(dir, 'blobs')
    await mkdir(blobs); await writeFile(join(blobs, fixtureHash), fixtureBytes)
    const memory = '{"text":"Critical retained project decision"}\n', environment = Buffer.from('LAST_GOOD_R_ENVIRONMENT')
    await archive(source, { 'project.json': manifest(1), 'environment.RData': environment, 'context/project-memory.jsonl': memory })
    await writeBundle({ destination, manifest: manifest(1), envPath: null, memory: undefined, previousBundle: source, library, blobDir: blobs, upgrade: true }, join(dir, 'save'))
    const reopened = await readBundle(destination, join(dir, 'open'))
    await expect(readFile(reopened.envPath!)).resolves.toEqual(environment)
    expect(reopened.memory).toBe(memory)
    await expect(readFile(join(reopened.blobDir, fixtureHash))).resolves.toEqual(fixtureBytes)
    const unchanged = await readBundle(source, join(dir, 'source-open'))
    expect(unchanged.memory).toBe(memory)
  })
  it('refuses unknown required file capabilities while preserving the original archive', async () => {
    const dir = await root(), path = join(dir, 'future-capability.ourgeoproj')
    await archive(path, { 'project.json': JSON.stringify({ version: 2, projectId, ui: {}, projectFiles: { version: 1, requiredCapabilities: ['future-secret-format'] } }), 'files/catalogue.json': JSON.stringify(emptyLibrary()) })
    const original = await readFile(path)
    await expect(readBundle(path, join(dir, 'open'))).rejects.toThrow('unsupported capabilities')
    await expect(readFile(path)).resolves.toEqual(original)
  })
  it.each(['missing', 'corrupt', 'unreferenced', 'future', 'unknown'] as const)('refuses %s project contents without changing their source', async problem => {
    const dir = await root(), path = join(dir, 'bad.ourgeoproj')
    const entries: Record<string, Buffer | string> = { 'project.json': manifest(problem === 'future' ? 3 : 2), 'files/catalogue.json': JSON.stringify(problem === 'unreferenced' ? emptyLibrary() : library) }
    if (problem !== 'missing') entries[`files/blobs/${fixtureHash}`] = problem === 'corrupt' ? 'CORRUPTED' : fixtureBytes
    if (problem === 'unknown') entries['files/future-schema.bin'] = 'do not silently discard'
    await archive(path, entries)
    const before = await readFile(path)
    await expect(readBundle(path, join(dir, 'attempt'))).rejects.toThrow()
    await expect(readFile(path)).resolves.toEqual(before)
  })
  it('refuses a destination changed outside the app while retaining all source bytes', async () => {
    const dir = await root(), destination = join(dir, 'project.ourgeoproj'), blobs = join(dir, 'blobs')
    await mkdir(blobs); await writeFile(join(blobs, fixtureHash), fixtureBytes)
    await archive(destination, { 'project.json': manifest(1), 'environment.RData': 'OLD_R_ENV' })
    const expectedSignature = await fileSignature(destination)
    await archive(destination, { 'project.json': manifest(1), 'environment.RData': 'NEWER_EXTERNAL_R_ENV' })
    const external = await readFile(destination)
    await expect(writeBundle({ destination, manifest: manifest(1), envPath: null, library, blobDir: blobs, upgrade: true, expectedSignature }, join(dir, 'save'))).rejects.toThrow('changed outside')
    await expect(readFile(destination)).resolves.toEqual(external)
    await expect(readFile(join(blobs, fixtureHash))).resolves.toEqual(fixtureBytes)
  })
  it('retains the previous project if staged original verification fails', async () => {
    const dir = await root(), destination = join(dir, 'project.ourgeoproj'), blobs = join(dir, 'blobs')
    await mkdir(blobs); await writeFile(join(blobs, fixtureHash), 'WRONG ORIGINAL')
    await archive(destination, { 'project.json': manifest(1), 'environment.RData': 'GOOD_R_ENV' })
    const previous = await readFile(destination)
    await expect(writeBundle({ destination, manifest: manifest(1), envPath: null, library, blobDir: blobs, upgrade: true }, join(dir, 'save'))).rejects.toThrow('checksum')
    await expect(readFile(destination)).resolves.toEqual(previous)
  })
  it('does not publish a cancelled save', async () => {
    const dir = await root(), destination = join(dir, 'project.ourgeoproj'), controller = new AbortController()
    await archive(destination, { 'project.json': manifest(1) }); const previous = await readFile(destination)
    controller.abort()
    await expect(writeBundle({ destination, manifest: manifest(1), envPath: null, library: emptyLibrary(), blobDir: dir, upgrade: false }, join(dir, 'save'), controller.signal)).rejects.toThrow()
    await expect(readFile(destination)).resolves.toEqual(previous)
  })
  it('reports a committed save with a durability warning after directory fsync failure, without a post-publication read', async () => {
    const dir = await root(), destination = join(dir, 'published.ourgeoproj')
    const originalOpen = fsPromises.open, originalRename = fsPromises.rename, originalStream = fs.createReadStream
    let published = false, savedSignature = ''
    const openSpy = vi.spyOn(fsPromises, 'open').mockImplementation(async (...args: Parameters<typeof fsPromises.open>) => {
      const handle = await originalOpen(...args)
      if (String(args[0]) === dir && args[1] === 'r' && published) handle.sync = async () => { throw Object.assign(new Error('simulated directory sync failure'), { code: 'EIO' }) }
      return handle
    })
    const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => { await originalRename(...args); if (String(args[1]) === destination) published = true })
    const streamSpy = vi.spyOn(fs, 'createReadStream').mockImplementation((...args: Parameters<typeof fs.createReadStream>) => {
      if (published && String(args[0]) === destination) throw Object.assign(new Error('post-publication reads are unavailable'), { code: 'EACCES' })
      return originalStream(...args)
    })
    syncBuiltinESMExports()
    try {
      const saved = await writeBundle({ destination, manifest: manifest(1), envPath: null, library: emptyLibrary(), blobDir: dir, upgrade: false }, join(dir, 'save'))
      savedSignature = saved.signature
      expect(published).toBe(true)
      expect(saved.durabilityWarning).toContain('was saved and verified')
      expect(saved.durabilityWarning).toContain('EIO')
    } finally { openSpy.mockRestore(); renameSpy.mockRestore(); streamSpy.mockRestore(); syncBuiltinESMExports() }
    expect(savedSignature).toBe(await fileSignature(destination))
    expect((await readBundle(destination, join(dir, 'reopen'))).manifest.version).toBe(1)
  })
  it('returns the committed outcome when cancellation arrives during successful publication', async () => {
    const dir = await root(), destination = join(dir, 'committed.ourgeoproj'), controller = new AbortController()
    const originalRename = fsPromises.rename
    const spy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (...args: Parameters<typeof fsPromises.rename>) => { await originalRename(...args); if (String(args[1]) === destination) controller.abort() })
    syncBuiltinESMExports()
    try {
      const saved = await writeBundle({ destination, manifest: manifest(1), envPath: null, library: emptyLibrary(), blobDir: dir, upgrade: false }, join(dir, 'save'), controller.signal)
      expect(controller.signal.aborted).toBe(true)
      expect(saved.signature).toBe(await fileSignature(destination))
    } finally { spy.mockRestore(); syncBuiltinESMExports() }
    expect((await readBundle(destination, join(dir, 'reopen'))).manifest.version).toBe(1)
  })
})
