import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { NodeView } from '@milkdown/kit/prose/view'

/** Resolve a Markdown image against the saved document, without changing its Markdown. */
export function localImagePath(src: string, documentPath: string | null): string | null {
  if (!documentPath || !src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return null
  const normalized = src.replace(/\\/g, '/')
  const base = documentPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
  const parts = (absolute ? normalized : `${base}/${normalized}`).split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.') resolved.push(part)
  }
  return resolved.join('/')
}

export function imageMime(path: string): string | null {
  switch (path.split('.').pop()?.toLowerCase()) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    case 'avif': return 'image/avif'
    case 'bmp': return 'image/bmp'
    default: return null
  }
}

/** A display-only URL replacement. ProseMirror keeps the original src in its node. */
export function imagePreviewView(documentPath: string | null) {
  return (_ctx: Ctx) => (node: ProseNode): NodeView => {
    const img = document.createElement('img')
    let current = ''
    let disposed = false
    const update = (next: ProseNode): boolean => {
      if (next.type.name !== 'image') return false
      const src = String(next.attrs.src ?? '')
      img.alt = String(next.attrs.alt ?? '')
      img.title = String(next.attrs.title ?? '')
      if (src === current) return true
      current = src
      img.src = src
      const path = localImagePath(src, documentPath)
      const mime = path && imageMime(path)
      if (path && mime) {
        void window.electronAPI.file.readBinary(path).then((base64) => {
          if (!disposed && current === src) img.src = `data:${mime};base64,${base64}`
        }).catch(() => { /* Missing file remains visibly broken. */ })
      }
      return true
    }
    update(node)
    return { dom: img, update, ignoreMutation: () => true, destroy: () => { disposed = true } }
  }
}
