// An `rmarkdown` Monaco language: stock markdown plus R chunk fences.
//
// Monaco already ships a markdown Monarch grammar, and its GFM fence rule embeds
// the fenced language:
//
//   [/^\s*```\s*((?:\w|[\/\-#])+).*$/, { token: 'string', next: '@codeblockgh',
//                                        nextEmbedded: '$1' }]
//
// That character class cannot match a knitr chunk header — ```{r label,
// echo=FALSE} starts with a brace — so an .Rmd would render its chunk bodies as
// plain prose. The embedding machinery itself is fine; it is one rule short.
//
// So: take the stock config, prepend a brace-aware rule that embeds the engine
// name, and register the result as its own language. We deliberately do not
// mutate the shared markdown grammar — plain .md files keep Monaco's stock
// behaviour.

import { conf as mdConf, language as mdLanguage } from 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js'
import type * as MonacoNs from 'monaco-editor'
import { RMARKDOWN_LANGUAGE_ID } from './doc-kind'

type Monarch = MonacoNs.languages.IMonarchLanguage
type MonarchRoot = NonNullable<Monarch['tokenizer']>[string]

// ```{r}, ```{r label}, ```{r label, echo=FALSE, fig.width=7}, ```{python x}
// Capture group 1 is the engine, which becomes the embedded language id.
const CHUNK_FENCE = /^\s*```\s*\{\s*([A-Za-z][\w.]*)[^}]*\}\s*$/

// Engines Monaco has a grammar for. Anything else (e.g. an exotic knitr engine)
// falls back to an un-embedded code block rather than embedding a language that
// was never registered — which would leave the tokenizer stuck.
const EMBEDDABLE = new Set(['r', 'python', 'sql', 'bash', 'shell', 'javascript', 'css', 'html', 'yaml'])

let registered = false

/** Register the `rmarkdown` language. Idempotent — safe to call on every mount. */
export function registerRMarkdownLanguage(monaco: typeof MonacoNs): void {
  if (registered) return
  registered = true

  monaco.languages.register({
    id: RMARKDOWN_LANGUAGE_ID,
    extensions: ['.Rmd', '.rmd', '.qmd'],
    aliases: ['R Markdown', 'rmarkdown'],
  })

  monaco.languages.setLanguageConfiguration(RMARKDOWN_LANGUAGE_ID, mdConf)
  monaco.languages.setMonarchTokensProvider(RMARKDOWN_LANGUAGE_ID, buildRMarkdownMonarch())
}

/** The derived grammar. Exported separately so it can be unit-tested. */
export function buildRMarkdownMonarch(): Monarch {
  const base = mdLanguage as unknown as Monarch
  const tokenizer = { ...(base.tokenizer ?? {}) } as Record<string, MonarchRoot>
  const root = [...(tokenizer.root ?? [])] as unknown[]

  // Must come before the stock fence rules, which would otherwise consume the
  // line as an unlabelled code block.
  const chunkRule = [
    CHUNK_FENCE,
    {
      token: 'string',
      next: '@rchunk',
      nextEmbedded: '$1',
    },
  ]
  // A chunk whose engine we can't embed still needs its own fence rule, or the
  // stock ```-with-no-language rule swallows it.
  const opaqueChunkRule = [
    /^\s*```\s*\{[^}]*\}\s*$/,
    { token: 'string', next: '@codeblock' },
  ]

  // Insert ahead of the first stock fence rule so ordering is explicit rather
  // than "index 0 happens to work".
  const firstFence = root.findIndex(
    (r) => Array.isArray(r) && String((r as unknown[])[0]).includes('```')
  )
  const at = firstFence >= 0 ? firstFence : 0
  root.splice(at, 0, chunkRule, opaqueChunkRule)

  return {
    ...base,
    tokenizer: {
      ...tokenizer,
      root: root as MonarchRoot,
      // Same shape as the stock `codeblockgh` state: pop the embedded language
      // when the closing fence arrives.
      rchunk: [
        [/^\s*```\s*$/, { token: 'string', next: '@pop', nextEmbedded: '@pop' }],
        [/[^`]+/, 'variable.source'],
        [/`/, 'variable.source'],
      ] as unknown as MonarchRoot,
    },
  }
}

/** Whether a chunk header's engine gets syntax-embedded. Used by the tests. */
export function isEmbeddableEngine(engine: string): boolean {
  return EMBEDDABLE.has(engine.toLowerCase())
}

export { CHUNK_FENCE }
