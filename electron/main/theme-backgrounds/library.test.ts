import { afterEach, describe, expect, it, vi } from 'vitest'
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ThemeBackgroundLibrary } from './library'
import { inspectRaster, matchingImageExtension } from './images'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLTsAAAAASUVORK5CYII=', 'base64')
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const directories: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ourgeo-theme-images-'))
  directories.push(dir)
  const images = join(dir, 'images'), config = join(dir, 'preferences', 'theme-background-folders.json')
  await mkdir(images)
  const changed = vi.fn(), library = new ThemeBackgroundLibrary(config, changed)
  return { dir, images, config, library, changed }
}
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

describe('theme background folder grants', () => {
  it('persists device-local roots and discovers raster images without copying their bytes', async () => {
    const h = await fixture()
    await writeFile(join(h.images, 'still.png'), PNG)
    await writeFile(join(h.images, 'loop.gif'), GIF)
    await writeFile(join(h.images, 'notes.md'), 'Keep this outside the image catalogue.')
    const folder = await h.library.link('forest', h.images)
    expect(folder).toMatchObject({ name: 'images', themeId: 'forest', status: 'ready' })
    expect(folder.images.map(image => [image.name, image.animated])).toEqual([['loop.gif', true], ['still.png', false]])
    expect(folder.images[0].url).toMatch(/^ourgeo-theme-image:\/\/image\/folder%3A/)
    expect(folder.images[0].id).toMatch(new RegExp(`^folder:${folder.id}:`))
    expect(folder.images[0].url).not.toContain(h.images)
    const saved = await readFile(h.config, 'utf8')
    expect(saved).not.toContain('base64')
    expect(JSON.parse(saved)[0]).not.toHaveProperty('images')
    expect(await readdir(join(h.dir, 'preferences'))).toEqual(['theme-background-folders.json'])
    const reopened = new ThemeBackgroundLibrary(h.config)
    expect((await reopened.list())[0].images).toEqual(folder.images)
    const image = await reopened.image(folder.images[1].id)
    try { expect(await image.file.readFile()).toEqual(PNG) } finally { await image.file.close() }
  })

  it('deduplicates each theme root while allowing the same folder in another theme', async () => {
    const h = await fixture()
    await writeFile(join(h.images, 'still.png'), PNG)
    const first = await h.library.link('forest', h.images)
    expect((await h.library.link('forest', h.images)).id).toBe(first.id)
    await h.library.link('arctic', h.images)
    expect(await h.library.list()).toHaveLength(2)
  })

  it('forgets only the grant and immediately revokes every original URL', async () => {
    const h = await fixture()
    await writeFile(join(h.images, 'still.png'), PNG)
    const folder = await h.library.link('forest', h.images)
    await h.library.forget(folder.id)
    await expect(h.library.image(folder.images[0].id)).rejects.toThrow('no longer available')
    expect(await h.library.list()).toEqual([])
    expect(await readFile(join(h.images, 'still.png'))).toEqual(PNG)
    expect(await new ThemeBackgroundLibrary(h.config).list()).toEqual([])
  })

  it('preserves stable image ids across rescans while requiring current file contents', async () => {
    const h = await fixture(), path = join(h.images, 'still.png')
    await writeFile(path, PNG)
    const first = await h.library.link('forest', h.images)
    await writeFile(path, Buffer.concat([PNG, Buffer.from('changed')]))
    await expect(h.library.image(first.images[0].id)).rejects.toThrow('changed')
    const current = await h.library.rescan(first.id)
    expect(current.images[0].id).toBe(first.images[0].id)
    expect(current.images[0].url).not.toBe(first.images[0].url)
    const image = await h.library.image(current.images[0].id)
    await image.file.close()
    expect(h.changed).toHaveBeenCalledTimes(2)
  })

  it('keeps unavailable roots visible and restores their ids when the user locates a moved folder', async () => {
    const h = await fixture(), moved = join(h.dir, 'moved')
    await writeFile(join(h.images, 'still.png'), PNG)
    const first = await h.library.link('forest', h.images)
    await rename(h.images, moved)
    const restarted = new ThemeBackgroundLibrary(h.config)
    expect((await restarted.list())[0]).toMatchObject({ id: first.id, status: 'missing', images: [] })
    const linked = await restarted.relink(first.id, moved)
    expect(linked.images[0].id).toBe(first.images[0].id)
    expect(linked).toMatchObject({ id: first.id, path: moved, status: 'ready' })
  })

  it('requires relinking before accepting a replacement directory at an old root path', async () => {
    const h = await fixture()
    await writeFile(join(h.images, 'still.png'), PNG)
    const folder = await h.library.link('forest', h.images)
    await rename(h.images, join(h.dir, 'old'))
    await mkdir(h.images)
    await writeFile(join(h.images, 'still.png'), PNG)
    expect(await h.library.rescan(folder.id)).toMatchObject({ status: 'missing', images: [] })
    await expect(h.library.image(folder.images[0].id)).rejects.toThrow('no longer available')
    expect(await h.library.relink(folder.id, h.images)).toMatchObject({ status: 'ready' })
  })

  it('does not follow symlinks or hard links, accept disguised markup, or read oversized rasters', async () => {
    const h = await fixture(), outside = join(h.dir, 'outside.png')
    await writeFile(outside, PNG)
    await symlink(outside, join(h.images, 'alias.png'))
    await link(outside, join(h.images, 'hard-alias.png'))
    await symlink(h.dir, join(h.images, 'linked-directory'))
    await writeFile(join(h.images, 'disguised.png'), '<svg onload="alert(1)"></svg>')
    await writeFile(join(h.images, 'wrong-extension.gif'), PNG)
    const huge = Buffer.from(PNG); huge.writeUInt32BE(100_000, 16)
    await writeFile(join(h.images, 'oversized.png'), huge)
    await writeFile(join(h.images, 'good.png'), PNG)
    const folder = await h.library.link('dark', h.images)
    expect(folder.images.map(image => image.name)).toEqual(['good.png'])
    expect(folder.warning).toContain('skipped')
    expect(await readFile(outside)).toEqual(PNG)
  })

  it('revokes a previously accepted child that is replaced with a symlink', async () => {
    const h = await fixture()
    const path = join(h.images, 'still.png'), outside = join(h.dir, 'outside.png')
    await writeFile(path, PNG); await writeFile(outside, PNG)
    const folder = await h.library.link('dark', h.images)
    await rename(path, join(h.images, 'original.png'))
    await symlink(outside, path)
    await expect(h.library.image(folder.images[0].id)).rejects.toThrow('Symbolic links')
    const current = await h.library.rescan(folder.id)
    expect(current.images.map(image => image.name)).toEqual(['original.png'])
  })

  it('caps an image-heavy folder and gives a useful reason for omitted images', async () => {
    const h = await fixture()
    await Promise.all(Array.from({ length: 205 }, (_, i) => writeFile(join(h.images, `image-${String(i).padStart(3, '0')}.png`), PNG)))
    const folder = await h.library.link('dark', h.images)
    expect(folder.images).toHaveLength(200)
    expect(folder.warning).toContain('200 images')
  })

  it('serialises mutations and preserves the previous grants when settings cannot be saved', async () => {
    const h = await fixture()
    await Promise.all(['dark', 'forest', 'arctic'].map(theme => h.library.link(theme, h.images)))
    expect(await new ThemeBackgroundLibrary(h.config).list()).toHaveLength(3)
    const first = (await h.library.list())[0]
    await rename(h.config, `${h.config}.backup`)
    await mkdir(h.config)
    await expect(h.library.forget(first.id)).rejects.toThrow()
    expect(await h.library.list()).toHaveLength(3)
    expect((await h.library.list())[0].id).toBe(first.id)
  })
})

