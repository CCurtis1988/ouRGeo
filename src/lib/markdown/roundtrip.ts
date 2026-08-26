// The Source ↔ Visual safety net.
//
// Visual mode is a PROJECTION of the markdown text, never a peer: the text
// always owns the truth. But a projection can still lose something on the way
// back — raw HTML, an unusual construct, anything the ProseMirror schema has no
// node for. Silently rewriting a user's document is the worst failure this
// feature could have, so the switch is gated on an explicit check.
//
// The right invariant is idempotence at the SECOND pass, not byte preservation:
// the first pass may normalise formatting (list markers, emphasis characters,
// trailing spaces), which is expected and harmless. What must never change is
// the document's STRUCTURE.

import type { Root, RootContent } from 'mdast'
import { parseMarkdown, serializeMarkdown, structure } from './remark'
import { minimizeEscapes } from './escapes'

export { parseMarkdown, serializeMarkdown }

/**
 * Parse then re-serialize — one normalisation pass, with the serializer's
 * unnecessary backslashes taken back out.
 *
 * `minimizeEscapes` belongs here rather than only at the Visual-mode boundary:
 * this is what the mode switch records as its baseline, and a baseline that
 * still carried the escapes would never match the text Visual mode hands back,
 * so a look-and-leave toggle would rewrite the file.
 */
export function normalize(text: string): string {
  return minimizeEscapes(serializeMarkdown(parseMarkdown(text)))
}

export interface RoundTripReport {
  /** True when the round trip is structurally lossless. */
  equal: boolean
  /** True when the text changes at all (formatting normalisation counts). */
  reformats: boolean
  /** Constructs that ProseMirror has no faithful representation for. */
  unsupported: { kind: string; line: number | null; snippet: string }[]
}

// Constructs Milkdown's commonmark+gfm schema has no node for. Raw HTML is the
// obvious one; footnotes are the quiet one — remark parses them happily, so a
// remark-only round trip looks lossless while ProseMirror would drop them.
const UNSUPPORTED_KINDS = new Set(['html', 'footnoteDefinition', 'footnoteReference'])

/**
 * Check whether `text` survives a Visual-mode round trip.
 *
 * `reformats` is informational — it tells the user their file may be tidied.
 * `equal === false` is the real warning: something structural would change.
 */
export function roundTripReport(text: string): RoundTripReport {
  // The passes run through `normalize`, not the bare serializer, because that
  // is what the mode switch actually writes back — including the escape
  // minimiser. Checking anything else would report on a document the user is
  // never shown.
  const first = parseMarkdown(text)
  const once = normalize(text)
  const second = parseMarkdown(once)
  const twice = normalize(once)

  const unsupported: RoundTripReport['unsupported'] = []
  const walk = (node: RootContent | Root): void => {
    const n = node as unknown as Record<string, unknown>
    if (UNSUPPORTED_KINDS.has(n.type as string)) {
      // Footnote nodes carry an identifier rather than a value.
      const value = String(n.value ?? n.identifier ?? '')
      unsupported.push({
        kind: n.type as string,
        line: (n.position as { start?: { line?: number } } | undefined)?.start?.line ?? null,
        snippet: value.slice(0, 80),
      })
    }
    for (const kid of (n.children as RootContent[] | undefined) ?? []) walk(kid)
  }
  walk(first)

  return {
    // Idempotence at the second pass + identical structure.
    equal: once === twice
      && JSON.stringify(structure(first)) === JSON.stringify(structure(second)),
    reformats: normalizeWhitespace(once) !== normalizeWhitespace(text),
    unsupported,
  }
}

/** Differences we never warn about: trailing whitespace and final-newline. */
function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+$/gm, '').replace(/\n+$/, '')
}

/** Should entering Visual mode prompt first? */
export function shouldWarn(report: RoundTripReport): boolean {
  return !report.equal || report.unsupported.length > 0
}
