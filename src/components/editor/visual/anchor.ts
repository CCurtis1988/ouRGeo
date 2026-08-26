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

/** Where the selection head sits, as a document anchor. */
export function anchorFromView(view: EditorView): DocAnchor {
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

/** Nearest ancestor that actually scrolls — the pane Visual mode lives in. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/**
 * Put the selection at `anchor` and bring it into view.
 *
 * The scroll is done by hand rather than with ProseMirror's `scrollIntoView()`
 * transaction flag: this runs immediately after the editor is created, and at
 * that point the pane's scroll height is still settling, so the built-in scroll
 * lands on a box that has not finished growing and leaves the reader at the top.
 * Measuring coordinates and setting `scrollTop` ourselves is unambiguous, and
 * a third of the way down is where the eye expects to resume reading.
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
    const delta = caret.top - box.top - pane.clientHeight / 3
    pane.scrollTop = Math.max(0, pane.scrollTop + delta)
  } catch { /* position not rendered yet */ }
}
