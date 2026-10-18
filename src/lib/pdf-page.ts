import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface RenderedProjectPdfPage {
  dataUrl: string
  width: number
  height: number
  pageCount: number
  complete: boolean
}

async function managedPdfData(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const limit = 100 * 1024 * 1024
  if (url.startsWith('data:application/pdf;base64,')) {
    if (url.length > 140 * 1024 * 1024) throw new Error('This PDF exceeds the preview limit. Export the original to view it')
    const binary = atob(url.slice(url.indexOf(',') + 1))
    if (binary.length > limit) throw new Error('This PDF exceeds the preview limit. Export the original to view it')
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }
  const source = new URL(url)
  if (source.protocol !== 'ourgeo-project-file:' || source.hostname !== 'project' || !source.searchParams.get('lease') || !source.searchParams.get('revision')) throw new Error('The PDF preview did not contain a managed document')
  const response = await fetch(source, { signal, redirect: 'error' })
  if (!response.ok || !response.body) throw new Error('This PDF is no longer available in the current project. Reopen its preview')
  if (Number(response.headers.get('Content-Length')) > limit) { await response.body.cancel(); throw new Error('This PDF exceeds the preview limit. Export the original to view it') }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('This PDF exceeds the preview limit. Export the original to view it') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  return data
}

/** Explicit visual access uses this same rendition as the human preview. It
 * never runs while merely listing files or building ordinary text context. */
export async function renderProjectPdfPage(url: string, page: number, signal?: AbortSignal): Promise<RenderedProjectPdfPage> {
  signal?.throwIfAborted()
  const data = await managedPdfData(url, signal)
  const pdfjs = await import('pdfjs-dist')
  signal?.throwIfAborted()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const loading = pdfjs.getDocument({ data, useWasm: false, useWorkerFetch: false, useSystemFonts: true, enableXfa: false, stopAtErrors: true, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024 })
  const cancel = (): void => { void loading.destroy().catch(() => { /* Cancellation can race worker shutdown. */ }) }
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 30_000)
  try {
    const source = await loading.promise
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(page) || page < 1 || page > source.numPages) throw new Error(`Choose a page between 1 and ${source.numPages}`)
    const pdfPage = await source.getPage(page)
    const original = pdfPage.getViewport({ scale: 1 })
    const scale = Math.min(1.5, 2000 / Math.max(original.width, original.height), Math.sqrt(4_000_000 / (original.width * original.height)))
    const viewport = pdfPage.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height))
    await pdfPage.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise
    signal?.throwIfAborted()
    let dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > 4 * 1024 * 1024) dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    if (dataUrl.length > 6 * 1024 * 1024) throw new Error('This page exceeds the visual preview budget. Read its extracted text or export the original')
    // PDF.js can omit oversized embedded images under maxImageSize; a rendered
    // page is useful evidence, but cannot certify complete visual coverage.
    return { dataUrl, width: canvas.width, height: canvas.height, pageCount: source.numPages, complete: false }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    await loading.destroy().catch(() => { /* A cancelled worker is already gone. */ })
  }
}
