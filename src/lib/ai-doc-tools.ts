// Document tools: the AI writes into editor tabs instead of into R string literals.
//
// Before these existed, the assistant's only instrument was `execute_r_code`, so
// producing a report meant assembling it out of `writeLines(c("…", "…"))` — a
// whole document's backticks, quotes and backslashes escaped inside an R string.
// That is where a small local model comes apart, and the corruption is silent.
//
// Deliberately NOT gated on Autopilot and given no switch of their own: they
// touch a visible editor tab and nothing else. No disk, no R session. The text
// lands in Monaco where the user reads it, Ctrl+Z undoes it, and saving stays
// the user's action — which is also what keeps this whole module testable
// without Electron.
//
// Shape mirrors ai-web-tools.ts (TOOLS / TOOL_NAMES / run… / describe…Call) so
// AiChatPanel dispatches all three families the same way.

import type { AiTool } from '@/lib/ai-client'
import { truncateForModel } from '@/lib/ai-client'
import { useEditorStore, type TabState } from '@/store/editor'
import { languageOf, languageForPath, labelFor, type DocLanguage } from '@/lib/markdown/doc-kind'
import { describeDocument } from '@/lib/ai-doc-context'

export const READ_DOCUMENT_TOOL: AiTool = {
  name: 'read_document',
  description:
    'Read the full text of a document open in the ouRGeo editor (.Rmd, .md or .R). ' +
    'Do this before editing one, so your edits match the text that is actually there.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'File name of the document, e.g. "report.Rmd". Omit for the active document.',
      },
    },
    required: [],
  },
}

export const WRITE_DOCUMENT_TOOL: AiTool = {
  name: 'write_document',
  description:
    'Write a document into an editor tab, creating it if it is not already open. ' +
    'Use this instead of building a file with writeLines() or cat() through R. ' +
    'The text lands in a tab the user can read and undo; it is NOT saved to disk — ' +
    'the user saves it themselves. Build a long report with mode "append", one section per call.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: 'File name including extension, e.g. "earthquake-report.Rmd".',
      },
      content: { type: 'string', description: 'The document text (markdown, with {r} chunks for .Rmd).' },
      mode: {
        type: 'string',
        enum: ['replace', 'append'],
        description: '"replace" (default) overwrites the whole document; "append" adds to the end.',
      },
    },
    required: ['name', 'content'],
  },
}

export const EDIT_DOCUMENT_TOOL: AiTool = {
  name: 'edit_document',
  description:
    'Replace one exact passage of an open document — the way to fix a single chunk without ' +
    'rewriting the file. The "find" text must appear exactly once; include surrounding lines ' +
    'to make it unique.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'File name of the document. Omit for the active document.' },
      find: { type: 'string', description: 'Exact text to replace, copied from read_document.' },
      replace: { type: 'string', description: 'Text to put in its place.' },
    },
    required: ['find', 'replace'],
  },
}

export const DOC_TOOLS: AiTool[] = [READ_DOCUMENT_TOOL, WRITE_DOCUMENT_TOOL, EDIT_DOCUMENT_TOOL]
export const DOC_TOOL_NAMES: ReadonlySet<string> = new Set(DOC_TOOLS.map((t) => t.name))

// ── Resolving a name to a tab ──────────────────────────────────────────────

type Resolution =
  | { tab: TabState }
  /** A name was given and nothing matched — write_document creates, others fail. */
  | { missing: string }
  | { error: string }

const basename = (p: string | null): string => (p ? p.split(/[\\/]/).pop() ?? '' : '')

function openDocs(): TabState[] {
  return useEditorStore.getState().tabs.filter((t) => t.type === 'code')
}

function listing(): string {
  const docs = openDocs()
  return docs.length > 0 ? docs.map((t) => `"${t.fileName}"`).join(', ') : '(none open)'
}

/** Active tab first when unnamed; then exact name, path basename, full path,
 *  case-insensitive name. Ambiguity is reported, never guessed. */
export function resolveTab(name?: string): Resolution {
  const docs = openDocs()
  const want = (name ?? '').trim()

  if (want === '') {
    const active = useEditorStore.getState().getActiveTab()
    if (active && active.type === 'code') return { tab: active }
    if (docs.length === 1) return { tab: docs[0] }
    return { error: `No document name given and no document is active. Open documents: ${listing()}.` }
  }

  const tiers = [
    docs.filter((t) => t.fileName === want),
    docs.filter((t) => basename(t.filePath) === want),
    docs.filter((t) => t.filePath === want),
    docs.filter((t) => t.fileName.toLowerCase() === want.toLowerCase()),
  ]
  for (const tier of tiers) {
    if (tier.length === 1) return { tab: tier[0] }
    if (tier.length > 1) {
      return { error: `"${want}" matches ${tier.length} open documents. Use the full path instead.` }
    }
  }
  return { missing: want }
}

// ── Receipts ───────────────────────────────────────────────────────────────

/** What the model gets back after a write: enough to see the document took the
 *  shape it intended, plus the static checks. */
