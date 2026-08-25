// Completion context for markdown documents.
//
// Deliberately NOT an extension of analyzeContext: that one is an R analyzer —
// it masks `#` comments and R string literals, which is nonsense over prose (a
// heading would be read as a comment). Instead this decides between two worlds:
//
//   * caret inside a runnable chunk → slice the chunk body and hand it to the R
//     analyzer, shifting the offsets back. That gives full R autocomplete
//     (objects, columns, formals, packages) inside chunks essentially for free.
//   * caret in prose after a `/` → the markdown slash menu.
//
// Anything else completes nothing, because guessing at prose is noise.

import { analyzeContext, type Context } from './context'

/** A `/` slash-command prefix in prose. */
export interface SlashContext {
  type: 'md-slash'
  prefix: string
  from: number
  to: number
}

export type MarkdownContext = Context | SlashContext

export interface ChunkRegion {
  /** Offset of the first character of the chunk body. */
  bodyStart: number
  bodyEnd: number
}

const FENCE_LINE = /^(\s*)(`{3,}|~{3,})(.*)$/

/**
 * Find the runnable chunk containing `offset`, if any.
 *
 * Scans fences line by line rather than parsing the document, because this runs
 * on every keystroke over a half-typed buffer where a real parse is both
 * wasteful and unreliable.
 */
export function chunkRegionAt(text: string, offset: number): ChunkRegion | null {
  let pos = 0
  let open: { fence: string; bodyStart: number } | null = null

  for (const line of text.split('\n')) {
    const lineStart = pos
    const lineEnd = pos + line.length
    pos = lineEnd + 1 // + newline

    const m = FENCE_LINE.exec(line)
    if (!m) continue
    const [, , fence, rest] = m

    if (!open) {
      // Opening fence. Only `{engine ...}` headers are runnable chunks; a plain
      // ```r fence is display-only, matching knitr.
      const header = /^\s*\{\s*([A-Za-z][\w.]*)[^}]*\}\s*$/.exec(rest)
      if (header) open = { fence, bodyStart: lineEnd + 1 }
      else open = { fence, bodyStart: -1 } // non-runnable fence: track to skip it
      continue
    }

    // Closing fence must be at least as long and carry no info string.
    if (fence.length >= open.fence.length && !rest.trim()) {
      if (open.bodyStart >= 0 && offset >= open.bodyStart && offset <= lineStart) {
        return { bodyStart: open.bodyStart, bodyEnd: lineStart }
      }
      open = null
    }
  }

  // Unterminated chunk at EOF — still completable while it is being typed.
  if (open && open.bodyStart >= 0 && offset >= open.bodyStart) {
    return { bodyStart: open.bodyStart, bodyEnd: text.length }
  }
  return null
}

/** True when `offset` sits inside any fenced block (runnable or not). */
function insideAnyFence(text: string, offset: number): boolean {
  let pos = 0
  let open: string | null = null
  for (const line of text.split('\n')) {
    const lineStart = pos
    pos += line.length + 1
    const m = FENCE_LINE.exec(line)
    if (!m) continue
    const fence = m[2]
    const rest = m[3]
    if (!open) { open = fence; continue }
    if (fence.length >= open.length && !rest.trim()) {
      if (offset > lineStart) { open = null; continue }
      return true
    }
  }
  return open !== null && offset > 0
}

/**
 * Analyze a markdown document at `offset`.
 *
 * `supportsChunks` is false for plain `.md`, where a fence is never runnable R.
 */
export function analyzeMarkdownContext(
  text: string,
  offset: number,
  knownFrame: (name: string) => boolean,
  supportsChunks = true,
): MarkdownContext {
  if (supportsChunks) {
    const region = chunkRegionAt(text, offset)
    if (region) {
      const body = text.slice(region.bodyStart, region.bodyEnd)
      const inner = analyzeContext(body, offset - region.bodyStart, knownFrame)
      if (inner.type === 'none') return inner
      // Shift the replace range back into document coordinates.
      return { ...inner, from: inner.from + region.bodyStart, to: inner.to + region.bodyStart }
    }
  }

  // Slash menu: a `/` that starts a word, in prose, outside any fence.
  if (insideAnyFence(text, offset)) return { type: 'none' }

  // Walk back over the typed prefix to the `/`.
  let i = offset
  while (i > 0 && /[A-Za-z0-9-]/.test(text[i - 1])) i--
  if (text[i - 1] !== '/') return { type: 'none' }
  const slash = i - 1
  // Must begin a word: start of line, or preceded by whitespace. `a/b` and a
  // URL path must never open the menu.
  const before = slash > 0 ? text[slash - 1] : '\n'
  if (!/\s/.test(before)) return { type: 'none' }

  return { type: 'md-slash', prefix: text.slice(i, offset), from: slash, to: offset }
}
