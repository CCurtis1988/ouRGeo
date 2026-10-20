import type { ThemeBackgroundImage } from '@/lib/theme-backgrounds'

interface PosterJob {
  sourceUrl: string
  promise: Promise<string>
  cancelled: boolean
  poster?: string
  cancel: () => void
  run: () => Promise<void>
}
const posters = new Map<string, PosterJob>()
const waiting: PosterJob[] = []
const retiredPosters = new Set<string>()
let decoding = 0

function pump(): void {
  while (decoding < 2 && waiting.length) {
    const job = waiting.shift()!
    if (job.cancelled) continue
    decoding++
    void job.run().finally(() => { decoding--; pump() })
  }
}

export function needsThemeBackgroundPoster(image: ThemeBackgroundImage): boolean {
  return image.kind === 'gif' && image.posterUrl.startsWith('data:image/svg+xml,')
}

/** Decoding an animated bitmap selects its first frame without mounting an
 * animating <img>. Only two files may fetch/decode at once: twenty visible
 * 24-megapixel GIFs would otherwise allocate nearly two gigabytes of bitmaps
 * before their tiny thumbnails appeared, despite lazy rendering in the grid. */
export function resolveThemeBackgroundPoster(image: ThemeBackgroundImage, priority = false): Promise<string> {
  if (!needsThemeBackgroundPoster(image)) return Promise.resolve(image.posterUrl)
  return resolveDecodedImage(image, 'poster', priority)
}

/** Static folder photos need small thumbnails too. Browser CSS sizing and
 * loading="lazy" defer requests but still decode every original at full size. */
export function resolveThemeBackgroundThumbnail(image: ThemeBackgroundImage): Promise<string> {
  if (image.source !== 'folder') return needsThemeBackgroundPoster(image) ? resolveThemeBackgroundPoster(image) : Promise.resolve(image.thumbnailUrl)
  return resolveDecodedImage(image, 'thumbnail', false)
}

function resolveDecodedImage(image: ThemeBackgroundImage, mode: 'poster' | 'thumbnail', priority: boolean): Promise<string> {
  const key = `${mode}:${image.url}`
  const fallback = mode === 'thumbnail' ? image.thumbnailUrl : image.posterUrl
  const maximum = mode === 'thumbnail' ? 480 : 1600
  const existing = posters.get(key)
  if (existing) {
    const position = waiting.indexOf(existing)
    if (priority && position > 0) { waiting.splice(position, 1); waiting.unshift(existing) }
    return existing.promise
  }
  let resolve!: (poster: string) => void
  let settled = false
  let controller: AbortController | undefined
  const settle = (poster: string): void => {
    if (settled) return
    settled = true
    job.poster = poster
    // Identity matters if a cancelled old decode finishes after this same
    // source has already been requested again. Failures remain retryable.
    if (poster === fallback && posters.get(key) === job) posters.delete(key)
    resolve(poster)
  }
  const job: PosterJob = {
    sourceUrl: image.url,
    promise: new Promise<string>(done => { resolve = done }),
    cancelled: false,
    cancel: () => {
      job.cancelled = true
      controller?.abort()
      const position = waiting.indexOf(job)
      if (position >= 0) waiting.splice(position, 1)
      settle(fallback)
    },
    run: async () => {
      let bitmap: ImageBitmap | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        if (job.cancelled || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') { settle(fallback); return }
        controller = new AbortController()
        timeout = setTimeout(() => controller?.abort(), 15_000)
        const response = await fetch(image.url, { signal: controller.signal })
        if (job.cancelled || !response.ok) { settle(fallback); return }
        const blob = await response.blob()
        if (job.cancelled) return
        const width = image.width ?? 0, height = image.height ?? 0
        const validatedDimensions = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 16_384 && height <= 16_384 && width * height <= 24_000_000
        // JPEG headers describe the unrotated sensor image. Applying both
        // dimensions before Chromium honours EXIF can stretch phone photos;
        // let its decoder orient JPEGs first, then fit the actual bitmap below.
        // The shared two-job limit still bounds these temporary full decodes.
        const jpeg = /\.jpe?g$/i.test(image.label) || /^data:image\/jpeg[;,]/i.test(image.url)
        if (validatedDimensions && !jpeg) {
          const scale = Math.min(1, maximum / Math.max(width, height))
          bitmap = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'high' })
        } else bitmap = await createImageBitmap(blob)
        if (job.cancelled || !bitmap.width || !bitmap.height) { settle(fallback); return }
        const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height))
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
        const context = canvas.getContext('2d')
        if (!context) { settle(fallback); return }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const poster = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
        // A grant may have been revoked during either asynchronous decoder
        // step. Never recreate its cached URL after forgetting or rescanning.
        if (!job.cancelled) settle(URL.createObjectURL(poster))
      } catch {
        // A static palette scene is safer than starting an unreadable animation
        // against the user's reduced-motion setting. Rescanning can retry it.
        settle(fallback)
      } finally { if (timeout !== undefined) clearTimeout(timeout); bitmap?.close() }
    },
  }
  posters.set(key, job)
  if (priority) waiting.unshift(job)
  else waiting.push(job)
  pump()
  return job.promise
}

/** Revoked sources are cancelled immediately, while a decoded URL can stay
 * alive for the current editor crossfade. Retired URLs are revoked once no
 * displayed frame retains them; active gallery files are never evicted. */
export function pruneThemeBackgroundPosters(activeUrls: ReadonlySet<string>, retainedPosterUrls: ReadonlySet<string> = new Set()): void {
  for (const [key, job] of posters) {
    if (activeUrls.has(job.sourceUrl)) continue
    posters.delete(key)
    if (job.poster?.startsWith('blob:')) retiredPosters.add(job.poster)
    job.cancel()
  }
  for (const poster of retiredPosters) {
    if (retainedPosterUrls.has(poster)) continue
    URL.revokeObjectURL(poster)
    retiredPosters.delete(poster)
  }
}
