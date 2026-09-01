// Monaco ships its basic-language grammars as untyped ESM deep imports — the
// package's own .d.ts only covers the public `monaco-editor` entry point. We
// import the markdown grammar to derive an R Markdown one from it (see
// rmarkdown-monarch.ts), so declare just what we use.
declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js' {
  import type * as MonacoNs from 'monaco-editor'
  export const conf: MonacoNs.languages.LanguageConfiguration
  export const language: MonacoNs.languages.IMonarchLanguage
}

// The R grammar, imported only by `editor-themes-tokens.test.ts`: R is
// contributed lazily, so a chunk body has nothing to delegate to unless the
// grammar is installed synchronously.
declare module 'monaco-editor/esm/vs/basic-languages/r/r.js' {
  import type * as MonacoNs from 'monaco-editor'
  export const conf: MonacoNs.languages.LanguageConfiguration
  export const language: MonacoNs.languages.IMonarchLanguage
}
