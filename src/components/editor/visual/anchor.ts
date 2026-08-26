// The Visual-mode half of the position anchor.
//
// `src/lib/markdown/doc-position.ts` defines the anchor and reads it off
// markdown text; this reads and writes the same anchor against a ProseMirror
// doc. Both halves count the same thing — top-level block, then alphanumerics
// into it — so a place carried across the switch lands in the same sentence.
//
// TWO anchors travel, and they are deliberately independent:
//
//   * the VIEW anchor (`anchorFromView`) is what the reader is looking at, and
//     it drives scrolling.
//   * the CARET anchor (`caretAnchorFromView`) is where the cursor is, and it
//     is only ever written back when the reader actually moved it. A mode
//     toggle is not an edit, so scrolling must not drag the caret along.
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

/** Where the cursor is, as a document anchor. */
export function caretAnchorFromView(view: EditorView): DocAnchor {
  const { state } = view
  const $pos = state.doc.resolve(state.selection.head)
  if ($pos.depth === 0) return { block: $pos.index(0), chars: 0 }

  const block = $pos.index(0)
  // Content-relative offset: one past the position before the top-level node is
  // its first content position.
  const contentFrom = $pos.before(1) + 1
  const node = state.doc.child(block)
  const inside = Math.max(0, Math.min($pos.pos - contentFrom, node.content.size))
  return { block, chars: countSignificant(node.textBetween(0, inside, '\n', '\n')) }
}

/** Resolve an anchor to a document position. */
function posForAnchor(view: EditorView, anchor: DocAnchor): number | null {
  const { doc } = view.state
  if (doc.childCount === 0) return null

  const block = Math.max(0, Math.min(anchor.block, doc.childCount - 1))
  const node = doc.child(block)
  const contentFrom = doc.resolve(0).posAtIndex(block) + 1
  const text = node.textBetween(0, node.content.size, '\n', '\n')
  const inside = Math.min(advanceSignificant(text, anchor.chars), node.content.size)
  return Math.min(contentFrom + inside, doc.content.size)
}

/** Put the cursor at `anchor`, without scrolling to it. */
export function setCaretAtAnchor(view: EditorView, anchor: DocAnchor = DOC_START): void {
  const target = posForAnchor(view, anchor)
  if (target === null) return
  // A block with no text position of its own (an image, a horizontal rule)
  // cannot hold a text selection; `near` walks to the closest one that can.
  const selection = TextSelection.near(view.state.doc.resolve(target))
  view.dispatch(view.state.tr.setSelection(selection))
}

/**
 * Scroll `anchor` to the top of the pane, leaving the cursor alone.
 *
 * The scroll is done by hand rather than with ProseMirror's `scrollIntoView()`
 * transaction flag — which would also require a transaction, and therefore a
 * selection change. It runs immediately after the editor is created, when the
 * pane's scroll height is still settling, and the built-in scroll no-ops on a
 * box that has not finished growing.
 *
 * The anchor goes to the TOP of the viewport, not the middle, because it was
 * captured from the top of the other editor's viewport — putting it anywhere
 * else would shift the document by half a screen on every toggle.
 */
export function scrollAnchorToTop(view: EditorView, anchor: DocAnchor = DOC_START): void {
  const target = posForAnchor(view, anchor)
  const pane = scrollParent(view.dom as HTMLElement)
  if (target === null || !pane) return
  try {
    const box = pane.getBoundingClientRect()
    pane.scrollTop = Math.max(0, pane.scrollTop + (view.coordsAtPos(target).top - box.top))
  } catch { /* position not rendered yet */ }
}
