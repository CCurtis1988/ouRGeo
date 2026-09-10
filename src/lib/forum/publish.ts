// The Publish pipeline: knit → prepare → upload figures → post.
//
// Orchestration only. Each step is a module that can be reasoned about on its
// own — publish-markdown.ts is a pure transform, transcode.ts is pure pixels,
// and every network call is an IPC into the main process, which owns the token.
//
// Ordering matters and is deliberate: figures are uploaded BEFORE the thread is
// created, so a document whose images are refused (quota, trust level) fails
// with nothing published. The reverse order would leave the user with a post on
// a public forum missing half its figures and no way to fix it from the app.

import { preparePost, rewriteImages, type PreparedPost } from './publish-markdown'
import { transcodeForUpload } from './transcode'

export interface PublishRequest {
  /** Path to the saved .Rmd. Knit renders the file on disk, never the buffer. */
  filePath: string
  category: string
  title: string
  /** Body as shown in the preview — the user may have edited it. */
  body: string
  images: { path: string; alt: string }[]
  /** Directory the knit rendered into; figure paths are relative to it. */
  outputDir: string
  onPhase: (
    p: { kind: 'uploading'; done: number; total: number } | { kind: 'posting' }
  ) => void
}

export interface KnitToMarkdownResult {
  prepared: PreparedPost
  outputDir: string
}

/**
 * Resolve a figure path from the knitted markdown.
 *
 * rmarkdown writes figure paths relative to the INPUT file, so rendering into a
 * scratch directory (which Publish does, to keep the user's project clean) makes
 * it emit absolute paths instead. Both forms turn up, so both are handled — an
 * absolute path is already the answer.
 */
function resolveFigure(outputDir: string, ref: string): string {
  const decoded = decodeURI(ref)
  if (decoded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded)) return decoded
  const sep = outputDir.includes('\\') ? '\\' : '/'
  const clean = decoded.replace(/^\.\//, '').split('/').join(sep)
  return `${outputDir}${sep}${clean}`
}

/**
 * Unwrap Electron's IPC error prefix.
 *
 * Every rejection from a main-process handler arrives as
 * `Error invoking remote method 'forum:x': Error: <the real message>`. The
 * messages underneath are written for people — the forum's own trigger
 * refusals, mostly — so showing the wrapper would bury the only useful part.
 */
export function forumErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Knit the document to markdown in a scratch directory.
 *
 * A scratch directory rather than beside the source, because publishing should
 * not leave a .md and a figure folder in the user's project — knitting for the
 * forum is not the same act as knitting for themselves.
 */
export async function knitToMarkdown(
  filePath: string,
  outputDir: string,
  onLog?: (text: string) => void,
): Promise<KnitToMarkdownResult> {
  const id = crypto.randomUUID()
  const off = onLog ? window.electronAPI.knit.onProgress(id, onLog) : null
  try {
    const res = await window.electronAPI.knit.render({ id, filePath, format: 'md', outputDir })
    if (!res.success || !res.outputPath) {
      const detail = res.error ?? 'The document did not knit.'
      throw new Error(res.hint ? `${detail}\n\n${res.hint}` : detail)
    }
    const raw = await window.electronAPI.file.read(res.outputPath)
    return { prepared: preparePost(raw), outputDir }
  } finally {
    off?.()
  }
}

/**
 * Upload the figures and create the thread.
 *
 * Returns the thread URL. `imageError` from the server is surfaced rather than
 * thrown: by that point the post exists, and pretending otherwise would leave
 * the user hunting for a discussion they were told had failed.
 */
export async function publish(req: PublishRequest): Promise<{ url: string; imageError: string | null }> {
  const urls = new Map<string, string>()
  const attachmentIds: string[] = []

  for (const [i, img] of req.images.entries()) {
    req.onPhase({ kind: 'uploading', done: i, total: req.images.length })
    const b64 = await window.electronAPI.file.readBinary(resolveFigure(req.outputDir, img.path))
    const shrunk = await transcodeForUpload(base64ToBytes(b64))
    const up = await window.electronAPI.forum.uploadImage({
      bytes: shrunk.bytes,
      mime: shrunk.mime,
      width: shrunk.width,
      height: shrunk.height,
      alt: img.alt,
    })
    urls.set(img.path, up.url)
    attachmentIds.push(up.id)
  }

  req.onPhase({ kind: 'posting' })
  const body = rewriteImages(req.body, urls)
  const res = await window.electronAPI.forum.createThread({
    category: req.category,
    title: req.title,
    body,
    attachmentIds,
  })
  return { url: res.url, imageError: res.imageError }
}
