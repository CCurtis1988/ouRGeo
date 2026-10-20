import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ThemeBackgroundImage } from './theme-backgrounds'

const image: ThemeBackgroundImage = { id: 'folder:one:gif', label: 'Example.gif', url: 'ourgeo-theme://one/gif', posterUrl: 'data:image/svg+xml,fallback', thumbnailUrl: 'data:image/svg+xml,fallback', kind: 'gif', source: 'folder', folderId: 'one' }
beforeEach(() => vi.resetModules())
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('shares a bounded static first-frame decode and revokes its preview after the folder grant disappears', async () => {
  const close = vi.fn()
  const drawImage = vi.fn()
  const bitmap = { width: 3200, height: 1800, close }
  const decode = vi.fn(async () => bitmap)
  const fetchImage = vi.fn(async () => new Response(new Blob(['gif'])))
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('OffscreenCanvas', class {
    width: number
    height: number
    constructor(width: number, height: number) { this.width = width; this.height = height }
    getContext() { return { drawImage } }
    async convertToBlob() { return new Blob(['static webp']) }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:static-poster')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const { resolveThemeBackgroundPoster, pruneThemeBackgroundPosters } = await import('./theme-background-posters')
  expect(await Promise.all([resolveThemeBackgroundPoster(image), resolveThemeBackgroundPoster(image)])).toEqual(['blob:static-poster', 'blob:static-poster'])
  expect(fetchImage).toHaveBeenCalledTimes(1)
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 900)
  expect(close).toHaveBeenCalledTimes(1)
  pruneThemeBackgroundPosters(new Set())
  await Promise.resolve()
  expect(revoke).toHaveBeenCalledWith('blob:static-poster')
})

it('keeps bundled GIF posters offline and retries failed external decodes after recovery', async () => {
  const fetchImage = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(new Response(new Blob(['gif'])))
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })))
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() } }; async convertToBlob() { return new Blob(['poster']) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered')
  const { resolveThemeBackgroundPoster } = await import('./theme-background-posters')
  expect(await resolveThemeBackgroundPoster({ ...image, posterUrl: '/assets/loop-poster.webp' })).toBe('/assets/loop-poster.webp')
  expect(fetchImage).not.toHaveBeenCalled()
  expect(await resolveThemeBackgroundPoster(image)).toBe(image.posterUrl)
  expect(await resolveThemeBackgroundPoster(image)).toBe('blob:recovered')
  expect(fetchImage).toHaveBeenCalledTimes(2)
})

it('limits concurrent image work and cancels queued or active old revisions without reviving their cache', async () => {
  const releases = new Map<string, (response: Response) => void>()
  const signals = new Map<string, AbortSignal>()
  const fetchImage = vi.fn((url: string, options: { signal: AbortSignal }) => new Promise<Response>(resolve => { releases.set(url, resolve); signals.set(url, options.signal) }))
  const decode = vi.fn(async () => ({ width: 24, height: 24, close: vi.fn() }))
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() } }; async convertToBlob() { return new Blob(['poster']) } })
  let nextPoster = 0
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:poster-${nextPoster++}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const { resolveThemeBackgroundPoster, pruneThemeBackgroundPosters } = await import('./theme-background-posters')
  const images = [0, 1, 2, 3].map(index => ({ ...image, url: `asset:${index}` }))
  const pending = images.map(value => resolveThemeBackgroundPoster(value))
  expect(fetchImage).toHaveBeenCalledTimes(2)
  pruneThemeBackgroundPosters(new Set(['asset:0', 'asset:3']))
  expect(await pending[1]).toBe(image.posterUrl)
  expect(await pending[2]).toBe(image.posterUrl)
  expect(signals.get('asset:1')?.aborted).toBe(true)
  releases.get('asset:0')!(new Response(new Blob(['first'])))
  expect(await pending[0]).toBe('blob:poster-0')
  await vi.waitFor(() => expect(releases.has('asset:3')).toBe(true))
  expect(fetchImage.mock.calls.map(call => call[0])).toEqual(['asset:0', 'asset:1', 'asset:3'])
  // Simulate a decoder/network implementation finishing after its abort. The
  // old revision must not decode or create any URL after cancellation.
  releases.get('asset:1')!(new Response(new Blob(['late old revision'])))
  releases.get('asset:3')!(new Response(new Blob(['kept'])))
  await pending[3]
  expect(decode).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenCalledTimes(2)
  // Cancelling the old job cannot delete a newly requested same-source job.
  const retry = resolveThemeBackgroundPoster(images[1])
  await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(4))
  releases.get('asset:1')!(new Response(new Blob(['new revision'])))
  expect(await retry).toBe('blob:poster-2')
  expect(await resolveThemeBackgroundPoster(images[1])).toBe('blob:poster-2')
})

