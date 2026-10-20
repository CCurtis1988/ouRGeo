import { app, BrowserWindow, dialog, nativeImage, protocol, safeStorage, type IpcMain } from 'electron'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { ProjectFileLibrary } from './library'
import { extractProjectFile } from './extract'
import { requireContextOwner } from '../context/ipc'
import { contextLease, subscribeContextScope } from '../context/scope'
import { protectedMemoryKey } from '../context/key'
import { ensureProjectFileAccess, type ProjectFileAccess } from './r-access'
import type { ProjectFileLocation, ProjectFilePreview, ProjectFilePutTarget } from '../../../src/lib/project-files'
import { PROJECT_FILE_LIMITS } from '../../../src/lib/project-files'

export const PROJECT_FILES_SCHEME = { scheme: 'ourgeo-project-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
let library: ProjectFileLibrary | undefined
export function projectFileLibrary(): ProjectFileLibrary {
  if (!library) {
    const changed = (): void => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('projectFiles:changed') }
    library = new ProjectFileLibrary(join(app.getPath('userData'), 'project-files'), contextLease, changed, extractProjectFile, async () => {
      if (!safeStorage.isEncryptionAvailable() || process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') throw new Error('Protected storage is unavailable. Enable the OS keyring, then reindex Project Files.')
      const directory = join(app.getPath('userData'), 'context'); await mkdir(directory, { recursive: true, mode: 0o700 })
      return protectedMemoryKey(directory, safeStorage)
    })
    subscribeContextScope(() => library?.scopeChanged())
  }
  return library
}

/** The door R uses into the library (see `r-access.ts`). Awaited before R is
 *  spawned, so the session's environment carries the address from the start. */
export function startProjectFileAccess(): Promise<ProjectFileAccess> {
  return ensureProjectFileAccess(() => {
    const service = projectFileLibrary()
    return { lease: contextLease, catalogue: lease => service.catalogue(lease), original: (id, revision, lease) => service.original(id, revision, lease), put: (path, target, lease) => service.put(path, target, lease), rescan: (ids, lease) => service.rescanFolders(ids, lease) }
  })
}

export function registerProjectFiles(ipc: IpcMain): void {
  const service = projectFileLibrary()
  const register = (name: string, callback: (...args: never[]) => unknown): void => {
    ipc.handle(`projectFiles:${name}`, (event, ...args) => { requireContextOwner(event); return callback(...args as never[]) })
  }
  register('catalogue', (lease: string) => service.catalogue(lease))
  register('add', async (lease: string, paths?: string[]) => {
    service.catalogue(lease)
    if (!contextLease().projectId) throw new Error('Save project to add files.')
    const selected = paths ?? (await dialog.showOpenDialog({ title: 'Add project files', properties: ['openFile', 'multiSelections'] })).filePaths
    if (!Array.isArray(selected) || selected.length > 2000 || selected.some(path => typeof path !== 'string' || path.length > 8192 || path.includes('\0'))) throw new Error('Choose up to 2,000 regular files.')
    return service.add(selected, lease)
  })
  const chooseFolder = async (lease: string, title: string, path?: string): Promise<string | undefined> => {
    service.catalogue(lease)
    if (!contextLease().projectId) throw new Error('Save project before linking a folder.')
    if (path !== undefined) {
      if (typeof path !== 'string' || !path.trim() || path.length > 8192 || path.includes('\0')) throw new Error('Choose an existing folder using its full path.')
      return path
    }
    const selection = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
    service.catalogue(lease)
    return selection.canceled ? undefined : selection.filePaths[0]
  }
  register('linkFolder', async (lease: string, path?: string, name?: string) => {
    const selected = await chooseFolder(lease, 'Link folder to project', path)
    return selected ? service.linkFolder(selected, name, lease) : service.catalogue(lease)
  })
  register('createFolder', async (lease: string, name: string, parentPath?: string, label?: string) => {
    const selected = await chooseFolder(lease, 'Choose where to create the linked folder', parentPath)
    return selected ? service.createFolder(selected, name, label, lease) : service.catalogue(lease)
  })
  register('relinkFolder', async (id: string, lease: string, path?: string) => {
    const folder = service.catalogue(lease).linkedFolders?.find(folder => folder.id === id)
    if (!folder) throw new Error('Choose a current linked folder before locating it on this device.')
    const selected = await chooseFolder(lease, `Locate ${folder.name}`, path)
    return selected ? service.relinkFolder(id, selected, lease) : service.catalogue(lease)
  })
  register('rescanFolders', service.rescanFolders.bind(service))
  register('forgetFolder', service.forgetFolder.bind(service))
  register('renameLinkedFolder', service.renameLinkedFolder.bind(service))
  register('update', service.update.bind(service))
  register('replace', async (id: string, revision: string, lease: string) => {
    const file = service.catalogue(lease).files.find(file => file.id === id && file.revision === revision)
    if (!file) throw new Error('Select a current file to replace.')
    const selected = await dialog.showOpenDialog({ title: `Replace ${file.name}`, properties: ['openFile'] })
    return selected.canceled ? service.catalogue(lease) : service.replace(id, revision, selected.filePaths[0], lease)
  })
  // Bytes the renderer drew itself (the map image export) — there is no R
  // object behind them, so they cannot go through ourgeo_project_path(). They
  // are staged privately and stored through the same `put` R uses.
  register('putBytes', async (lease: string, base64: string, target: ProjectFilePutTarget) => {
    service.catalogue(lease)
    if (!contextLease().projectId) throw new Error('Save the project to export into Project Files.')
    if (typeof base64 !== 'string' || base64.length > Math.ceil(PROJECT_FILE_LIMITS.fileBytes / 3) * 4) throw new Error('Exported images must be smaller than 100 MiB.')
    const directory = join(app.getPath('userData'), 'project-files-incoming'); await mkdir(directory, { recursive: true, mode: 0o700 })
    const staged = join(directory, `${randomUUID()}.tmp`)
    await writeFile(staged, Buffer.from(base64, 'base64'), { mode: 0o600, flag: 'wx' })
    try { return await service.put(staged, target, lease) } finally { await unlink(staged).catch(() => undefined) }
  })
  register('remove', service.remove.bind(service)); register('undo', service.undo.bind(service))
  register('reindex', service.reindex.bind(service)); register('cancel', service.cancel.bind(service))
  register('discard', service.discard.bind(service))
  register('recoverIntoCopy', service.recoverIntoCopy.bind(service))
  register('setIncludeHidden', service.setIncludeHidden.bind(service))
  register('setAnalysis', service.setAnalysis.bind(service))
  register('read', (id: string, revision: string, lease: string, location?: ProjectFileLocation, offset?: number) => service.read(id, revision, lease, location, offset))
  register('search', service.search.bind(service))
  register('preview', async (id: string, revision: string, lease: string, location?: ProjectFileLocation, options?: { includeHidden?: boolean }): Promise<ProjectFilePreview> => {
    const catalogue = service.catalogue(lease), file = catalogue.files.find(file => file.id === id && file.revision === revision)
    if (!file) throw new Error('This file changed. Select its current entry in Project Files.')
    const info = { id, revision, title: file.name, coverage: file.coverage, complete: true, mediaType: file.mediaType, text: '', ...(location ? { location } : {}) }
    if (file.storage?.kind === 'linked') {
      const folder = catalogue.linkedFolders?.find(folder => folder.id === file.storage?.folderId)
      if (!file.sha256 || folder?.status !== 'ready') return { ...info, kind: 'stored', complete: false, text: file.issue || folder?.issue || (!file.sha256 ? 'This file remains in its linked folder. Its size exceeds the document preview and indexing budget; use its original application to work with it.' : 'This linked folder is unavailable or needs a rescan. Relink or rescan it in Linked folders to preview current contents.') }
    }
    if (file.mediaType.startsWith('image/')) {
      const originalFile = await service.materialiseOriginal(id, revision, lease)
      try {
        const inspected = await extractProjectFile(originalFile.path, file.mediaType, undefined, file.originalName)
        if (!inspected.image || inspected.image.width * inspected.image.height > 16_000_000) return { ...info, kind: 'stored', text: 'This image exceeds the safe preview dimensions. Export the original or replace it with a smaller copy.' }
        let image = nativeImage.createFromBuffer(await readFile(originalFile.path))
        if (image.isEmpty()) return { ...info, kind: 'stored', text: 'This image could not be decoded. Export the original to inspect it.' }
        const original = image.getSize(), scale = Math.min(1, 2048 / Math.max(original.width, original.height))
        if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)), quality: 'best' })
        await service.original(id, revision, lease)
        return { ...info, kind: 'image', url: image.toDataURL(), width: image.getSize().width, height: image.getSize().height, imageComplete: scale === 1, text: `${original.width} × ${original.height}${scale < 1 ? ' · Preview reduced to 2,048 pixels; fine details may be unavailable.' : ''}` }
      } finally { await originalFile.release() }
    }
    if (file.mediaType === 'application/pdf') {
      await service.original(id, revision, lease)
      return { ...info, kind: 'pdf', url: `ourgeo-project-file://project/${id}?revision=${encodeURIComponent(revision)}&lease=${lease}` }
    }
    if (file.mediaType.includes('spreadsheetml') || ['text/csv', 'text/tab-separated-values'].includes(file.mediaType)) return { ...info, kind: 'table', table: await service.previewTable(id, revision, lease, location, options) }
    const result = await service.read(id, revision, lease, location, 0, true)
    return { ...result, mediaType: file.mediaType, kind: file.status === 'stored' || file.status === 'password' ? 'stored' : 'text' }
  })
  register('exportFile', async (id: string, revision: string, lease: string) => {
    const { path, file } = await service.original(id, revision, lease)
    const selected = await dialog.showSaveDialog({ title: 'Export original project file', defaultPath: file.originalName })
    if (selected.canceled || !selected.filePath) return false
    if (file.storage?.kind === 'linked') {
      const destination = await realpath(selected.filePath).catch(error => { if (error.code === 'ENOENT') return resolve(selected.filePath!); throw error })
      if (destination === await realpath(path)) throw new Error('This original is already in its linked folder. Choose a different destination to export a copy.')
    }
    service.catalogue(lease)
    const temporary = join(dirname(selected.filePath), `.ourgeo-export-${randomUUID()}.tmp`)
    const originalFile = await service.materialiseOriginal(id, revision, lease)
    try {
      await copyFile(originalFile.path, temporary); const output = await open(temporary, 'r+'); try { await output.sync() } finally { await output.close() }
      await service.original(id, revision, lease)
      await rename(temporary, selected.filePath); return true
    } finally { try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) } finally { await originalFile.release() } }
  })
  protocol.handle('ourgeo-project-file', async request => {
    try {
      const url = new URL(request.url), id = url.pathname.slice(1), lease = url.searchParams.get('lease') ?? '', revision = url.searchParams.get('revision') ?? ''
      if (url.hostname !== 'project') return new Response('Unavailable', { status: 404 })
      const original = await service.materialiseOriginal(id, revision, lease)
      try {
        const headers = new Headers({ 'Content-Type': original.file.mediaType, 'Content-Length': String(original.file.bytes), 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        const stream = createReadStream(original.path)
        stream.once('close', () => { void original.release().catch(error => console.warn('Project file preview cleanup:', error)) })
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers })
      } catch (error) { await original.release(); throw error }
    } catch { return new Response('This project file is no longer available. Refresh Project Files.', { status: 410 }) }
  })
}
