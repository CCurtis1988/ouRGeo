// Where the reader is, expressed in terms both editors can honour.
//
// Source mode measures a document in characters of markdown; Visual mode
// measures it in ProseMirror positions over a tree that has no markers in it at
// all. There is no exact correspondence — `**bold**` is eight characters in one
// and four in the other — so a shared anchor cannot be an offset.
//
// What both sides DO agree on is the sequence of top-level blocks and the
// letters and digits inside them. Markdown syntax is punctuation, so counting
// alphanumerics skips precisely the characters that exist in one representation
// and not the other. That makes the anchor stable across the switch and, just as
// importantly, cheap: no source map, no parallel tree.
//
// The result is approximate inside a block and exact between blocks, which is
// the right trade for what it is used for — landing the reader on the paragraph
// they were looking at rather than at the top of the file.

import { parseMarkdown } from './remark'
import type { Root, RootContent } from 'mdast'

export interface DocAnchor {
  /** Index of the top-level block the caret was in. */
  block: number
  /** Alphanumeric characters into that block's content. */
  chars: number
}

export const DOC_START: DocAnchor = { block: 0, chars: 0 }

const ALNUM = /[\p{L}\p{N}]/u

/** Alphanumerics in `s` — the characters markdown syntax never adds or removes. */
export function countSignificant(s: string): number {
  let n = 0
  for (const ch of s) if (ALNUM.test(ch)) n++
  return n
}

/** Index into `s` just past its `n`th alphanumeric (or `s.length`). */
export function advanceSignificant(s: string, n: number): number {
  if (n <= 0) return 0
  let seen = 0
  for (let i = 0; i < s.length; i++) {
    if (ALNUM.test(s[i])) {
      seen++
      if (seen >= n) return i + 1
    }
  }
  return s.length
}

interface BlockSpan {
  /** Offset where the block's CONTENT starts — past a code fence's info line. */
  contentStart: number
  start: number
  end: number
}

/**
 * Top-level blocks of `body`, with the offset content actually begins at.
 *
 * A fenced chunk is the case worth being careful about: its mdast position spans
 * the fences, but Visual mode only ever shows the body, so counting from the
 * node's start would put every anchor inside a chunk off by the length of
 * ```` ```{r label, echo=FALSE} ````.
 */
function blockSpans(body: string): BlockSpan[] {
  const root = parseMarkdown(body) as Root
  const out: BlockSpan[] = []
  for (const child of root.children as RootContent[]) {
    const pos = child.position
    if (pos?.start?.offset == null || pos?.end?.offset == null) continue
    const start = pos.start.offset
    const end = pos.end.offset
    out.push({ start, end, contentStart: contentStartOf(body, child, start) })
  }
  return out
}

/**
 * Where a block's CONTENT begins — past whatever marks it as that kind of block.
 *
 * Visual mode shows none of those marks, so counting from the node's own start
 * would drift by the length of every `# `, `- ` or chunk header. Descending to
 * the first positioned leaf finds the answer for all of them at once; a fenced
 * chunk is the exception, because its value is not a child node.
 */
function contentStartOf(body: string, child: RootContent, start: number): number {
  if (child.type === 'code') {
    const nl = body.indexOf('\n', start)
    return nl === -1 ? start : nl + 1
  }
  let node: RootContent = child
  for (;;) {
    const kids: RootContent[] | undefined = (node as { children?: RootContent[] }).children
    const first: RootContent | undefined = kids?.[0]
    if (!first?.position?.start?.offset) break
    node = first
  }
  return node.position?.start?.offset ?? start
}

/** Anchor for a caret at `offset` in markdown `body`. */
export function anchorFromSource(body: string, offset: number): DocAnchor {
  const spans = blockSpans(body)
  if (spans.length === 0) return DOC_START

  // The block containing the caret; failing that, the last one that starts
  // before it (a caret in the blank line between two paragraphs belongs to the
  // one above, which is what the eye is looking at).
  let index = spans.findIndex((s) => offset >= s.start && offset <= s.end)
  if (index === -1) {
    index = 0
    for (let i = 0; i < spans.length; i++) if (spans[i].start <= offset) index = i
  }
  const span = spans[index]
  const from = Math.max(span.contentStart, Math.min(offset, span.end))
  return { block: index, chars: countSignificant(body.slice(span.contentStart, from)) }
}

/** Offset in markdown `body` for `anchor` — the inverse, as closely as it goes. */
export function sourceOffsetFromAnchor(body: string, anchor: DocAnchor): number {
  const spans = blockSpans(body)
  if (spans.length === 0) return 0
  const span = spans[Math.max(0, Math.min(anchor.block, spans.length - 1))]
  const text = body.slice(span.contentStart, span.end)
  return span.contentStart + advanceSignificant(text, anchor.chars)
}