describe('bounded raster metadata', () => {
  it('recognises PNG, GIF, JPEG and WebP dimensions and checks the extension against the bytes', () => {
    expect(inspectRaster(PNG)).toMatchObject({ width: 1, height: 1, mime: 'image/png', animated: false })
    expect(inspectRaster(GIF)).toMatchObject({ width: 1, height: 1, mime: 'image/gif', animated: true })
    const animationControl = Buffer.alloc(20); animationControl.writeUInt32BE(8, 0); animationControl.write('acTL', 4)
    expect(inspectRaster(Buffer.concat([PNG.subarray(0, 33), animationControl, PNG.subarray(33)]))).toMatchObject({ mime: 'image/png', animated: true })
    const largeProfile = Buffer.alloc(12); largeProfile.writeUInt32BE(1_000_000, 0); largeProfile.write('iCCP', 4)
    expect(inspectRaster(Buffer.concat([PNG.subarray(0, 33), largeProfile]))).toMatchObject({ animated: true })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 20, 0, 30])
    expect(inspectRaster(jpeg)).toMatchObject({ width: 30, height: 20, mime: 'image/jpeg' })
    const webp = Buffer.alloc(30)
    webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp[20] = 2; webp.writeUIntLE(99, 24, 3); webp.writeUIntLE(49, 27, 3)
    expect(inspectRaster(webp)).toMatchObject({ width: 100, height: 50, mime: 'image/webp', animated: true })
    expect(matchingImageExtension('photo.JPEG', 'image/jpeg')).toBe(true)
    expect(matchingImageExtension('renamed.jpg', 'image/png')).toBe(false)
    expect(inspectRaster(Buffer.from('<html>not an image</html>'))).toBeUndefined()
  })
})