it('retains a revoked source’s poster until its visible editor crossfade finishes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['gif']))))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })))
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() } }; async convertToBlob() { return new Blob(['poster']) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:outgoing-frame')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const { resolveThemeBackgroundPoster, pruneThemeBackgroundPosters } = await import('./theme-background-posters')
  await resolveThemeBackgroundPoster(image)
  pruneThemeBackgroundPosters(new Set(), new Set(['blob:outgoing-frame']))
  expect(revoke).not.toHaveBeenCalled()
  pruneThemeBackgroundPosters(new Set())
  expect(revoke).toHaveBeenCalledWith('blob:outgoing-frame')
})

it('resizes large static folder images during decode while preserving their full original for the editor and preview', async () => {
  const blob = new Blob(['large photograph'])
  const photo: ThemeBackgroundImage = { ...image, kind: 'image', url: 'asset:large-photo', posterUrl: 'asset:large-photo', width: 6000, height: 4000 }
  const decode = vi.fn(async () => ({ width: 480, height: 320, close: vi.fn() }))
  const fetchImage = vi.fn(async () => new Response(blob))
  vi.stubGlobal('fetch', fetchImage)
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() } }; async convertToBlob() { return new Blob(['small thumbnail']) } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:small-photo')
  const { resolveThemeBackgroundThumbnail, resolveThemeBackgroundPoster } = await import('./theme-background-posters')
  expect(await resolveThemeBackgroundThumbnail(photo)).toBe('blob:small-photo')
  expect(decode).toHaveBeenCalledWith(expect.any(Blob), { resizeWidth: 480, resizeHeight: 320, resizeQuality: 'high' })
  expect(await resolveThemeBackgroundPoster(photo)).toBe('asset:large-photo')
  expect(photo.url).toBe('asset:large-photo')
  expect(fetchImage).toHaveBeenCalledTimes(1)
  await resolveThemeBackgroundThumbnail({ ...photo, url: 'asset:tall-photo', width: 1000, height: 16_000 })
  expect(decode).toHaveBeenLastCalledWith(expect.any(Blob), { resizeWidth: 30, resizeHeight: 480, resizeQuality: 'high' })
})

it('keeps thumbnail and reduced-motion poster sizes independent and prunes both with their source grant', async () => {
  const decode = vi.fn(async (_blob: Blob, options: ImageBitmapOptions) => ({ width: options.resizeWidth, height: options.resizeHeight, close: vi.fn() }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['gif']))))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: vi.fn() } }; async convertToBlob() { return new Blob(['preview']) } })
  let next = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:sized-${next++}`)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const { resolveThemeBackgroundThumbnail, resolveThemeBackgroundPoster, pruneThemeBackgroundPosters } = await import('./theme-background-posters')
  const animated = { ...image, width: 3200, height: 1800 }
  expect(await resolveThemeBackgroundThumbnail(animated)).toBe('blob:sized-0')
  expect(await resolveThemeBackgroundPoster(animated)).toBe('blob:sized-1')
  expect(decode.mock.calls.map(call => call[1])).toEqual([
    { resizeWidth: 480, resizeHeight: 270, resizeQuality: 'high' },
    { resizeWidth: 1600, resizeHeight: 900, resizeQuality: 'high' },
  ])
  pruneThemeBackgroundPosters(new Set())
  expect(revoke.mock.calls.map(call => call[0])).toEqual(['blob:sized-0', 'blob:sized-1'])
})

it('preserves a JPEG’s decoded EXIF orientation instead of stretching it to unrotated header dimensions', async () => {
  const bitmap = { width: 4000, height: 6000, close: vi.fn() }
  const decode = vi.fn(async () => bitmap)
  const drawImage = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['rotated JPEG']))))
  vi.stubGlobal('createImageBitmap', decode)
  vi.stubGlobal('OffscreenCanvas', class {
    width: number
    height: number
    constructor(width: number, height: number) { this.width = width; this.height = height }
    getContext() { return { drawImage } }
    async convertToBlob() { return new Blob(['portrait thumbnail']) }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:portrait-photo')
  const { resolveThemeBackgroundThumbnail } = await import('./theme-background-posters')
  const photo: ThemeBackgroundImage = { ...image, kind: 'image', label: 'Phone photo.JPG', url: 'asset:photo', posterUrl: 'asset:photo', width: 6000, height: 4000 }
  expect(await resolveThemeBackgroundThumbnail(photo)).toBe('blob:portrait-photo')
  expect(decode).toHaveBeenCalledWith(expect.any(Blob))
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 320, 480)
})
