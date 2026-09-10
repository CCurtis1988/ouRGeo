// Get a knitted figure under the forum's image limits before it is uploaded.
//
// The rules are enforced by Postgres and by the storage bucket, not by
// politeness: 400,000 bytes hard, 4096 px per side, and webp/png/jpeg only. A
// figure that misses any of them is refused after the upload has already cost
// the user their bandwidth, so it is resized and re-encoded here first.
//
// This mirrors the website's own assets/js/image-upload.js — the same canvas
// pipeline, so an image published from ouRGeo is indistinguishable from one
// dragged into the web composer. It lives in the renderer because that is where
// a canvas exists; the main process does the network half and never sees pixels.

// Two buckets share these limits, and that is not a coincidence: `plugin-media`
// was given the same 400 KB ceiling and the same three MIME types as
// `post-images` precisely so one transcoder could serve both. If they ever
// diverge, this takes a target rather than growing a branch.

export const IMAGE_RULES = {
  maxStoredBytes: 400_000,
  maxEdge: 1600,
  /** Quality ladder walked downwards until the result fits. */
  qualities: [0.9, 0.8, 0.7, 0.6, 0.5],
}

export interface TranscodedImage {
  bytes: Uint8Array
  mime: string
  width: number
  height: number
}

let webpOk: boolean | null = null

/**
 * Whether this Chromium encodes webp.
 *
 * Worth checking rather than assuming: `toBlob` with an unsupported type
 * quietly hands back a PNG, which for a map screenshot is several times larger
 * than the jpeg we would have chosen — and large enough to fail the byte limit
 * that this module exists to satisfy.
 */
async function canEncodeWebp(): Promise<boolean> {
  if (webpOk !== null) return webpOk
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.8))
  webpOk = !!blob && blob.type === 'image/webp'
  return webpOk
}

function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))),
      mime,
      quality
    )
  })
}

function drawScaled(bitmap: ImageBitmap, maxEdge: number): {
  canvas: HTMLCanvasElement; width: number; height: number
} {
  const w0 = bitmap.width
  const h0 = bitmap.height
  const scale = Math.min(1, maxEdge / Math.max(w0, h0))
  const width = Math.max(1, Math.round(w0 * scale))
  const height = Math.max(1, Math.round(h0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('This system cannot render images for upload.')
  // Plots are line art on white; without a painted background a transparent PNG
  // re-encoded to jpeg comes out with black behind the axes.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { canvas, width, height }
}

/**
 * Resize and re-encode raw image bytes to fit the forum's limits.
 *
 * Walks the quality ladder, then halves the dimensions once if even the lowest
 * quality is still too big — a 1600px map of dense vector data can be, and
 * failing at that point would block the whole publish for one figure.
 */
export async function transcodeForUpload(
  data: Uint8Array,
  sourceMime = 'image/png',
): Promise<TranscodedImage> {
  const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: sourceMime }))
  try {
    const mime = (await canEncodeWebp()) ? 'image/webp' : 'image/jpeg'
    let { canvas, width, height } = drawScaled(bitmap, IMAGE_RULES.maxEdge)

    for (const q of IMAGE_RULES.qualities) {
      const blob = await encode(canvas, mime, q)
      if (blob.size <= IMAGE_RULES.maxStoredBytes) {
        return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height }
      }
    }

    ;({ canvas, width, height } = drawScaled(bitmap, Math.round(IMAGE_RULES.maxEdge / 2)))
    const blob = await encode(canvas, mime, 0.7)
    if (blob.size > IMAGE_RULES.maxStoredBytes) {
      throw new Error(
        'A figure is too detailed to fit the forum\'s 400 KB limit even after resizing. ' +
        'Try a simpler plot, or a smaller fig.width.'
      )
    }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height }
  } finally {
    bitmap.close()
  }
}
