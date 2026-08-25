// Source-mode backend for the markdown actions: a pure text transform.
//
// Deliberately Monaco-free. `computeMdEdit` takes the buffer plus a selection
// and returns the replacement range, the text, and where the selection should
// end up — so every wrap/unwrap toggle, multi-line list prefix and renumbering
// rule is testable with no DOM at all. The Monaco adapter is a handful of lines
// in MarkdownRibbon, mirroring `applyAccept` in CodeEditor.

import { expandSnippet } from '@/lib/completion/snippet'
import type { MdActionDef, MdSourceOp } from './actions'

export interface MdEdit {
  /** Replace [from, to) in the source text… */
  from: number
  to: number
  /** …with this. */
  insertText: string
  /** Absolute offsets for the resulting selection (equal = a caret). */
  selStart: number
  selEnd: number
}

/** Start offset of the line containing `offset`. */
function lineStart(text: string, offset: number): number {
  const nl = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return nl < 0 ? 0 : nl + 1
}

/** End offset (exclusive of the newline) of the line containing `offset`. */
function lineEnd(text: string, offset: number): number {
  const nl = text.indexOf('\n', offset)
  return nl < 0 ? text.length : nl
}

// ── wrap ────────────────────────────────────────────────────────────────────
function applyWrap(
  text: string, selStart: number, selEnd: number, op: Extract<MdSourceOp, { kind: 'wrap' }>,
): MdEdit {
  const selected = text.slice(selStart, selEnd)
  const { before, after } = op
  // `after` may carry snippet markers (e.g. a link's `]($1)`), which must not
  // participate in the unwrap comparison.
  const afterLiteral = expandSnippet(after).text

  // Already wrapped inside the selection → unwrap.
  if (
    before.length > 0 &&
    selected.startsWith(before) && selected.endsWith(afterLiteral) &&
    selected.length >= before.length + afterLiteral.length
  ) {
    const inner = selected.slice(before.length, selected.length - afterLiteral.length)
    return { from: selStart, to: selEnd, insertText: inner, selStart, selEnd: selStart + inner.length }
  }

  // Markers sit just outside the selection → unwrap those too, so clicking Bold
  // twice on a word you selected without its asterisks still toggles off.
  const outerStart = selStart - before.length
  const outerEnd = selEnd + afterLiteral.length
  if (
    before.length > 0 && outerStart >= 0 && outerEnd <= text.length &&
    text.slice(outerStart, selStart) === before &&
    text.slice(selEnd, outerEnd) === afterLiteral
  ) {
    return {
      from: outerStart, to: outerEnd, insertText: selected,
      selStart: outerStart, selEnd: outerStart + selected.length,
    }
  }

  // Otherwise wrap. With a selection, keep it selected between the markers.
  // With none, the caret lands between the markers — unless the closing marker
  // carries an explicit `$N` slot (a link's `]($1)`), in which case it goes
  // there, since the URL is what you actually want to type next.
  const tail = expandSnippet(after)
  const insertText = before + selected + tail.text
  const hasSlot = /\$\d/.test(after)
  const caret = hasSlot
    ? before.length + selected.length + tail.caret
    : before.length
  return {
    from: selStart, to: selEnd, insertText,
    selStart: selected ? selStart + before.length : selStart + caret,
    selEnd: selected ? selStart + before.length + selected.length : selStart + caret,
  }
}

// ── line prefix ─────────────────────────────────────────────────────────────
/** Any list marker, with an optional task checkbox. Shared by ul/ol/task so
 *  converting between list kinds replaces the marker instead of stacking. */
const LIST_MARKER = /^(\s*)(?:\d+\.|[-*+])[ \t]+(?:\[[ xX]\][ \t]+)?/

/**
 * Two patterns per prefix, and the distinction matters:
 *  - `exact` decides whether the action toggles OFF. It must match only the
 *    marker this action produces, or H3 on an H1 line would clear the heading
 *    instead of changing its level.
 *  - `strip` decides what gets removed before re-prefixing. It matches the whole
 *    family, so a bullet becomes a task item rather than `- [ ] - item`.
 */
