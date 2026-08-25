// Which language a document tab holds, and how that maps onto Monaco.
//
// This is the only place an extension is turned into a language. Before this
// module the editor had exactly one language decision — `createModel(content,
// 'r')` — and nothing anywhere derived a language from a file path.
//
// `DocLanguage` lives as an optional field on TabState rather than as a new
// TabType on purpose: TabType decides *which component renders* (the DataViewer
// overlay, the save-by-executing-R branch), and a markdown document is still a
// disk-backed text file edited in the code pane. Keeping markdown tabs as
// `type: 'code'` also leaves the four `t.type === 'code'` persistence predicates
// untouched (session-persistence.ts, editor.ts), so markdown tabs persist across
// restarts and project loads with no migration.

export type DocLanguage = 'r' | 'markdown' | 'rmarkdown'

/** Monaco language id registered for R Markdown (see rmarkdown-monarch.ts). */
export const RMARKDOWN_LANGUAGE_ID = 'rmarkdown'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])
// .qmd (Quarto) is the same file shape and is worth editing here; knitting it
// needs the quarto CLI, which ouRGeo does not bundle — the Knit menu says so
// rather than letting rmarkdown::render fail confusingly.
const RMARKDOWN_EXTENSIONS = new Set(['rmd', 'qmd'])

/** Lowercase extension without the dot, or '' when there isn't one. */
export function extensionOf(filePath: string | null | undefined): string {
  if (!filePath) return ''
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Language for a path. Unknown extensions stay 'r' — this is an R IDE. */
export function languageForPath(filePath: string | null | undefined): DocLanguage {
  const ext = extensionOf(filePath)
  if (RMARKDOWN_EXTENSIONS.has(ext)) return 'rmarkdown'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return 'r'
}

/** Tabs saved before this feature carry no `language`, and are R. */
export function languageOf(tab: { language?: DocLanguage } | null | undefined): DocLanguage {
  return tab?.language ?? 'r'
}

/** The Monaco language id to give a model. */
export function monacoLanguageFor(lang: DocLanguage): string {
  if (lang === 'markdown') return 'markdown'
  if (lang === 'rmarkdown') return RMARKDOWN_LANGUAGE_ID
  return 'r'
}

/** The single predicate every markdown-aware consumer branches on. */
export function isMarkdownDoc(lang: DocLanguage | undefined): boolean {
  return lang === 'markdown' || lang === 'rmarkdown'
}

/** True when the document can hold executable R chunks. */
export function supportsChunks(lang: DocLanguage | undefined): boolean {
  return lang === 'rmarkdown'
}

/** Default extension used when naming a new untitled document. */
export function defaultExtensionFor(lang: DocLanguage): string {
  if (lang === 'markdown') return 'md'
  if (lang === 'rmarkdown') return 'Rmd'
  return 'R'
}

/** Human label for the language selector and tab tooltips. */
export function labelFor(lang: DocLanguage): string {
  if (lang === 'markdown') return 'Markdown'
  if (lang === 'rmarkdown') return 'R Markdown'
  return 'R'
}

/** Starter content for a new document, so a new .Rmd is immediately runnable. */
export function starterContentFor(lang: DocLanguage, title = 'Untitled'): string {
  if (lang === 'rmarkdown') {
    return [
      '---',
      `title: "${title}"`,
      'output: html_document',
      '---',
      '',
      '```{r setup}',
      '',
      '```',
      '',
    ].join('\n')
  }
  if (lang === 'markdown') return `# ${title}\n\n`
  return ''
}
