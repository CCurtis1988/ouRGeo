// The Visual-mode half of the position anchor.
//
// `src/lib/markdown/doc-position.ts` defines the anchor and reads it off
// markdown text; this reads and writes the same anchor against a ProseMirror
// doc. Both halves count the same thing — top-level block, then alphanumerics
// into it — so a caret carried across the switch lands in the same sentence.
//
// Kept here rather than in lib/ because it touches prosemirror types, and every
// ProseMirror import in the app stays inside this directory.

import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  countSignificant, advanceSignificant, DOC_START, type DocAnchor,
} from '@/lib/markdown/doc-position'

/**
 * What the reader is LOOKING AT, as a document anchor.
 *
 * Deliberately the viewport rather than the selection. The caret is wherever it
 * was last put — often the top of the document, or somewhere the reader scrolled
 * away from ten paragraphs ago — so restoring it lands them somewhere they are
 * not. The first block still on screen is what they were reading.
 *
 * When that block is partly scrolled past, the fraction hidden above the fold
 * maps onto its character count, so a long chunk resumes in the middle rather
 * than at its first line.
 */
export function anchorFromView(view: EditorView): DocAnchor {
  const doc = view.state.doc
  if (doc.childCount === 0) return DOC_START

  const pane = scrollParent(view.dom as HTMLElement)
  const paneTop = pane ? pane.getBoundingClientRect().top : 0

  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i)
    const dom = view.nodeDOM(pos) as HTMLElement | null
    pos += node.nodeSize
    const rect = dom?.getBoundingClientRect?.()
    if (!rect) continue
    if (rect.bottom <= paneTop) continue // entirely above the fold

    const hidden = rect.height > 0
      ? Math.min(Math.max((paneTop - rect.top) / rect.height, 0), 1)
      : 0
    const text = node.textBetween(0, node.content.size, '\n', '\n')
    return { block: i, chars: Math.round(countSignificant(text) * hidden) }
  }
  return { block: doc.childCount - 1, chars: 0 }
}

/** Nearest ancestor that actually scrolls — the pane Visual mode lives in. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/**
 * Put the selection at `anchor` and scroll it to the top of the pane.
 *
 * The scroll is done by hand rather than with ProseMirror's `scrollIntoView()`
 * transaction flag: this runs immediately after the editor is created, and at
 * that point the pane's scroll height is still settling, so the built-in scroll
 * lands on a box that has not finished growing and leaves the reader at the top.
 *
 * The anchor goes to the TOP of the viewport, not the middle, because it was
 * captured from the top of the other editor's viewport — putting it anywhere
 * else would shift the document by half a screen on every toggle.
 */
export function applyAnchorToView(view: EditorView, anchor: DocAnchor = DOC_START): void {
  const { state } = view
  const count = state.doc.childCount
  if (count === 0) return

  const block = Math.max(0, Math.min(anchor.block, count - 1))
  const node = state.doc.child(block)
  const contentFrom = state.doc.resolve(0).posAtIndex(block) + 1

  const text = node.textBetween(0, node.content.size, '\n', '\n')
  const inside = Math.min(advanceSignificant(text, anchor.chars), node.content.size)

  // A block with no text position of its own (an image, a horizontal rule)
  // cannot hold a text selection; `near` walks to the closest one that can.
  const target = Math.min(contentFrom + inside, state.doc.content.size)
  const selection = TextSelection.near(state.doc.resolve(target))
  view.dispatch(state.tr.setSelection(selection))

  const pane = scrollParent(view.dom as HTMLElement)
  if (!pane) return
  try {
    const caret = view.coordsAtPos(selection.head)
    const box = pane.getBoundingClientRect()
    pane.scrollTop = Math.max(0, pane.scrollTop + (caret.top - box.top))
  } catch { /* position not rendered yet */ }
}
