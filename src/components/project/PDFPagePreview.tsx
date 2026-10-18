import React, { useEffect, useState } from 'react'
import { renderProjectPdfPage } from '@/lib/pdf-page'

interface Props {
  url: string
  name: string
  page: number
  onPage: (page: number) => void
}

// Render a page ourselves rather than embedding Chromium's PDF viewer. A
// sandboxed iframe cannot run that plugin, and removing its sandbox would give
// an imported document more authority than a read-only reference needs.
export function PDFPagePreview({ url, name, page, onPage }: Props): React.ReactElement {
  const [image, setImage] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setStatus('loading'); setError(null); setCount(null); setImage(null)
    void (async () => {
      const rendered = await renderProjectPdfPage(url, page, controller.signal)
      if (!active) return
      setCount(rendered.pageCount); setImage(rendered.dataUrl); setStatus('ready')
    })().catch(reason => {
      if (!active) return
      setStatus('error')
      setError(`${reason instanceof Error ? reason.message : String(reason)}. Export the original to view this page in another application.`)
    })
    return () => { active = false; controller.abort() }
  }, [url, page])
  return <div className="space-y-2 mt-2">
    <div className="flex items-center gap-2 text-xs">
      <button type="button" className="rounded border border-geo-border px-2 py-1 focus-visible:outline focus-visible:outline-geo-accent disabled:opacity-50" disabled={page <= 1 || status === 'loading'} onClick={() => onPage(page - 1)}>Previous page</button>
      <span aria-live="polite">Page {page}{count !== null ? ` of ${count}` : ''}</span>
      <button type="button" className="rounded border border-geo-border px-2 py-1 focus-visible:outline focus-visible:outline-geo-accent disabled:opacity-50" disabled={count === null || page >= count || status === 'loading'} onClick={() => onPage(page + 1)}>Next page</button>
    </div>
    {status === 'loading' && <p role="status" className="text-xs">Rendering PDF page…</p>}
    {error && <p role="alert" className="text-xs">{error}</p>}
    {image && <img src={image} alt={`${name}, page ${page}`} className="max-w-full h-auto border border-geo-border" />}
    {status === 'ready' && <p className="text-xs">Page rendition uses bounded resolution. Form annotations and exceptionally large embedded images may be omitted.</p>}
  </div>
}
