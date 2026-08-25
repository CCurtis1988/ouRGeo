// The markdown insert catalog: one declarative list feeding three consumers —
// the bottom ribbon, the `/` slash menu, and (later) Visual mode's ProseMirror
// commands. Modelled on GeometryEditRibbon's TOOL_DEFS.
//
// Keeping this data-only is what lets the *behaviour* live in apply-source.ts as
// a pure function with no Monaco dependency, so every wrap/toggle/list rule is
// unit-testable without a DOM.

import type React from 'react'
import {
  Heading1, Heading2, Heading3, Bold, Italic, Strikethrough, Code, SquareCode,
  List, ListOrdered, ListChecks, Link2, Image, Table, Quote, Minus, Superscript,
  Play, ChartLine, Map,
} from 'lucide-react'

export type MdActionId =
  | 'h1' | 'h2' | 'h3'
  | 'bold' | 'italic' | 'strike' | 'code'
  | 'codeblock' | 'ul' | 'ol' | 'task' | 'quote' | 'hr'
  | 'link' | 'image' | 'table' | 'footnote'
  | 'rchunk' | 'chunk-plot' | 'chunk-map'

export type MdActionGroup = 'heading' | 'text' | 'block' | 'insert' | 'ourgeo'

/** How the Source-mode backend edits the buffer. */
export type MdSourceOp =
  /** Surround the selection (or the caret) with markers; toggles off if present. */
  | { kind: 'wrap'; before: string; after: string }
  /** Prefix every selected line; toggles off if every line already has it. */
  | { kind: 'linePrefix'; prefix: string; ordered?: boolean }
  /** Insert a block on its own lines, with `$N` caret markers. */
  | { kind: 'block'; body: string }

export interface MdActionDef {
  id: MdActionId
  label: string
  group: MdActionGroup
  icon: React.ComponentType<{ className?: string }>
  /** Extra terms the slash menu matches on, beyond the label. */
  keywords: string[]
  source: MdSourceOp
  /** Only offered in documents that can hold executable chunks (.Rmd). */
  chunksOnly?: boolean
  /** Shown in the slash menu as a caveat. */
  note?: string
}

