import { constants } from 'node:fs'
import { lstat, mkdir, open, opendir, readFile, realpath, rename, stat, unlink, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import type { ThemeFolderImage, ThemeImageFolder } from '../../../src/lib/theme-backgrounds-types'
import { inspectRaster, matchingImageExtension, MAX_IMAGE_BYTES, type RasterInfo } from './images'

interface FolderGrant { id: string; themeId: string; name: string; path: string; dev: number; ino: number }
interface ImageGrant { id: string; folderId: string; relativePath: string; fingerprint: string; info: RasterInfo }
const fingerprint = (s: Stats): string => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
const MAX_FOLDERS = 32
const SCHEME = 'ourgeo-theme-image'

/** A separate capability catalogue keeps a background folder from becoming an
 * AI context grant. Only the picker can add roots; URLs contain opaque ids and
 * never paths. Every request rechecks both the root identity and the open file. */
export class ThemeBackgroundLibrary {
  private grants: FolderGrant[] = []
  private folders = new Map<string, ThemeImageFolder>()
  private images = new Map<string, ImageGrant>()
  private loaded?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private configPath: string, private changed: () => void = () => {}) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private initialise(): Promise<void> {
    if (!this.loaded) this.loaded = (async () => {
      let data: unknown
      try {
        const size = (await stat(this.configPath)).size
        if (size > 128_000) throw new Error('The linked image folder settings are too large. Restore theme-background-folders.json from a backup.')
        data = JSON.parse(await readFile(this.configPath, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw new Error(`Linked image folders could not be loaded. Restore theme-background-folders.json or rename it to start again. ${String(error)}`)
      }
      if (!Array.isArray(data) || data.length > MAX_FOLDERS || data.some(g => !g || typeof g !== 'object' || !/^[a-f0-9-]{36}$/.test(g.id) || typeof g.themeId !== 'string' || g.themeId.length > 160 || typeof g.name !== 'string' || typeof g.path !== 'string' || !isAbsolute(g.path) || !Number.isFinite(g.dev) || !Number.isFinite(g.ino))) throw new Error('Linked image folder settings are invalid. Restore theme-background-folders.json or rename it to start again.')
      this.grants = data
      for (const grant of this.grants) await this.scan(grant)
    })()
    return this.loaded
  }

  async list(): Promise<ThemeImageFolder[]> {
    await this.initialise()
    await this.queue
    return structuredClone([...this.folders.values()])
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true })
    const temporary = `${this.configPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(this.grants), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.configPath)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.warn('[Theme backgrounds] Could not remove temporary settings:', error) }) }
  }

  private async root(path: string): Promise<{ path: string; dev: number; ino: number }> {
    if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) throw new Error('Choose an existing image folder using its full path.')
    const canonical = await realpath(path)
    const info = await lstat(canonical)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose a regular image folder.')
    return { path: canonical, dev: info.dev, ino: info.ino }
  }

  async link(themeId: string, path: string): Promise<ThemeImageFolder> {
    await this.initialise()
    return this.serial(async () => {
      if (typeof themeId !== 'string' || !/^[\w-]{1,160}$/.test(themeId)) throw new Error('Choose a theme before linking an image folder.')
      const root = await this.root(path)
      const existing = this.grants.find(grant => grant.themeId === themeId && grant.path === root.path)
      if (existing) { const result = await this.scan(existing); this.changed(); return structuredClone(result) }
      if (this.grants.length >= MAX_FOLDERS) throw new Error('Up to 32 image folders can be linked. Forget an unused folder before adding another.')
      const grant: FolderGrant = { id: randomUUID(), themeId, name: basename(root.path) || root.path, ...root }
      this.grants.push(grant)
      try { await this.save() } catch (error) { this.grants.pop(); throw error }
      const result = await this.scan(grant)
      this.changed()
      return structuredClone(result)
    })
  }

  async rescan(id: string): Promise<ThemeImageFolder> {
    await this.initialise()
    return this.serial(async () => { const result = await this.scan(this.grant(id)); this.changed(); return structuredClone(result) })
  }

  async relink(id: string, path: string): Promise<ThemeImageFolder> {
    await this.initialise()
    return this.serial(async () => {
      const previous = this.grant(id), root = await this.root(path)
      if (this.grants.some(g => g.id !== id && g.themeId === previous.themeId && g.path === root.path)) throw new Error('That folder is already linked to this theme. Choose a different folder or forget the duplicate link.')
      const replacement = { ...previous, ...root, name: basename(root.path) || root.path }
      this.grants = this.grants.map(grant => grant.id === id ? replacement : grant)
      try { await this.save() } catch (error) { this.grants = this.grants.map(grant => grant.id === id ? previous : grant); throw error }
      const result = await this.scan(replacement)
      this.changed()
      return structuredClone(result)
    })
  }

  async forget(id: string): Promise<void> {
    await this.initialise()
    await this.serial(async () => {
      this.grant(id)
      const previous = this.grants
      this.grants = this.grants.filter(grant => grant.id !== id)
      try { await this.save() } catch (error) { this.grants = previous; throw error }
      this.folders.delete(id)
      for (const [imageId, image] of this.images) if (image.folderId === id) this.images.delete(imageId)
      this.changed()
    })
  }

  private grant(id: string): FolderGrant {
    const grant = this.grants.find(grant => grant.id === id)
    if (!grant) throw new Error('This image folder is no longer linked. Link it again in Backgrounds.')
    return grant
  }

  private async checkRoot(grant: FolderGrant): Promise<void> {
    const info = await lstat(grant.path)
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== grant.dev || info.ino !== grant.ino || await realpath(grant.path) !== grant.path) throw new Error('The folder has moved or changed. Locate it again to restore its image link.')
  }

  private async safeOpen(grant: FolderGrant, relativePath: string): Promise<FileHandle> {
    await this.checkRoot(grant)
    const path = resolve(grant.path, relativePath), within = relative(grant.path, path)
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Image is outside its linked folder.')
    let current = grant.path
    for (const part of within.split(sep)) {
      current = join(current, part)
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not followed in image folders.')
    }
    if (await realpath(path) !== path) throw new Error('Image is outside its linked folder.')
    const before = await lstat(path)
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > MAX_IMAGE_BYTES || fingerprint(before) !== fingerprint(info) || await realpath(path) !== path) throw new Error('Image changed or exceeds the safe image size. Rescan the linked folder.')
      await this.checkRoot(grant)
      const current = await lstat(path)
      if (current.isSymbolicLink() || fingerprint(current) !== fingerprint(info)) throw new Error('Image changed while it was being opened. Rescan its linked folder.')
      return file
    } catch (error) { await file.close(); throw error }
  }

  private async scan(grant: FolderGrant): Promise<ThemeImageFolder> {
    for (const [id, image] of this.images) if (image.folderId === grant.id) this.images.delete(id)
    const result: ThemeImageFolder = { id: grant.id, themeId: grant.themeId, name: grant.name, path: grant.path, status: 'ready', images: [] }
    try { await this.checkRoot(grant) } catch { result.status = 'missing'; result.warning = 'Folder unavailable. Locate it again or reconnect the drive, then rescan.'; this.folders.set(grant.id, result); return result }
    const pending = [{ path: grant.path, depth: 0 }]
    let examined = 0, directories = 0, omitted = 0, limited = false
    const started = Date.now()
    while (pending.length && !limited) {
      const next = pending.shift()!
      const entries = []
      try {
        if ((await lstat(next.path)).isSymbolicLink() || await realpath(next.path) !== next.path) { omitted++; continue }
        for await (const entry of await opendir(next.path)) {
          if (entries.length + examined >= 2000 || Date.now() - started > 15_000) { limited = true; break }
          entries.push(entry)
        }
      } catch { omitted++; continue }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
      for (const entry of entries) {
        if (++examined > 2000 || result.images.length >= 200 || Date.now() - started > 15_000) { limited = true; break }
        if (entry.name.startsWith('.')) continue
        const fullPath = join(next.path, entry.name)
        if (entry.isDirectory()) { if (next.depth < 6 && ++directories <= 100) pending.push({ path: fullPath, depth: next.depth + 1 }); else limited = true; continue }
        if (!/\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)) continue
        if (!entry.isFile() || entry.isSymbolicLink()) { omitted++; continue }
        let file: FileHandle | undefined
        try {
          const relativePath = relative(grant.path, fullPath)
          file = await this.safeOpen(grant, relativePath)
          const info = await file.stat(), header = Buffer.alloc(Math.min(info.size, 256 * 1024))
          await file.read(header, 0, header.length, 0)
          const raster = inspectRaster(header)
          if (!raster || !matchingImageExtension(entry.name, raster.mime)) { omitted++; continue }
          const id = `folder:${grant.id}:${createHash('sha256').update(relativePath.split(sep).join('/')).digest('hex').slice(0, 24)}`
          const revision = createHash('sha256').update(fingerprint(info)).digest('hex').slice(0, 16)
          const image: ThemeFolderImage = { id, folderId: grant.id, name: relativePath.split(sep).join('/'), url: `${SCHEME}://image/${encodeURIComponent(id)}?v=${revision}`, animated: raster.animated, width: raster.width, height: raster.height }
          this.images.set(id, { id, folderId: grant.id, relativePath, fingerprint: fingerprint(info), info: raster })
          result.images.push(image)
        } catch { omitted++ } finally { await file?.close() }
      }
    }
    const warnings: string[] = []
    if (limited) warnings.push('Showing up to 200 images within 6 subfolder levels (2,000 entries). Link a smaller folder to include other images.')
    if (omitted) warnings.push(`${omitted} unavailable or unsupported image${omitted === 1 ? '' : 's'} skipped. Use PNG, JPEG, WebP or GIF up to 8 MiB and 24 megapixels; symbolic links are not followed.`)
    if (warnings.length) result.warning = warnings.join(' ')
    this.folders.set(grant.id, result)
    return result
  }

  async image(id: string): Promise<{ file: FileHandle; info: RasterInfo; bytes: number }> {
    await this.initialise()
    const image = this.images.get(id)
    if (!image) throw new Error('This image is no longer available. Rescan or relink its folder.')
    const grant = this.grant(image.folderId), file = await this.safeOpen(grant, image.relativePath)
    try {
      const current = await file.stat()
      if (fingerprint(current) !== image.fingerprint || this.images.get(id) !== image || !this.grants.includes(grant)) throw new Error('This image changed. Rescan its linked folder.')
      return { file, info: image.info, bytes: current.size }
    } catch (error) { await file.close(); throw error }
  }
}
