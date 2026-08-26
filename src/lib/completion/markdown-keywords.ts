// Slash-menu candidates, built from the same MD_ACTIONS catalog the ribbon uses.
// One source of truth: adding an action to the catalog gives you both a ribbon
// button and a `/` entry.

import { actionsFor, nextChunkLabel, type MdActionDef, type MdActionGroup } from '@/lib/markdown/actions'
import { expandSnippet } from './snippet'
import type { CompletionCandidate } from './types'

/** The literal text an action inserts when picked from the slash menu, plus the
 *  caret offset within it. Mirrors the ribbon's Source backend for `block` and
 *  `linePrefix`; `wrap` actions insert their markers around an empty selection. */
function insertionFor(action: MdActionDef, docText: string): { text: string; caret: number } {
  const op = action.source
  switch (op.kind) {
    case 'block': {
      const body = action.chunksOnly
        ? op.body.replace(/\$1/g, nextChunkLabel(docText))
        : op.body
      return expandSnippet(body)
    }
    case 'linePrefix':
      return { text: op.prefix, caret: op.prefix.length }
    case 'insert':
      return expandSnippet(op.body)
    // Footnote is always host-handled (it needs the prompt dialog), so this is
    // only a placeholder for ranking — never actually inserted.
    case 'footnote':
      return { text: `[^${op.label}]`, caret: 0 }
    case 'wrap': {
      const tail = expandSnippet(op.after)
      const text = op.before + tail.text
      // Caret between the markers unless the closing marker has an explicit slot.
      return {
        text,
        caret: /\$\d/.test(op.after) ? op.before.length + tail.caret : op.before.length,
      }
    }
  }
}

/**
 * Actions the slash menu cannot complete by inserting text: they need the
 * editor host — a prompt dialog for the values, or the live map for the code.
 * The host recognises them by candidate id and routes them to the same backend
 * the ribbon button uses, so `/link` and the Link button behave identically.
 */
export function mdActionNeedsHost(action: MdActionDef): boolean {
  return !!action.prompt || !!action.dynamic
}

/**
 * Candidates for the `/` menu.
 *
 * `docText` is needed so a chunk action can pre-fill its label — a labelled
 * chunk keeps a stable identity for its output.
 */
/**
 * Tint per group, so the list reads as five bands at a glance.
 *
 * The shape carries the meaning — that is the icon's job — and the colour
 * carries the neighbourhood: headings, inline formatting, blocks, things you
 * insert, and the two that reach into the live ouRGeo session.
 */
const GROUP_TINT: Record<MdActionGroup, string> = {
  heading: '#4493f8', // geo-accent
  text: '#bc8cff',
  block: '#3fb950', // geo-success
  insert: '#39c5cf',
  ourgeo: '#f0883e',
}

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
      // The ribbon's own icon, so the row and the button look the same.
      icon: action.icon,
      iconTint: GROUP_TINT[action.group],
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