export const MD_ACTIONS: MdActionDef[] = [
  // ── Headings ────────────────────────────────────────────────────────────
  { id: 'h1', label: 'Heading 1', group: 'heading', icon: Heading1,
    keywords: ['h1', 'title', '#'], source: { kind: 'linePrefix', prefix: '# ' } },
  { id: 'h2', label: 'Heading 2', group: 'heading', icon: Heading2,
    keywords: ['h2', 'subtitle', '##'], source: { kind: 'linePrefix', prefix: '## ' } },
  { id: 'h3', label: 'Heading 3', group: 'heading', icon: Heading3,
    keywords: ['h3', '###'], source: { kind: 'linePrefix', prefix: '### ' } },

  // ── Inline ──────────────────────────────────────────────────────────────
  { id: 'bold', label: 'Bold', group: 'text', icon: Bold,
    keywords: ['strong', 'b'], source: { kind: 'wrap', before: '**', after: '**' } },
  { id: 'italic', label: 'Italic', group: 'text', icon: Italic,
    keywords: ['emphasis', 'em', 'i'], source: { kind: 'wrap', before: '*', after: '*' } },
  { id: 'strike', label: 'Strikethrough', group: 'text', icon: Strikethrough,
    keywords: ['strike', 'del'], source: { kind: 'wrap', before: '~~', after: '~~' } },
  { id: 'code', label: 'Inline code', group: 'text', icon: Code,
    keywords: ['code', 'mono', 'tick'], source: { kind: 'wrap', before: '`', after: '`' } },

  // ── Blocks ──────────────────────────────────────────────────────────────
  { id: 'ul', label: 'Bullet list', group: 'block', icon: List,
    keywords: ['bullet', 'unordered', 'ul'], source: { kind: 'linePrefix', prefix: '- ' } },
  { id: 'ol', label: 'Numbered list', group: 'block', icon: ListOrdered,
    keywords: ['ordered', 'numbered', 'ol'],
    source: { kind: 'linePrefix', prefix: '1. ', ordered: true } },
  { id: 'task', label: 'Task list', group: 'block', icon: ListChecks,
    keywords: ['todo', 'checkbox', 'task'], source: { kind: 'linePrefix', prefix: '- [ ] ' } },
  { id: 'quote', label: 'Blockquote', group: 'block', icon: Quote,
    keywords: ['quote', 'blockquote'], source: { kind: 'linePrefix', prefix: '> ' } },
  { id: 'codeblock', label: 'Code block', group: 'block', icon: SquareCode,
    keywords: ['fence', 'pre', 'code block'],
    source: { kind: 'block', body: '```$1\n$0\n```' } },
  { id: 'hr', label: 'Horizontal rule', group: 'block', icon: Minus,
    keywords: ['rule', 'divider', 'hr'], source: { kind: 'block', body: '---' } },

  // ── Insert ──────────────────────────────────────────────────────────────
  { id: 'link', label: 'Link', group: 'insert', icon: Link2,
    keywords: ['url', 'href', 'a'], source: { kind: 'wrap', before: '[', after: ']($1)' } },
  { id: 'image', label: 'Image', group: 'insert', icon: Image,
    keywords: ['img', 'picture', 'figure'],
    source: { kind: 'wrap', before: '![', after: ']($1)' } },
  { id: 'table', label: 'Table', group: 'insert', icon: Table,
    keywords: ['grid', 'tabular'],
    source: { kind: 'block', body: '| $1 | Column |\n| --- | --- |\n| $0 | |' } },
  { id: 'footnote', label: 'Footnote', group: 'insert', icon: Superscript,
    keywords: ['note', 'ref'],
    source: { kind: 'block', body: '[^$1]\n\n[^$1]: $0' } },

  // ── ouRGeo extras ───────────────────────────────────────────────────────
  { id: 'rchunk', label: 'R chunk', group: 'ourgeo', icon: Play, chunksOnly: true,
    keywords: ['chunk', 'r', 'code', 'run'],
    // The label is auto-generated by the ribbon/slash backend (see nextChunkLabel)
    // because a labelled chunk gets a stable identity for its output.
    source: { kind: 'block', body: '```{r $1}\n$0\n```' } },
  { id: 'chunk-plot', label: 'Chunk: export current plot', group: 'ourgeo', icon: ChartLine,
    chunksOnly: true, keywords: ['plot', 'figure', 'ggsave', 'export'],
    note: 'Writes the plot to figures/ so the document knits anywhere',
    source: { kind: 'block', body: '```{r $1, echo=FALSE}\nggplot2::ggsave("figures/$0.png", width = 7, height = 5, dpi = 150)\n```\n\n![](figures/$0.png)' } },
  { id: 'chunk-map', label: 'Chunk: current map', group: 'ourgeo', icon: Map,
    chunksOnly: true, keywords: ['map', 'tmap', 'spatial', 'layer'],
    note: 'Generated from the layers currently on the map',
    source: { kind: 'block', body: '```{r $1, echo=FALSE}\n$0\n```' } },
]

export const MD_ACTION_BY_ID: Record<string, MdActionDef> = Object.fromEntries(
  MD_ACTIONS.map((a) => [a.id, a])
)

/** Actions offered for a document — chunk actions only in .Rmd. */
export function actionsFor(supportsChunks: boolean): MdActionDef[] {
  return MD_ACTIONS.filter((a) => supportsChunks || !a.chunksOnly)
}

/** Ribbon layout: groups in display order, each rendered between dividers. */
export const RIBBON_GROUPS: MdActionGroup[] = ['heading', 'text', 'block', 'insert', 'ourgeo']

/**
 * Next free `chunk-N` label for a document.
 *
 * Auto-labelling is not cosmetic: a labelled chunk gets a stable identity that
 * survives arbitrary edits and reordering, which is what keeps its output
 * attached. Every chunk created through the UI takes that path.
 */
export function nextChunkLabel(text: string): string {
  const used = new Set<number>()
  const re = /^\s*```+\s*\{\s*[A-Za-z][\w.]*\s+chunk-(\d+)/gm
  for (let m = re.exec(text); m; m = re.exec(text)) used.add(Number(m[1]))
  let n = 1
  while (used.has(n)) n++
  return `chunk-${n}`
}

/**
 * Fill a chunk action's `$1` label slot with the next free label.
 *
 * Auto-labelling is what gives a chunk a stable identity, so its output stays
 * attached through edits — see chunk-identity.ts.
 */
export function resolveActionBody(action: MdActionDef, docText: string): MdActionDef {
  if (!action.chunksOnly || action.source.kind !== 'block') return action
  const label = nextChunkLabel(docText)
  return {
    ...action,
    source: { ...action.source, body: action.source.body.replace(/\$1/g, label) },
  }
}
