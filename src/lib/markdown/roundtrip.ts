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

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent } from 'mdast'

const parser = unified().use(remarkParse).use(remarkGfm)
const stringifier = unified().use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  rule: '-',
}).use(remarkGfm)

export function parseMarkdown(text: string): Root {
  return parser.parse(text) as Root
}

export function serializeMarkdown(tree: Root): string {
  return stringifier.stringify(tree)
}

/** Parse then re-serialize — one normalisation pass. */
export function normalize(text: string): string {
  return serializeMarkdown(parseMarkdown(text))
}

/** Structural signature of a tree, ignoring source positions and cosmetics. */
function structure(node: RootContent | Root): unknown {
  const n = node as unknown as Record<string, unknown>
  const kind = n.type as string
  const kids = (n.children as RootContent[] | undefined)?.map(structure)
  switch (kind) {
    case 'text':
    case 'inlineCode':
      return [kind, n.value]
    case 'code':
      return [kind, n.lang ?? null, n.meta ?? null, n.value]
    case 'html':
      return [kind, n.value]
    case 'heading':
      return [kind, n.depth, kids]
    case 'list':
      return [kind, !!n.ordered, n.start ?? null, kids]
    case 'listItem':
      return [kind, n.checked ?? null, kids]
    case 'link':
    case 'image':
      return [kind, n.url, n.title ?? null, kids]
    case 'table':
      return [kind, n.align ?? null, kids]
    default:
      return kids ? [kind, kids] : [kind, n.value ?? null]
  }
}

export interface RoundTripReport {
  /** True when the round trip is structurally lossless. */
  equal: boolean
  /** True when the text changes at all (formatting normalisation counts). */
  reformats: boolean
  /** Constructs that ProseMirror has no faithful representation for. */
  unsupported: { kind: string; line: number | null; snippet: string }[]
}

const UNSUPPORTED_KINDS = new Set(['html'])

/**
 * Check whether `text` survives a Visual-mode round trip.
 *
 * `reformats` is informational — it tells the user their file may be tidied.
 * `equal === false` is the real warning: something structural would change.
 */
export function roundTripReport(text: string): RoundTripReport {
  const first = parseMarkdown(text)
  const once = serializeMarkdown(first)
  const second = parseMarkdown(once)
  const twice = serializeMarkdown(second)

  const unsupported: RoundTripReport['unsupported'] = []
  const walk = (node: RootContent | Root): void => {
    const n = node as unknown as Record<string, unknown>
    if (UNSUPPORTED_KINDS.has(n.type as string)) {
      const value = String(n.value ?? '')
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
