// Monaco ships its basic-language grammars as untyped ESM deep imports — the
// package's own .d.ts only covers the public `monaco-editor` entry point. We
// import the markdown grammar to derive an R Markdown one from it (see
// rmarkdown-monarch.ts), so declare just what we use.
declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.js' {
  import type * as MonacoNs from 'monaco-editor'
  export const conf: MonacoNs.languages.LanguageConfiguration
  export const language: MonacoNs.languages.IMonarchLanguage
}