function patterns(prefix: string): { exact: RegExp; strip: RegExp } {
  const p = prefix.trim()
  if (/^#+$/.test(p)) {
    return { exact: new RegExp(`^\\s*#{${p.length}}[ \\t]+`), strip: /^(\s*)#{1,6}[ \t]+/ }
  }
  if (p === '- [ ]') return { exact: /^\s*[-*+][ \t]+\[[ xX]\][ \t]+/, strip: LIST_MARKER }
  // A plain bullet, but not one that is really a task item.
  if (p === '-') return { exact: /^\s*[-*+][ \t]+(?!\[[ xX]\][ \t])/, strip: LIST_MARKER }
  if (/^\d+\.$/.test(p)) return { exact: /^\s*\d+\.[ \t]+/, strip: LIST_MARKER }
  if (p === '>') return { exact: /^\s*>[ \t]?/, strip: /^(\s*)>[ \t]?/ }
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^\\s*' + esc + '[ \\t]*')
  return { exact: re, strip: re }
}

function applyLinePrefix(
  text: string, selStart: number, selEnd: number,
  op: Extract<MdSourceOp, { kind: 'linePrefix' }>,
): MdEdit {
  const from = lineStart(text, selStart)
  const to = lineEnd(text, selEnd)
  const lines = text.slice(from, to).split('\n')
  const { exact, strip } = patterns(op.prefix)

  // Toggle off only when every non-blank line already carries *this* marker —
  // a partially-formatted selection gets completed, not cleared, because
  // un-formatting would discard the user's existing markup.
  const meaningful = lines.filter((l) => l.trim().length > 0)
  const allPrefixed = meaningful.length > 0 && meaningful.every((l) => exact.test(l))
  // An empty document (or an empty line on its own) still gets the marker —
  // a heading button that does nothing on a blank line is just broken.
  const allBlank = meaningful.length === 0

  let n = 0
  const out = lines.map((line) => {
    if (allPrefixed) return line.replace(strip, '$1')
    if (!line.trim() && !allBlank) return line
    n += 1
    const indent = /^\s*/.exec(line)?.[0] ?? ''
    const bare = line.replace(strip, '')
    const marker = op.ordered ? `${n}. ` : op.prefix
    return indent + marker + bare
  })

  const insertText = out.join('\n')
  return { from, to, insertText, selStart: from, selEnd: from + insertText.length }
}

// ── block ───────────────────────────────────────────────────────────────────
function applyBlock(
  text: string, selStart: number, selEnd: number,
  op: Extract<MdSourceOp, { kind: 'block' }>,
): MdEdit {
  // A block replaces the selection if there is one; otherwise it is inserted at
  // the caret's line, which keeps it off the end of existing prose.
  const hasSelection = selStart !== selEnd
  const from = hasSelection ? selStart : lineStart(text, selStart)
  const to = hasSelection ? selEnd : lineEnd(text, selStart)

  const currentLine = text.slice(from, to)
  const { text: body, caret } = expandSnippet(op.body)

  // Ensure the block is separated from surrounding prose by a blank line, but
  // don't pile up blank lines at the start or end of the document.
  const beforeText = text.slice(0, from)
  const afterText = text.slice(to)
  const needsLeadingGap = beforeText.length > 0 && !/\n\s*\n$/.test(beforeText)
  const needsTrailingGap = afterText.length > 0 && !/^\n\s*\n/.test(afterText)

  const lead = needsLeadingGap ? (beforeText.endsWith('\n') ? '\n' : '\n\n') : ''
  const trail = needsTrailingGap ? (afterText.startsWith('\n') ? '\n' : '\n\n') : ''
  // A non-blank current line is kept — the block goes after it.
  const keep = currentLine.trim() && !hasSelection ? currentLine : ''
  const prefix = keep ? keep + (keep.endsWith('\n') ? '' : '\n\n') : lead

  const insertText = prefix + body + trail
  const caretAt = from + prefix.length + caret
  return { from, to, insertText, selStart: caretAt, selEnd: caretAt }
}

/**
 * Compute the edit an action makes. `text` is the whole buffer; `selStart`/
 * `selEnd` are absolute offsets (equal for a bare caret).
 */
export function computeMdEdit(
  text: string, selStart: number, selEnd: number, action: MdActionDef,
): MdEdit {
  const [a, b] = selStart <= selEnd ? [selStart, selEnd] : [selEnd, selStart]
  switch (action.source.kind) {
    case 'wrap': return applyWrap(text, a, b, action.source)
    case 'linePrefix': return applyLinePrefix(text, a, b, action.source)
    case 'block': return applyBlock(text, a, b, action.source)
  }
}

/** Convenience for tests and previews: the buffer after applying an edit. */
export function applyEdit(text: string, edit: MdEdit): string {
  return text.slice(0, edit.from) + edit.insertText + text.slice(edit.to)
}
