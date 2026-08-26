// The one remark instance the markdown feature parses and serializes with.
//
// Split out of roundtrip.ts so the escape minimiser can compare parse trees
// without importing the module that depends on it. Everything markdown-shaped
// in the app — the round-trip guard, the escape minimiser, the position anchors
// — reads the document through this file, so they can never disagree about what
// the document IS.

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

/**
 * Structural signature of a tree, ignoring source positions and cosmetics.
 *
 * Two documents with the same signature mean the same thing — that is the whole
 * contract. The round-trip guard uses it to decide whether Visual mode would
 * change a document; the escape minimiser uses it to decide whether removing a
 * backslash would change one.
 */
export function structure(node: RootContent | Root): unknown {
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

/** Structural signature of markdown TEXT, as a comparable string. */
export function structuralSignature(text: string): string {
  return JSON.stringify(structure(parseMarkdown(text)))
}
