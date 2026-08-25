// Slash-menu candidates, built from the same MD_ACTIONS catalog the ribbon uses.
// One source of truth: adding an action to the catalog gives you both a ribbon
// button and a `/` entry.

import { actionsFor, nextChunkLabel, type MdActionDef } from '@/lib/markdown/actions'
import { expandSnippet } from './snippet'
import type { CompletionCandidate } from './types'

/** The literal text an action inserts when picked from the slash menu, plus the
 *  caret offset within it. Mirrors the ribbon's Source backend for `block` and
 *  `linePrefix`; `wrap` actions insert their markers around an empty selection. */
function insertionFor(action: MdActionDef, docText: string): { text: string; caret: number } {
  const op = action.source
  if (op.kind === 'block') {
    const body = action.chunksOnly
      ? op.body.replace(/\$1/g, nextChunkLabel(docText))
      : op.body
    return expandSnippet(body)
  }
  if (op.kind === 'linePrefix') {
    return { text: op.prefix, caret: op.prefix.length }
  }
  const tail = expandSnippet(op.after)
  const text = op.before + tail.text
  // Caret between the markers unless the closing marker has an explicit slot.
  return { text, caret: /\$\d/.test(op.after) ? op.before.length + tail.caret : op.before.length }
}

/**
 * Candidates for the `/` menu.
 *
 * `docText` is needed so a chunk action can pre-fill its label — a labelled
 * chunk keeps a stable identity for its output.
 */
export function mdSlashCandidates(docText: string, supportsChunks: boolean): CompletionCandidate[] {
  return actionsFor(supportsChunks).map((action, i) => {
    const { text, caret } = insertionFor(action, docText)
    return {
      id: `markdown:${action.id}`,
      label: action.label,
      insertText: text,
      kind: 'markdown' as const,
      detail: action.note ?? action.keywords[0],
      // Offset from the END of insertText, matching CompletionCandidate's contract.
      cursorOffset: caret - text.length,
      bias: i,
      // Keywords are matched by widening the label the fuzzy matcher sees; see
      // matchTargets below.
    }
  })
}

/** Extra match terms per candidate id, so `/todo` finds "Task list". */
export function mdMatchTerms(supportsChunks: boolean): Map<string, string[]> {
  return new Map(
    actionsFor(supportsChunks).map((a) => [`markdown:${a.id}`, [a.label, ...a.keywords]])
  )
}