function receipt(verb: string, tab: { fileName: string; content: string }, lang: DocLanguage): string {
  const s = describeDocument(tab.content, lang)
  const parts = [`${verb} "${tab.fileName}" (${labelFor(lang)}): ${s.lines} lines`]
  if (s.chunkLabels.length > 0) {
    parts.push(`chunks: ${s.chunkLabels.join(', ')} (${s.runnableChunks} runnable)`)
  }
  const out = [parts.join('. ')]
  for (const w of s.warnings) out.push(`! ${w}`)
  out.push('The tab is open in the editor and NOT saved to disk — the user saves with Ctrl+S, or when they Knit.')
  return out.join('\n')
}

/** A name with no extension gets one that matches what was written, so the tab
 *  highlights and knits as the right kind of document. */
function withExtension(name: string, content: string): string {
  if (/\.[A-Za-z0-9]+$/.test(name)) return name
  return /^\s*```+\s*\{[A-Za-z]/m.test(content) ? `${name}.Rmd` : `${name}.md`
}

function appendTo(existing: string, addition: string): string {
  if (existing.trim() === '') return addition
  return `${existing.replace(/\s*$/, '')}\n\n${addition.replace(/^\n+/, '')}`
}

// ── The tools ──────────────────────────────────────────────────────────────

function readDocument(name?: string): string {
  const r = resolveTab(name)
  if ('error' in r) return `Error: ${r.error}`
  if ('missing' in r) return `Error: no open document called "${r.missing}". Open documents: ${listing()}.`
  const lang = languageOf(r.tab)
  const header = `${r.tab.fileName} — ${labelFor(lang)}, ${r.tab.filePath ?? 'not saved to disk'}`
  return `${header}\n\n${truncateForModel(r.tab.content, 24000)}`
}

function writeDocument(name: string, content: string, mode: 'replace' | 'append'): string {
  if (!name.trim()) return 'Error: write_document needs a file name, e.g. "report.Rmd".'
  const store = useEditorStore.getState()
  const r = resolveTab(name)
  if ('error' in r) return `Error: ${r.error}`

  if ('missing' in r) {
    const fileName = withExtension(r.missing, content)
    const lang = languageForPath(fileName)
    store.newDocumentTab(fileName, content, lang)
    return receipt('Created', { fileName, content }, lang)
  }

  // Visual mode is seeded once from the tab's text and only writes back on exit,
  // so a write underneath it would be invisible and then overwritten. Drop the
  // tab to Source first.
  if (r.tab.viewMode === 'visual') store.setTabViewMode(r.tab.id, 'source')

  const next = mode === 'append' ? appendTo(r.tab.content, content) : content
  store.applyExternalContent(r.tab.id, next)
  store.setActiveTab(r.tab.id)
  return receipt(mode === 'append' ? 'Appended to' : 'Rewrote', { fileName: r.tab.fileName, content: next }, languageOf(r.tab))
}

function editDocument(name: string | undefined, find: string, replace: string): string {
  if (find === '') return 'Error: edit_document needs the exact text to replace.'
  const store = useEditorStore.getState()
  const r = resolveTab(name)
  if ('error' in r) return `Error: ${r.error}`
  if ('missing' in r) return `Error: no open document called "${r.missing}". Open documents: ${listing()}.`

  const text = r.tab.content
  const at = text.indexOf(find)
  if (at < 0) {
    return `Error: that exact text is not in "${r.tab.fileName}". Read the document again with ` +
      'read_document and copy the passage verbatim, including indentation.'
  }
  if (text.indexOf(find, at + find.length) >= 0) {
    return `Error: that text appears more than once in "${r.tab.fileName}". Include more of the ` +
      'surrounding lines so the passage is unique.'
  }

  if (r.tab.viewMode === 'visual') store.setTabViewMode(r.tab.id, 'source')
  const next = text.slice(0, at) + replace + text.slice(at + find.length)
  store.applyExternalContent(r.tab.id, next)
  store.setActiveTab(r.tab.id)
  return receipt('Edited', { fileName: r.tab.fileName, content: next }, languageOf(r.tab))
}

/** Dispatch, matching runWebTool's contract: every failure is a string the model
 *  can recover from, never a thrown error. */
export async function runDocTool(name: string, input: Record<string, unknown>): Promise<string> {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (name) {
    case READ_DOCUMENT_TOOL.name:
      return readDocument(str(input.name))
    case WRITE_DOCUMENT_TOOL.name:
      return writeDocument(str(input.name), str(input.content), str(input.mode) === 'append' ? 'append' : 'replace')
    case EDIT_DOCUMENT_TOOL.name:
      return editDocument(str(input.name) || undefined, str(input.find), str(input.replace))
    default:
      return `Error: unknown document tool "${name}".`
  }
}

/** The console line logged before the call, so the console stays a complete
 *  record of what the assistant did to the user's documents. */
export function describeDocCall(name: string, input: Record<string, unknown>): string {
  const target = typeof input.name === 'string' && input.name.trim()
    ? input.name.trim()
    : 'the active document'
  if (name === READ_DOCUMENT_TOOL.name) return `AI read ${target}`
  if (name === WRITE_DOCUMENT_TOOL.name) {
    return `AI ${input.mode === 'append' ? 'appended to' : 'wrote'} ${target}`
  }
  if (name === EDIT_DOCUMENT_TOOL.name) return `AI edited ${target}`
  return `AI document tool: ${name}`
}
