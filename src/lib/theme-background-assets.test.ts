import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { BUILTIN_THEME_LIST } from './themes'
import { themeBackgroundGallery } from './theme-backgrounds'

// Reading the packaged originals catches a missing artwork export even when a
// gallery still happens to have enough other entries to pass a count check.
const galleryPath = resolve('src/assets/themes/gallery')
const prompts = JSON.parse(readFileSync(resolve(galleryPath, 'prompts.json'), 'utf8')) as {
  images: Array<{ theme: string; index: number; label: string; file: string }>
}

function expectWebP(bytes: Buffer): void {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(bytes.toString('ascii', 8, 12)).toBe('WEBP')
  expect(bytes.length).toBeGreaterThan(1000)
}

function expectPhotoDimensions(bytes: Buffer, width: number, height: number): void {
  expectWebP(bytes)
  // These photographic exports are plain lossy VP8, without an animation
  // container. Check encoded dimensions rather than trusting prompt metadata.
  expect(bytes.toString('ascii', 12, 16)).toBe('VP8 ')
  expect(bytes.readUInt16LE(26) & 0x3fff).toBe(width)
  expect(bytes.readUInt16LE(28) & 0x3fff).toBe(height)
}

function gifFrames(bytes: Buffer): number {
  let offset = 13 + ((bytes[10] & 128) ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0)
  let count = 0
  const skipBlocks = (): void => {
    while (offset < bytes.length) {
      const size = bytes[offset++]
      if (!size) return
      offset += size
    }
  }
  while (offset < bytes.length) {
    const marker = bytes[offset++]
    if (marker === 0x3b) return count
    if (marker === 0x21) { offset++; skipBlocks(); continue }
    if (marker !== 0x2c || offset + 9 > bytes.length) throw new Error('Invalid packaged GIF image block')
    const packed = bytes[offset + 8]
    offset += 9 + ((packed & 128) ? 3 * 2 ** ((packed & 7) + 1) : 0)
    offset++ // LZW minimum code size; data subblocks have their own lengths.
    skipBlocks()
    count++
  }
  throw new Error('Packaged GIF is missing its trailer')
}

it('ships at least six stills per theme and keeps animations in the illustrated collection', () => {
  for (const theme of BUILTIN_THEME_LIST) {
    const gallery = themeBackgroundGallery(theme.id)
    const stills = gallery.filter(image => image.kind === 'image')
    const loops = gallery.filter(image => image.kind === 'gif')
    expect(new Set(stills.map(image => image.url)).size, theme.id).toBeGreaterThanOrEqual(6)
    expect(loops, theme.id).toHaveLength(theme.collection === 'field' ? 0 : 1)
    for (const loop of loops) {
      expect(loop.thumbnailUrl).not.toBe(loop.url)
      expect(loop.posterUrl).not.toBe(loop.url)
    }
  }
})

it('includes fifty distinct paintings with small static thumbnails', () => {
  expect(prompts.images).toHaveLength(50)
  const contents = new Set<string>()
  for (const image of prompts.images) {
    const bytes = readFileSync(resolve(galleryPath, image.file))
    expectWebP(bytes)
    const thumbnail = readFileSync(resolve(galleryPath, image.file.replace('.webp', '-thumb.webp')))
    expectWebP(thumbnail)
    expect(thumbnail.length).toBeLessThan(bytes.length)
    contents.add(createHash('sha256').update(bytes).digest('hex'))
    expect(themeBackgroundGallery(image.theme).find(item => item.id === `${image.theme}:${image.index}`)?.label).toBe(image.label)
  }
  expect(contents.size).toBe(50)
})

it('packages 78 distinct Field photographs, named scenes and bounded thumbnails without invented animations', () => {
  const field = JSON.parse(readFileSync(resolve(galleryPath, 'field-prompts.json'), 'utf8')) as {
    generator: string
    images: Array<{ theme: string; index: number; label: string; file: string; prompt: string }>
  }
  expect(field.generator).toBe('built-in image_gen')
  expect(field.images).toHaveLength(78)
  const hashes = new Set<string>()
  for (const theme of BUILTIN_THEME_LIST.filter(theme => theme.collection === 'field')) {
    const images = field.images.filter(image => image.theme === theme.id).sort((a, b) => a.index - b.index)
    expect(images.map(image => image.index), theme.id).toEqual([0, 1, 2, 3, 4, 5])
    const gallery = themeBackgroundGallery(theme.id)
    expect(gallery, theme.id).toHaveLength(6)
    for (const image of images) {
      const bytes = readFileSync(resolve(galleryPath, image.file))
      expectPhotoDimensions(bytes, 1600, 900)
      expect(bytes.length).toBeLessThan(2 * 1024 * 1024)
      const thumbnail = readFileSync(resolve(galleryPath, image.index === 0 ? `${theme.id}-default-thumb.webp` : `${theme.id}-${image.index}-thumb.webp`))
      expectPhotoDimensions(thumbnail, 320, 180)
      expect(thumbnail.length).toBeLessThan(bytes.length)
      expect(image.prompt.length).toBeGreaterThan(100)
      expect(gallery.find(item => item.id === (image.index === 0 ? 'default' : `${theme.id}:${image.index}`))?.label).toBe(image.label)
      hashes.add(createHash('sha256').update(bytes).digest('hex'))
    }
  }
  expect(hashes.size).toBe(78)
})

it('packages real eight-second infinite GIF loops with bounded files and still posters', () => {
  const themes = BUILTIN_THEME_LIST.filter(theme => !theme.legacy && theme.collection !== 'field')
  for (const theme of themes) {
    const bytes = readFileSync(resolve(galleryPath, `${theme.id}-loop.gif`))
    expect(bytes.toString('ascii', 0, 6)).toBe('GIF89a')
    expect(bytes.readUInt16LE(6)).toBe(960)
    expect(bytes.readUInt16LE(8)).toBe(540)
    expect(gifFrames(bytes), theme.id).toBe(80)
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
    const loop = bytes.indexOf(Buffer.from('NETSCAPE2.0'))
    expect(loop, theme.id).toBeGreaterThan(0)
    expect(bytes.readUInt16LE(loop + 13), theme.id).toBe(0)
    expectWebP(readFileSync(resolve(galleryPath, `${theme.id}-loop-poster.webp`)))
    expectWebP(readFileSync(resolve(galleryPath, `${theme.id}-loop-thumb.webp`)))
  }
})
