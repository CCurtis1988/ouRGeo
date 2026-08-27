// What the AI is told about the documents open in the editor.
//
// The system prompt already carries the R environment and the tail of the
// console; before this module it said nothing about the editor, so a model asked
// to "write up the analysis" had no idea whether a document already existed, let
// alone what was in it. That is also why the failure this fixes was invisible:
// nothing ever told the model that a .Rmd is rendered in a session of its own.
//
// The block is a SUMMARY, never the full text — documents run to hundreds of
// lines and there is a read_document tool for the rest. `describeDocument` is
// shared with the write tools, so the checks that catch a duplicate label or a
// bare-object chunk run both when the model is told what is open and when it
// hands a document back.

import type { TabState } from '@/store/editor'
import { type DocLanguage, languageOf, labelFor, isMarkdownDoc, supportsChunks } from '@/lib/markdown/doc-kind'
import { scanChunks } from '@/lib/markdown/chunks'
import { splitFrontMatter } from '@/lib/markdown/front-matter'

const MAX_DOCUMENTS = 8
const MAX_HEADINGS = 12
const MAX_CHUNKS = 20
const MAX_WARNINGS = 5

export interface DocumentSummary {
  lines: number
  /** Top-level-through-h6 heading text, in document order. */
  headings: string[]
  /** Chunk labels, with `(unlabelled)` standing in for the ones that have none. */
  chunkLabels: string[]
  runnableChunks: number
  /** Problems worth reporting before the user finds them at knit time. */
  warnings: string[]
}

const BARE_NAME = /^[A-Za-z.][A-Za-z0-9._]*$/

/** Summarise a document: outline, chunk labels, and the cheap static checks. */
export function describeDocument(text: string, language: DocLanguage): DocumentSummary {
  const lines = text === '' ? 0 : text.split('\n').length
  const headings: string[] = []
  const chunkLabels: string[] = []
  const warnings: string[] = []

  if (!isMarkdownDoc(language)) {
    return { lines, headings, chunkLabels, runnableChunks: 0, warnings }
  }

  const { frontMatter, frontMatterLines } = splitFrontMatter(text)
  const chunks = scanChunks(text)

  // Headings, skipping front matter and anything inside a fence — a `# comment`
  // in R code is not a section of the document.
  const inChunk = (line: number): boolean =>
    chunks.some((c) => line >= c.startLine && line <= c.endLine)
  text.split('\n').forEach((line, i) => {
    if (i + 1 <= frontMatterLines || inChunk(i + 1)) return
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (m) headings.push(m[1])
  })

  const seen = new Set<string>()
  let runnable = 0
  for (const c of chunks) {
    if (c.header.raw === '') continue // a plain ``` fence, not a chunk
    chunkLabels.push(c.header.label ?? '(unlabelled)')
    if (c.runnable && !c.unterminated) runnable++

    if (c.header.label) {
      if (seen.has(c.header.label)) {
        warnings.push(`duplicate chunk label "${c.header.label}" — knitr aborts on this`)
      }
      seen.add(c.header.label)
    }
    if (c.unterminated) {
      warnings.push(`the chunk starting at line ${c.startLine} is never closed`)
    }
    // The exact failure this module exists for: a chunk that only names an
    // object the live session happens to hold.
    if (c.runnable && BARE_NAME.test(c.code.trim())) {
      warnings.push(
        `chunk ${c.header.label ? `"${c.header.label}"` : `at line ${c.startLine}`} is just the ` +
        `object \`${c.code.trim()}\` — unless a chunk in this document creates it, Knit will fail`
      )
    }
  }

  if (language === 'rmarkdown' && frontMatter === '' && text.trim() !== '') {
    warnings.push('no YAML front matter — knitr has no output format to render to')
  }
  if (!supportsChunks(language) && chunks.some((c) => c.runnable)) {
    warnings.push('this is a plain .md document, so its {r} chunks will never run')
  }

  return { lines, headings, chunkLabels, runnableChunks: runnable, warnings }
}

function cap(items: string[], max: number): string {
  if (items.length <= max) return items.join(', ')
  return `${items.slice(0, max).join(', ')}, … (+${items.length - max} more)`
}

/** The `## Open Documents` prompt section. Empty when nothing is open. */
export function buildDocumentContext(tabs: TabState[], activeTabId: string | null): string {
  const docs = tabs.filter((t) => t.type === 'code').slice(0, MAX_DOCUMENTS)
  if (docs.length === 0) return ''

  const lines = [
    '## Open Documents',
    'Files open in the editor. Use `read_document` / `write_document` / `edit_document` on these by name.',
    '',
  ]

  for (const tab of docs) {
    const lang = languageOf(tab)
    const facts = [labelFor(lang)]
    if (tab.id === activeTabId) facts.push('ACTIVE')
    if (tab.viewMode === 'visual') facts.push('open in Visual mode — the text below may lag what is on screen')
    const summary = describeDocument(tab.content, lang)
    facts.push(`${summary.lines} line${summary.lines === 1 ? '' : 's'}`)
    facts.push(tab.filePath ? tab.filePath : 'not saved to disk')
    if (tab.isDirty) facts.push('unsaved changes')

    lines.push(`- \`${tab.fileName}\` — ${facts.join(', ')}`)
    if (summary.headings.length > 0) {
      lines.push(`  headings: ${cap(summary.headings, MAX_HEADINGS)}`)
    }
    if (summary.chunkLabels.length > 0) {
      lines.push(`  chunks: ${cap(summary.chunkLabels, MAX_CHUNKS)} (${summary.runnableChunks} runnable)`)
    }
    for (const w of summary.warnings.slice(0, MAX_WARNINGS)) lines.push(`  ! ${w}`)
  }

  if (tabs.filter((t) => t.type === 'code').length > MAX_DOCUMENTS) {
    lines.push(`- … and ${tabs.filter((t) => t.type === 'code').length - MAX_DOCUMENTS} more`)
  }

  return lines.join('\n')
}
