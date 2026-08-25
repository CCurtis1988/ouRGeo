// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'

// Runs Monaco's real tokenizer over the derived R Markdown grammar. The unit
// tests next door pin the rule's *shape*; this one proves the grammar actually
// behaves — that a `{r label}` chunk header is recognised as a fence, that the
// body is handed to the embedded language, and that the closing fence pops back
// to prose. That chain is the whole reason the derived grammar exists and it is
// exactly the sort of thing that typechecks fine and fails at runtime.

const SRC = [
  '# Heading',
  '',
  '```{r setup}',
  'x <- st_buffer(w, 250)',
  '```',
  '',
  'back to prose',
].join('\n')

type Monaco = typeof import('monaco-editor')
let monaco: Monaco

/** First token type on each line. */
function lineTypes(src: string, languageId: string): string[] {
  return monaco.editor.tokenize(src, languageId).map((toks) => toks[0]?.type ?? '')
}

beforeAll(async () => {
  // jsdom lacks a couple of editor-shell APIs that Monaco's contributions
  // touch at import time. Neither is used by the tokenizer.
  const doc = document as unknown as Record<string, unknown>
  doc.queryCommandSupported ??= () => false
  const win = window as unknown as Record<string, unknown>
  win.matchMedia ??= () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  })

  monaco = await import('monaco-editor')
  const { registerRMarkdownLanguage } = await import('./rmarkdown-monarch')
  registerRMarkdownLanguage(monaco)

  // Register Monaco's stock markdown grammar under a private id, so the
  // comparison below is apples-to-apples. (The real 'markdown' language is
  // registered lazily and would not be loaded in this environment.)
  const md = await import('monaco-editor/esm/vs/basic-languages/markdown/markdown.js')
  monaco.languages.register({ id: 'md-stock' })
  monaco.languages.setMonarchTokensProvider('md-stock', md.language)
}, 60_000)

describe('rmarkdown tokenization', () => {
  it('tokenizes markdown structure', () => {
    const types = lineTypes(SRC, 'rmarkdown')
    expect(types[0]).toMatch(/keyword/)   // # Heading
  })

  it('recognises a {r} chunk header as a fence and pops at the close', () => {
    const types = lineTypes(SRC, 'rmarkdown')
    expect(types[2]).toMatch(/string/)    // ```{r setup}
    expect(types[4]).toMatch(/string/)    // closing ```
    // Line 6 is prose again — proves nextEmbedded/@pop unwound rather than
    // leaving the tokenizer stuck inside the chunk for the rest of the file.
    expect(types[6]).not.toMatch(/string/)
  })

  it('hands the chunk body to the embedded language', () => {
    const derived = lineTypes(SRC, 'rmarkdown')
    // The body carries no markdown token because it has been delegated to the
    // fenced language — that delegation is what colours R code as R.
    expect(derived[3]).toBe('')
    expect(derived[3]).not.toMatch(/variable\.source/)
  })

  it('fixes the document inversion stock markdown produces on an .Rmd', () => {
    // Worth pinning precisely, because the stock failure is not a cosmetic
    // near-miss. Its GFM fence rule needs a word character after the backticks,
    // so `{r setup}` matches NEITHER fence rule and is read as prose. The
    // CLOSING fence is then taken for an OPENING unlabelled code block, and
    // every line after it is swallowed as code.
    const stock = lineTypes(SRC, 'md-stock')
    expect(stock[2]).toBe('')                          // header not seen as a fence
    expect(stock[6]).toMatch(/variable\.source/)       // prose after the chunk → code

    const derived = lineTypes(SRC, 'rmarkdown')
    expect(derived[2]).toMatch(/string/)               // header is a fence
    expect(derived[6]).toBe('')                        // prose stays prose
  })

  it('still handles a plain ```r fence via the stock rule', () => {
    const src = ['```r', 'y <- 1', '```', 'prose'].join('\n')
    const types = lineTypes(src, 'rmarkdown')
    expect(types[0]).toMatch(/string/)
    expect(types[3]).not.toMatch(/string/)
  })

  it('does not get stuck on a chunk whose engine has no grammar', () => {
    // An unregistered embedded language would leave the tokenizer wedged, so
    // these headers take the opaque-fence path instead.
    const src = ['```{stan model}', 'parameters {}', '```', 'prose'].join('\n')
    const types = lineTypes(src, 'rmarkdown')
    expect(types[2]).toMatch(/string/)     // closing fence still recognised
    expect(types[3]).not.toMatch(/string/) // and prose resumes after it
  })
})
